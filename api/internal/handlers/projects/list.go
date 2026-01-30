package projects

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/projects?organizationId=xxx
func List(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	organizationID := c.Query("organizationId")
	if organizationID == "" {
		return response.BadRequest(c, "Organization ID is required")
	}

	// Check access
	if !checkOrganizationAccess(user, organizationID) {
		return response.Forbidden(c, "Organization not found or unauthorized access")
	}

	var projects []models.Project
	if err := db.Where("organizationId = ? AND deletedAt IS NULL", organizationID).
		Order("createdAt DESC").
		Find(&projects).Error; err != nil {
		return response.InternalServerError(c, "Failed to fetch projects")
	}

	return response.Success(c, projects)
}
