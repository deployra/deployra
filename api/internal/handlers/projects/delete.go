package projects

import (
	"time"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// DELETE /api/projects/:projectId
func Delete(c *fiber.Ctx) error {
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

	// Verify project exists and check for services
	var existingProject models.Project
	if err := db.Preload("Services", "deletedAt IS NULL").
		Where("id = ? AND deletedAt IS NULL", projectID).
		First(&existingProject).Error; err != nil {
		return response.NotFound(c, "Project not found")
	}

	// Check if project has active services
	if len(existingProject.Services) > 0 {
		return response.BadRequest(c, "Cannot delete project with existing services. Please delete all services first.")
	}

	// Soft delete project
	now := time.Now()
	if err := db.Model(&models.Project{}).Where("id = ?", projectID).Update("deletedAt", &now).Error; err != nil {
		return response.InternalServerError(c, "Failed to delete project")
	}

	return response.Success(c, fiber.Map{
		"message": "Project deleted successfully",
	})
}
