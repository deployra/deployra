package organizations

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/organizations
func List(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	var organizations []models.Organization

	if err := db.Where("deletedAt IS NULL AND userId = ?", user.ID).
		Order("createdAt DESC").Find(&organizations).Error; err != nil {
		return response.InternalServerError(c, "Failed to fetch organizations")
	}

	return response.Success(c, organizations)
}
