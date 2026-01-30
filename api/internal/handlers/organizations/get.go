package organizations

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/organizations/:organizationId
func Get(c *fiber.Ctx) error {
	db := database.GetDatabase()
	organizationID := c.Params("organizationId")

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	if organizationID == "" {
		return response.BadRequest(c, "Organization ID is required")
	}

	// Check access
	if !checkOrganizationAccess(user, organizationID) {
		return response.Forbidden(c, "Organization not found or access denied")
	}

	var organization models.Organization
	if err := db.Where("id = ? AND deletedAt IS NULL", organizationID).
		First(&organization).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"status":  false,
			"message": "Organization not found",
		})
	}

	return c.JSON(fiber.Map{
		"status": true,
		"data":   organization,
	})
}
