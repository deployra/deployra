package deployments

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/deploy"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/redis"
	"github.com/deployra/deployra/api/internal/utils"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// LogEntry represents a log entry
type LogEntry struct {
	Text string `json:"text"`
	Type string `json:"type"`
}

// StatusUpdateRequest represents the deployment status update request
type StatusUpdateRequest struct {
	Status string   `json:"status"`
	Error  string   `json:"error,omitempty"`
	Logs   LogEntry `json:"logs,omitempty"`
	Data   struct {
		ContainerImageUri     string `json:"containerImageUri,omitempty"`
		ContainerRegistryType string `json:"containerRegistryType,omitempty"`
	} `json:"data,omitempty"`
}

// LogUpdateRequest represents the log update request
type LogUpdateRequest struct {
	Text string `json:"text"`
	Type string `json:"type,omitempty"`
}

// POST /api/webhooks/deployments/:deploymentId/status
func UpdateStatus(c *fiber.Ctx) error {
	db := database.GetDatabase()

	deploymentID := c.Params("deploymentId")
	if deploymentID == "" {
		return response.BadRequest(c, "Deployment ID is required")
	}

	var req StatusUpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if req.Status == "" {
		return response.BadRequest(c, "Status is required")
	}

	// Find the deployment
	var deployment models.Deployment
	if err := db.Preload("Service.Project.Organization").
		Preload("Service.GitProvider.GithubAccount").
		Where("id = ?", deploymentID).
		First(&deployment).Error; err != nil {
		return response.NotFound(c, "Deployment not found")
	}

	// Update data
	updates := map[string]interface{}{
		"status":    req.Status,
		"updatedAt": time.Now(),
	}

	// If builded received, set DEPLOYING
	if req.Status == string(models.DeploymentStatusBuilded) {
		updates["status"] = models.DeploymentStatusDeploying
	}

	// Set completedAt if deployment is completed or failed
	if req.Status == string(models.DeploymentStatusDeployed) ||
		req.Status == string(models.DeploymentStatusFailed) ||
		req.Status == string(models.DeploymentStatusCancelled) {
		updates["completedAt"] = time.Now()
	}

	// Update only the Deployment table (not associations)
	if err := db.Model(&models.Deployment{}).Where("id = ?", deploymentID).Updates(updates).Error; err != nil {
		log.Printf("Failed to update deployment %s status: %v", deploymentID, err)
		return response.InternalServerError(c, "Failed to update deployment status")
	}

	// Create log entry if logs are provided
	if req.Logs.Text != "" {
		logType := req.Logs.Type
		if logType == "" {
			logType = "STDOUT"
		}

		createdLog := models.DeploymentLog{
			DeploymentID: deploymentID,
			Text:         req.Logs.Text,
			Type:         models.LogType(logType),
		}
		db.Create(&createdLog)

		// Publish to websocket via Redis
		publishDeploymentLog(deploymentID, createdLog)
	}

	// Handle specific status transitions
	switch req.Status {
	case string(models.DeploymentStatusBuilded):
		// Create awaiting deploy log
		awaitingLog := models.DeploymentLog{
			DeploymentID: deploymentID,
			Text:         "Awaiting deploy...",
			Type:         models.LogTypeInfo,
		}
		db.Create(&awaitingLog)

		// Publish to Socket.IO via Redis
		publishDeploymentLog(deploymentID, awaitingLog)

		// Update container image URI if provided
		if req.Data.ContainerImageUri != "" {
			db.Model(&models.Service{}).Where("id = ?", deployment.ServiceID).Updates(map[string]interface{}{
				"containerRegistryImageUri": req.Data.ContainerImageUri,
				"containerRegistryType":     req.Data.ContainerRegistryType,
			})
		}

		// Trigger deployment
		go func() {
			if err := deploy.DeployService("deploy-service", &deploymentID, deployment.ServiceID); err != nil {
				log.Printf("Error deploying service: %v", err)
			}
		}()

		// Send webhook notification
		sendDeploymentWebhook(deployment, req.Status, "Service is deploying", deploymentID)

	case string(models.DeploymentStatusDeploying):
		db.Model(&models.Service{}).Where("id = ?", deployment.ServiceID).Updates(map[string]interface{}{
			"status":     models.ServiceStatusDeploying,
			"deployedAt": time.Now(),
		})
		sendDeploymentWebhook(deployment, req.Status, "Service is deploying", deploymentID)

	case string(models.DeploymentStatusDeployed):
		db.Model(&models.Service{}).Where("id = ?", deployment.ServiceID).Updates(map[string]interface{}{
			"status":     models.ServiceStatusRunning,
			"deployedAt": time.Now(),
		})

		// Create deployment completed event
		db.Create(&models.ServiceEvent{
			ServiceID:    deployment.ServiceID,
			Type:         models.EventTypeDeployCompleted,
			Message:      utils.Ptr("Deployment completed successfully"),
			DeploymentID: &deploymentID,
		})

		sendDeploymentWebhook(deployment, req.Status, "Service deployed successfully", deploymentID)

	case string(models.DeploymentStatusFailed):
		// Create deployment failed event
		message := "Deployment failed"
		if req.Error != "" {
			message = req.Error
		}

		db.Create(&models.ServiceEvent{
			ServiceID:    deployment.ServiceID,
			Type:         models.EventTypeDeployFailed,
			Message:      &message,
			DeploymentID: &deploymentID,
		})

		sendDeploymentWebhook(deployment, req.Status, message, deploymentID)

	case string(models.DeploymentStatusCancelled):
		message := "Service deployment cancelled"
		if req.Error != "" {
			message = req.Error
		}
		sendDeploymentWebhook(deployment, req.Status, message, deploymentID)

	case string(models.DeploymentStatusBuilding):
		sendDeploymentWebhook(deployment, req.Status, "Service is building", deploymentID)
	}

	// Reload deployment
	db.First(&deployment, "id = ?", deploymentID)

	return response.Success(c, fiber.Map{
		"deployment": deployment,
	})
}

// POST /api/webhooks/deployments/:deploymentId/logs
func UpdateLogs(c *fiber.Ctx) error {
	db := database.GetDatabase()

	deploymentID := c.Params("deploymentId")
	if deploymentID == "" {
		return response.BadRequest(c, "Deployment ID is required")
	}

	var req LogUpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if req.Text == "" {
		return response.BadRequest(c, "Logs are required")
	}

	// Find the deployment
	var deployment models.Deployment
	if err := db.Where("id = ?", deploymentID).First(&deployment).Error; err != nil {
		return response.NotFound(c, "Deployment not found")
	}

	// Determine the log type
	logType := req.Type
	if logType == "" {
		logType = "STDOUT"
	}

	// Create new log entry
	newLog := models.DeploymentLog{
		DeploymentID: deploymentID,
		Text:         req.Text,
		Type:         models.LogType(logType),
	}

	if err := db.Create(&newLog).Error; err != nil {
		return response.InternalServerError(c, "Failed to create log entry")
	}

	// Publish to Socket.IO via Redis
	publishDeploymentLog(deploymentID, newLog)

	return response.Success(c, fiber.Map{
		"message": "Logs updated successfully",
	})
}

// sendDeploymentWebhook sends a webhook notification for deployment status changes
func sendDeploymentWebhook(deployment models.Deployment, status, message, deploymentID string) {
	// Check if project has a deployment webhook configured
	if deployment.Service.Project.WebhookUrl == nil || *deployment.Service.Project.WebhookUrl == "" {
		return
	}

	webhookPayload := map[string]interface{}{
		"event":     "deployment_status_changed",
		"timestamp": time.Now().Format(time.RFC3339),
		"deployment": map[string]interface{}{
			"id":          deployment.ID,
			"status":      status,
			"message":     message,
			"createdAt":   deployment.CreatedAt,
			"completedAt": deployment.CompletedAt,
		},
		"service": map[string]interface{}{
			"id":   deployment.Service.ID,
			"name": deployment.Service.Name,
			"type": deployment.Service.ServiceTypeID,
		},
		"project": map[string]interface{}{
			"id":   deployment.Service.Project.ID,
			"name": deployment.Service.Project.Name,
		},
		"organization": map[string]interface{}{
			"id":   deployment.Service.Project.Organization.ID,
			"name": deployment.Service.Project.Organization.Name,
		},
	}

	go func() {
		client := &http.Client{Timeout: 10 * time.Second}

		// Generate a random delivery ID
		deliveryID := uuid.New().String()

		req, err := http.NewRequest("POST", *deployment.Service.Project.WebhookUrl, nil)
		if err != nil {
			log.Printf("Failed to create webhook request: %v", err)
			return
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "Deployra-Webhook/1.0")
		req.Header.Set("X-Deployra-Event", "deployment_status_changed")
		req.Header.Set("X-Deployra-Delivery", deliveryID)

		// Set body
		body, _ := json.Marshal(webhookPayload)
		req, err = http.NewRequest("POST", *deployment.Service.Project.WebhookUrl, bytes.NewBuffer(body))
		if err != nil {
			log.Printf("Failed to create webhook request: %v", err)
			return
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "Deployra-Webhook/1.0")
		req.Header.Set("X-Deployra-Event", "deployment_status_changed")
		req.Header.Set("X-Deployra-Delivery", deliveryID)

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("Failed to send deployment webhook: %v", err)
			return
		}
		defer resp.Body.Close()

		log.Printf("Webhook sent to %s - Status: %d", *deployment.Service.Project.WebhookUrl, resp.StatusCode)
	}()
}

// publishDeploymentLog publishes a deployment log to Socket.IO via Redis
func publishDeploymentLog(deploymentID string, logEntry models.DeploymentLog) {
	roomID := "deployment:" + deploymentID
	payload := map[string]interface{}{
		"event": "deployment_log",
		"payload": map[string]interface{}{
			"deploymentId": deploymentID,
			"type":         logEntry.Type,
			"text":         logEntry.Text,
			"timestamp":    logEntry.CreatedAt.Format("2006-01-02T15:04:05.000Z07:00"),
		},
	}

	if err := redis.PublishWebSocketMessage(context.Background(), roomID, payload); err != nil {
		log.Printf("Failed to publish deployment log to Socket.IO: %v", err)
	}
}
