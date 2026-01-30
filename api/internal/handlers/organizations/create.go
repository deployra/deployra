package organizations

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/deployra/deployra/api/pkg/utils"
	"github.com/gofiber/fiber/v2"
)

type CreateOrganizationRequest struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
}

// POST /api/organizations
func Create(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	var req CreateOrganizationRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if req.Name == "" {
		return response.BadRequest(c, "Organization name is required")
	}

	// Check if organization with same name already exists for this user
	var existingOrg models.Organization
	if err := db.Where("userId = ? AND name = ? AND deletedAt IS NULL", user.ID, req.Name).
		First(&existingOrg).Error; err == nil {
		return response.BadRequest(c, "Organization already exists")
	}

	organization := models.Organization{
		ID:          utils.GenerateShortID(),
		UserID:      user.ID,
		Name:        req.Name,
		Description: req.Description,
	}

	if err := db.Create(&organization).Error; err != nil {
		return response.InternalServerError(c, "Failed to create organization")
	}

	return response.Success(c, organization)
}
