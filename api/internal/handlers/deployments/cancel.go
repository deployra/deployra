package deployments

import (
	"fmt"
	"time"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	redisClient "github.com/deployra/deployra/api/internal/redis"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// CancelDeployment cancels a deployment
func CancelDeployment(c *fiber.Ctx) error {
	ctx := c.Context()
	db := database.GetDatabase()
	deploymentID := c.Params("deploymentId")

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	if deploymentID == "" {
		return response.BadRequest(c, "Deployment ID is required")
	}

	// Check access
	if !checkDeploymentAccess(user, deploymentID) {
		return response.Forbidden(c, "Deployment not found or access denied")
	}

	// Fetch deployment
	var deployment models.Deployment
	if err := db.Preload("Service").
		Where("id = ?", deploymentID).
		First(&deployment).Error; err != nil {
		return response.NotFound(c, "Deployment not found")
	}

	// Check if deployment can be cancelled
	if deployment.Status == models.DeploymentStatusDeployed ||
		deployment.Status == models.DeploymentStatusFailed ||
		deployment.Status == models.DeploymentStatusCancelled {
		return response.BadRequest(c, fmt.Sprintf("Deployment already %s, cannot cancel", deployment.Status))
	}

	// Try to remove from queue
	removedFromQueue, err := redisClient.RemoveDeploymentFromQueue(ctx, redisClient.QueueDeployment, deploymentID)
	if err != nil {
		fmt.Printf("Failed to remove deployment from queue: %v\n", err)
	}

	// Send cancellation signal
	if err := redisClient.PublishBuilderCancellation(ctx, deploymentID); err != nil {
		fmt.Printf("Failed to publish builder cancellation: %v\n", err)
	}

	// Update deployment status
	now := time.Now()
	if err := db.Model(&models.Deployment{}).
		Where("id = ?", deploymentID).
		Updates(map[string]interface{}{
			"status":      models.DeploymentStatusCancelled,
			"completedAt": &now,
		}).Error; err != nil {
		return response.InternalServerError(c, "Failed to cancel deployment")
	}

	// Create service event
	eventMessage := "Deployment cancellation signal sent to builders"
	if removedFromQueue {
		eventMessage = "Deployment cancelled before processing"
	}

	event := models.ServiceEvent{
		ServiceID:    deployment.ServiceID,
		Type:         models.EventTypeDeployCancelled,
		Message:      &eventMessage,
		DeploymentID: &deploymentID,
	}
	if err := db.Create(&event).Error; err != nil {
		fmt.Printf("Failed to create service event: %v\n", err)
	}

	return response.Success(c, fiber.Map{
		"message":          "Deployment cancelled successfully",
		"removedFromQueue": removedFromQueue,
	})
}
