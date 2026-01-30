package projects

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

type UpdateProjectRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	WebhookUrl  *string `json:"webhookUrl"`
}

// POST /api/projects/:projectId
func Update(c *fiber.Ctx) error {
	db := database.GetDatabase()
	projectID := c.Params("projectId")

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	if projectID == "" {
		return response.BadRequest(c, "Project ID is required")
	}

	var req UpdateProjectRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate name if provided
	if req.Name != nil {
		if len(*req.Name) < 3 {
			return response.BadRequest(c, "Project name must be at least 3 characters")
		}
		if len(*req.Name) > 50 {
			return response.BadRequest(c, "Project name must be at most 50 characters")
		}
	}

	// Check access
	if !checkProjectAccess(user, projectID) {
		return response.Forbidden(c, "Project not found or access denied")
	}

	// Verify project exists
	var existingProject models.Project
	if err := db.Where("id = ? AND deletedAt IS NULL", projectID).
		First(&existingProject).Error; err != nil {
		return response.NotFound(c, "Project not found")
	}

	// Build updates
	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = req.Description
	}
	if req.WebhookUrl != nil {
		updates["webhookUrl"] = req.WebhookUrl
	}

	if len(updates) > 0 {
		if err := db.Model(&models.Project{}).Where("id = ?", projectID).Updates(updates).Error; err != nil {
			return response.InternalServerError(c, "Failed to update project")
		}
	}

	// Fetch updated project
	var updatedProject models.Project
	db.Preload("Organization").Where("id = ?", projectID).First(&updatedProject)

	return response.Success(c, updatedProject)
}
