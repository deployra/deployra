package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/deployra/deployra/api/internal/config"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/kubernetes"
	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

// Claims represents JWT claims
type Claims struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// JoinPodLogsPayload represents the payload for joining pod logs
type JoinPodLogsPayload struct {
	ServiceID string `json:"serviceId"`
	PodName   string `json:"podName"`
	Namespace string `json:"namespace"`
	Since     string `json:"since"`
}

// JoinDeploymentLogsPayload represents the payload for joining deployment logs
type JoinDeploymentLogsPayload struct {
	DeploymentID string `json:"deploymentId"`
}

// UpgradeMiddleware checks if the request is a WebSocket upgrade request
func UpgradeMiddleware(c *fiber.Ctx) error {
	if websocket.IsWebSocketUpgrade(c) {
		c.Locals("allowed", true)
		return c.Next()
	}
	return fiber.ErrUpgradeRequired
}

// Handler handles WebSocket connections
func Handler(c *websocket.Conn) {
	cfg := config.Get()
	hub := GetHub()

	// Get token from query params
	token := c.Query("token")
	if token == "" {
		c.WriteJSON(map[string]interface{}{
			"event": "error",
			"payload": map[string]string{
				"message": "Authentication required",
			},
		})
		c.Close()
		return
	}

	// Verify token
	claims, err := parseJWT(token, cfg.JWTSecret)
	if err != nil {
		c.WriteJSON(map[string]interface{}{
			"event": "error",
			"payload": map[string]string{
				"message": "Invalid token",
			},
		})
		c.Close()
		return
	}

	// Create client
	client := &Client{
		Conn:   c,
		UserID: claims.UserID,
		Rooms:  make(map[string]bool),
	}

	// Register client
	hub.Register(client)
	defer hub.Unregister(client)

	// Send connected event
	if err := hub.SendToClient(client, "connected", map[string]string{
		"userId": claims.UserID,
	}); err != nil {
		log.Printf("[WebSocket] Error sending connected event: %v", err)
	}

	// Active log streams (for cleanup)
	activeStreams := make(map[string]context.CancelFunc)
	defer func() {
		for _, cancel := range activeStreams {
			cancel()
		}
	}()

	// Handle incoming messages
	for {
		_, msgBytes, err := c.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WebSocket] Error reading message: %v", err)
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			log.Printf("[WebSocket] Error parsing message: %v", err)
			continue
		}

		switch msg.Event {
		case "join_pod_logs":
			var payload JoinPodLogsPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				hub.SendToClient(client, "error", map[string]string{
					"message": "Invalid payload",
				})
				continue
			}
			handleJoinPodLogs(client, hub, claims.UserID, payload, activeStreams)

		case "leave_pod_logs":
			var payload JoinPodLogsPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				continue
			}
			roomID := fmt.Sprintf("logs:%s:%s", payload.ServiceID, payload.PodName)
			hub.LeaveRoom(client, roomID)
			if cancel, exists := activeStreams[roomID]; exists {
				cancel()
				delete(activeStreams, roomID)
			}

		case "join_deployment_logs":
			var payload JoinDeploymentLogsPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				hub.SendToClient(client, "error", map[string]string{
					"message": "Invalid payload",
				})
				continue
			}
			handleJoinDeploymentLogs(client, hub, claims.UserID, payload)

		case "leave_deployment_logs":
			var payload JoinDeploymentLogsPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				continue
			}
			roomID := fmt.Sprintf("deployment:%s", payload.DeploymentID)
			hub.LeaveRoom(client, roomID)

		default:
			log.Printf("[WebSocket] Unknown event: %s", msg.Event)
		}
	}
}

func parseJWT(tokenString string, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}

func handleJoinPodLogs(client *Client, hub *Hub, userID string, payload JoinPodLogsPayload, activeStreams map[string]context.CancelFunc) {
	db := database.GetDatabase()

	if payload.ServiceID == "" || payload.PodName == "" || payload.Namespace == "" {
		hub.SendToClient(client, "error", map[string]string{
			"message": "Missing required parameters",
		})
		return
	}

	// Check access
	var service models.Service
	if err := db.Preload("Project.Organization").Where("id = ?", payload.ServiceID).First(&service).Error; err != nil {
		hub.SendToClient(client, "error", map[string]string{
			"message": "Service not found",
		})
		return
	}

	var user models.User
	if err := db.Where("id = ?", userID).First(&user).Error; err != nil {
		hub.SendToClient(client, "error", map[string]string{
			"message": "User not found",
		})
		return
	}

	if service.Project.Organization.UserID != user.ID {
		hub.SendToClient(client, "error", map[string]string{
			"message": "Access denied",
		})
		return
	}

	// Join room
	roomID := fmt.Sprintf("logs:%s:%s", payload.ServiceID, payload.PodName)
	hub.JoinRoom(client, roomID)

	log.Printf("[WebSocket] User %s subscribed to logs for pod %s in service %s", userID, payload.PodName, payload.ServiceID)

	// Start streaming logs
	ctx, cancel := context.WithCancel(context.Background())
	activeStreams[roomID] = cancel

	go streamPodLogs(ctx, client, hub, service.ProjectID, payload.PodName, payload.Since)
}

func streamPodLogs(ctx context.Context, client *Client, hub *Hub, projectID, podName, since string) {
	// Parse since duration
	var sinceSeconds *int64
	if since != "" {
		if d, err := time.ParseDuration(since); err == nil {
			secs := int64(d.Seconds())
			sinceSeconds = &secs
		}
	}

	stream, err := kubernetes.StreamPodLogsReader(ctx, projectID, podName, sinceSeconds)
	if err != nil {
		hub.SendToClient(client, "error", map[string]string{
			"message": "Failed to stream logs: " + err.Error(),
		})
		return
	}
	defer stream.Close()

	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			return
		default:
			n, err := stream.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("[WebSocket] Error reading pod logs: %v", err)
				}
				hub.SendToClient(client, "logs_complete", nil)
				return
			}

			if n > 0 {
				logs := string(buf[:n])
				if strings.TrimSpace(logs) != "" {
					hub.SendToClient(client, "pod_log", map[string]string{
						"podName": podName,
						"logs":    logs,
					})
				}
			}
		}
	}
}

func handleJoinDeploymentLogs(client *Client, hub *Hub, userID string, payload JoinDeploymentLogsPayload) {
	db := database.GetDatabase()

	if payload.DeploymentID == "" {
		hub.SendToClient(client, "error", map[string]string{
			"message": "Missing required parameters",
		})
		return
	}

	// Check access
	var deployment models.Deployment
	if err := db.Preload("Service.Project.Organization").Where("id = ?", payload.DeploymentID).First(&deployment).Error; err != nil {
		hub.SendToClient(client, "error", map[string]string{
			"message": "Deployment not found",
		})
		return
	}

	var user models.User
	if err := db.Where("id = ?", userID).First(&user).Error; err != nil {
		hub.SendToClient(client, "error", map[string]string{
			"message": "User not found",
		})
		return
	}

	if deployment.Service.Project.Organization.UserID != user.ID {
		hub.SendToClient(client, "error", map[string]string{
			"message": "Access denied",
		})
		return
	}

	// Join room
	roomID := fmt.Sprintf("deployment:%s", payload.DeploymentID)
	hub.JoinRoom(client, roomID)

	log.Printf("[WebSocket] User %s subscribed to logs for deployment %s", userID, payload.DeploymentID)

	// Send existing logs asynchronously to avoid blocking the message loop
	go func() {
		// Check if client is still connected before querying
		if !hub.IsClientConnected(client) {
			log.Printf("[WebSocket] Client disconnected before sending logs for deployment %s", payload.DeploymentID)
			return
		}

		var logs []models.DeploymentLog
		result := db.Where("deploymentId = ?", payload.DeploymentID).Order("createdAt asc").Find(&logs)
		if result.Error != nil {
			log.Printf("[WebSocket] Error fetching logs for deployment %s: %v", payload.DeploymentID, result.Error)
			return
		}
		log.Printf("[WebSocket] Found %d existing logs for deployment %s", len(logs), payload.DeploymentID)

		for _, logEntry := range logs {
			// Check if client is still connected before each send
			if !hub.IsClientConnected(client) {
				log.Printf("[WebSocket] Client disconnected during log streaming for deployment %s", payload.DeploymentID)
				return
			}

			err := hub.SendToClient(client, "deployment_log", map[string]interface{}{
				"deploymentId": payload.DeploymentID,
				"type":         logEntry.Type,
				"text":         logEntry.Text,
				"timestamp":    logEntry.CreatedAt.Format(time.RFC3339),
			})
			if err != nil {
				log.Printf("[WebSocket] Error sending log to client: %v", err)
				return
			}
		}
		log.Printf("[WebSocket] All %d logs sent successfully for deployment %s", len(logs), payload.DeploymentID)
	}()
}
