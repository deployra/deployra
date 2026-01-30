package projects

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/projects/:projectId
func Get(c *fiber.Ctx) error {
	db := database.GetDatabase()
	projectID := c.Params("projectId")

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	if projectID == "" {
		return response.BadRequest(c, "Project ID is required")
	}

	// Check access
	if !checkProjectAccess(user, projectID) {
		return response.Forbidden(c, "Project not found or access denied")
	}

	var project models.Project
	if err := db.Preload("Organization").
		Where("id = ? AND deletedAt IS NULL", projectID).
		First(&project).Error; err != nil {
		return response.NotFound(c, "Project not found")
	}

	return response.Success(c, project)
}
