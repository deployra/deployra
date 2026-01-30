package deployments

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GetDeploymentLogs returns deployment logs
func GetDeploymentLogs(c *fiber.Ctx) error {
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

	// Check if deployment exists
	var deployment models.Deployment
	if err := db.Where("id = ?", deploymentID).First(&deployment).Error; err != nil {
		return response.NotFound(c, "Deployment not found")
	}

	// Fetch logs
	var logs []models.DeploymentLog
	if err := db.Where("deploymentId = ?", deploymentID).
		Order("createdAt ASC").
		Find(&logs).Error; err != nil {
		return response.InternalServerError(c, "Failed to retrieve deployment logs")
	}

	return response.Success(c, fiber.Map{
		"logs": logs,
	})
}
