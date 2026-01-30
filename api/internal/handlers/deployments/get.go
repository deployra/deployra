package deployments

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GetDeployment returns a single deployment
func GetDeployment(c *fiber.Ctx) error {
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

	// Fetch deployment with related data
	var deployment models.Deployment
	if err := db.Preload("Service.Project.Organization").
		Where("id = ?", deploymentID).
		First(&deployment).Error; err != nil {
		return response.NotFound(c, "Deployment not found")
	}

	// Fetch trigger user if exists
	var triggerUser *fiber.Map
	if deployment.TriggeredBy != nil {
		var user models.User
		if err := db.Select("id, firstName, lastName, email").
			Where("id = ?", *deployment.TriggeredBy).
			First(&user).Error; err == nil {
			triggerUser = &fiber.Map{
				"id":        user.ID,
				"firstName": user.FirstName,
				"lastName":  user.LastName,
				"email":     user.Email,
			}
		}
	}

	return response.Success(c, fiber.Map{
		"id":               deployment.ID,
		"serviceId":        deployment.ServiceID,
		"deploymentNumber": deployment.DeploymentNumber,
		"status":           deployment.Status,
		"commitSha":        deployment.CommitSha,
		"branch":           deployment.Branch,
		"triggeredBy":      deployment.TriggeredBy,
		"triggerType":      deployment.TriggerType,
		"startedAt":        deployment.StartedAt,
		"completedAt":      deployment.CompletedAt,
		"createdAt":        deployment.CreatedAt,
		"updatedAt":        deployment.UpdatedAt,
		"service": fiber.Map{
			"id":   deployment.Service.ID,
			"name": deployment.Service.Name,
			"project": fiber.Map{
				"id":   deployment.Service.Project.ID,
				"name": deployment.Service.Project.Name,
				"organization": fiber.Map{
					"id":   deployment.Service.Project.Organization.ID,
					"name": deployment.Service.Project.Organization.Name,
				},
			},
		},
		"triggerUser": triggerUser,
	})
}
