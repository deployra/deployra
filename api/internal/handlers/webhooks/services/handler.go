package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/redis"
	"github.com/deployra/deployra/api/internal/utils"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// StatusUpdateRequest represents the service status update request
type StatusUpdateRequest struct {
	Status string `json:"status"`
}

// ReplicaCountRequest represents the replica count update request
type ReplicaCountRequest struct {
	CurrentReplicas int     `json:"currentReplicas"`
	TargetReplicas  int     `json:"targetReplicas"`
	DeploymentID    *string `json:"deploymentId,omitempty"`
	ScalingReason   *string `json:"scalingReason,omitempty"`
	ScalingMessage  *string `json:"scalingMessage,omitempty"`
	Timestamp       string  `json:"timestamp"`
}

// PodEventRequest represents a pod event
type PodEventRequest struct {
	EventType            string  `json:"eventType"` // ADDED, MODIFIED, DELETED
	PodID                string  `json:"podId"`
	DeploymentID         *string `json:"deploymentId,omitempty"`
	Phase                string  `json:"phase"`
	ContainerState       *string `json:"containerState,omitempty"`
	ContainerStateReason *string `json:"containerStateReason,omitempty"`
	Timestamp            string  `json:"timestamp"`
}

// POST /api/webhooks/services/:serviceId/status
func UpdateStatus(c *fiber.Ctx) error {
	db := database.GetDatabase()

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	var req StatusUpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if req.Status == "" {
		return response.BadRequest(c, "Status is required")
	}

	// Find the service
	var service models.Service
	if err := db.Where("id = ?", serviceID).First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Update the service status
	if err := db.Model(&models.Service{}).Where("id = ?", serviceID).Updates(map[string]interface{}{
		"status":    req.Status,
		"updatedAt": time.Now(),
	}).Error; err != nil {
		return response.InternalServerError(c, "Failed to update service status")
	}

	return response.Success(c, fiber.Map{
		"service": service,
	})
}

// POST /api/webhooks/services/:serviceId/replicas
func UpdateReplicas(c *fiber.Ctx) error {
	db := database.GetDatabase()
	ctx := context.Background()

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	var req ReplicaCountRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Acquire Redis lock for this service
	lockKey := fmt.Sprintf("service-replica-lock:%s", serviceID)
	lockAcquired, err := redis.AcquireLock(ctx, lockKey, 30)
	if err != nil {
		return response.InternalServerError(c, "Failed to acquire lock")
	}
	if !lockAcquired {
		return response.TooManyRequests(c, "Another update is in progress for this service")
	}
	defer redis.ReleaseLock(ctx, lockKey)

	// Get the service
	var service models.Service
	if err := db.Preload("InstanceType").
		Where("id = ?", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Get last scaling history
	var lastScalingHistory models.ServiceScalingHistory
	hasLastHistory := db.Where("serviceId = ?", serviceID).
		Order("createdAt DESC").
		First(&lastScalingHistory).Error == nil

	beginScaling := service.ScalingStatus == "IDLE" && req.TargetReplicas != service.TargetReplicas
	endScaling := service.ScalingStatus == "SCALING" && req.CurrentReplicas == service.TargetReplicas

	fixedCurrentReplicas := req.CurrentReplicas
	if req.CurrentReplicas > req.TargetReplicas {
		fixedCurrentReplicas = req.TargetReplicas
	}

	currentReplicasChanged := service.CurrentReplicas != fixedCurrentReplicas

	scaleToZero := req.CurrentReplicas == 0 || req.TargetReplicas == 0
	scaleToOne := req.CurrentReplicas == 1 && req.TargetReplicas == 1

	// Determine new scaling status
	newScalingStatus := service.ScalingStatus
	if beginScaling {
		newScalingStatus = "SCALING"
	} else if endScaling {
		newScalingStatus = "IDLE"
	}

	// Update the service
	if err := db.Model(&models.Service{}).Where("id = ?", serviceID).Updates(map[string]interface{}{
		"currentReplicas": fixedCurrentReplicas,
		"targetReplicas":  req.TargetReplicas,
		"scalingStatus":   newScalingStatus,
	}).Error; err != nil {
		return response.InternalServerError(c, "Failed to update service replicas")
	}

	// Create scaling history record if current replicas changed
	if !hasLastHistory || currentReplicasChanged {
		db.Create(&models.ServiceScalingHistory{
			ServiceID:      serviceID,
			DeploymentID:   req.DeploymentID,
			ReplicaCount:   fixedCurrentReplicas,
			InstanceTypeID: service.InstanceTypeID,
		})
	}

	// Create SERVICE_SCALING event only when scaling is first starting
	if beginScaling && !scaleToZero && !scaleToOne {
		scalingReason := "UNKNOWN"
		if req.ScalingReason != nil {
			scalingReason = *req.ScalingReason
		}
		payload, _ := json.Marshal(map[string]interface{}{
			"previousReplicas": service.CurrentReplicas,
			"currentReplicas":  req.CurrentReplicas,
			"targetReplicas":   req.TargetReplicas,
			"scalingReason":    scalingReason,
			"scalingMessage":   req.ScalingMessage,
		})
		db.Create(&models.ServiceEvent{
			ServiceID:    serviceID,
			Type:         models.EventTypeServiceScaling,
			Message:      utils.Ptr(fmt.Sprintf("Scaling service from %d to %d replicas", req.CurrentReplicas, req.TargetReplicas)),
			DeploymentID: req.DeploymentID,
			Payload:      payload,
		})
	}

	// Create SERVICE_SCALED event only when scaling has just completed
	if endScaling && !scaleToZero && !scaleToOne {
		scalingReason := "UNKNOWN"
		if req.ScalingReason != nil {
			scalingReason = *req.ScalingReason
		}
		payload, _ := json.Marshal(map[string]interface{}{
			"previousReplicas": service.CurrentReplicas,
			"currentReplicas":  req.CurrentReplicas,
			"scalingReason":    scalingReason,
			"scalingMessage":   req.ScalingMessage,
		})
		db.Create(&models.ServiceEvent{
			ServiceID:    serviceID,
			Type:         models.EventTypeServiceScaled,
			Message:      utils.Ptr(fmt.Sprintf("Service scaled to %d replicas", req.CurrentReplicas)),
			DeploymentID: req.DeploymentID,
			Payload:      payload,
		})
	}

	return response.Success(c, fiber.Map{
		"serviceId":       serviceID,
		"currentReplicas": fixedCurrentReplicas,
	})
}

// POST /api/webhooks/services/:serviceId/pods
func HandlePodEvent(c *fiber.Ctx) error {
	db := database.GetDatabase()

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	var req PodEventRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Find the service
	var service models.Service
	if err := db.Where("id = ?", serviceID).First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Map phase and container state
	mappedPhase := mapToPodPhase(req.Phase)
	var mappedContainerState *models.ContainerState
	var mappedContainerStateReason *models.ContainerStateReason

	if req.ContainerState != nil {
		state := mapToContainerState(*req.ContainerState)
		mappedContainerState = &state
	}

	if req.ContainerStateReason != nil {
		reason := mapToContainerStateReason(*req.ContainerStateReason)
		mappedContainerStateReason = &reason
	}

	// Parse timestamp
	timestamp, err := time.Parse(time.RFC3339, req.Timestamp)
	if err != nil {
		timestamp = time.Now()
	}

	// Check if pod tracking exists
	var existing models.PodTracking
	err = db.Where("podId = ? AND serviceId = ?", req.PodID, serviceID).First(&existing).Error

	if err != nil {
		// Create new pod tracking
		var endTime *time.Time
		if req.EventType == "DELETED" {
			endTime = &timestamp
		}

		db.Create(&models.PodTracking{
			PodID:                req.PodID,
			ServiceID:            serviceID,
			DeploymentID:         req.DeploymentID,
			InstanceTypeID:       service.InstanceTypeID,
			Phase:                mappedPhase,
			ContainerState:       mappedContainerState,
			ContainerStateReason: mappedContainerStateReason,
			StartTime:            time.Now(),
			EndTime:              endTime,
		})
	} else {
		// Update existing pod tracking
		updates := map[string]interface{}{
			"phase":                mappedPhase,
			"containerState":       mappedContainerState,
			"containerStateReason": mappedContainerStateReason,
			"updatedAt":            time.Now(),
		}

		if req.EventType == "DELETED" {
			updates["endTime"] = timestamp
		}

		db.Model(&models.PodTracking{}).Where("podId = ? AND serviceId = ?", req.PodID, serviceID).Updates(updates)
	}

	return response.Success(c, fiber.Map{
		"status": "success",
	})
}

func mapToPodPhase(phase string) models.PodPhase {
	switch strings.ToLower(phase) {
	case "pending":
		return models.PodPhasePending
	case "running":
		return models.PodPhaseRunning
	case "succeeded":
		return models.PodPhaseSucceeded
	case "failed":
		return models.PodPhaseFailed
	default:
		return models.PodPhaseUnknown
	}
}

func mapToContainerState(state string) models.ContainerState {
	switch strings.ToLower(state) {
	case "waiting":
		return models.ContainerStateWaiting
	case "running":
		return models.ContainerStateRunning
	case "terminated":
		return models.ContainerStateTerminated
	default:
		return models.ContainerStateWaiting
	}
}

func mapToContainerStateReason(reason string) models.ContainerStateReason {
	cleanReason := strings.ToLower(strings.ReplaceAll(reason, " ", ""))

	switch cleanReason {
	case "crashloopbackoff":
		return models.ContainerStateReasonCrashLoopBackOff
	case "imagepullbackoff":
		return models.ContainerStateReasonImagePullBackOff
	case "errimagepull":
		return models.ContainerStateReasonErrImagePull
	case "containercreating":
		return models.ContainerStateReasonContainerCreating
	case "podinitializing":
		return models.ContainerStateReasonPodInitializing
	case "oomkilled":
		return models.ContainerStateReasonOOMKilled
	case "completed":
		return models.ContainerStateReasonCompleted
	case "error":
		return models.ContainerStateReasonError
	case "terminating":
		return models.ContainerStateReasonTerminating
	case "createcontainererror":
		return models.ContainerStateReasonCreateContainerError
	default:
		return models.ContainerStateReasonError
	}
}

