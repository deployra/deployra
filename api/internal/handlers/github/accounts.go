package github

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// ListAccounts returns GitHub accounts for an organization
func ListAccounts(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	organizationID := c.Query("organizationId")
	if organizationID == "" {
		return response.BadRequest(c, "Organization ID is required")
	}

	// Verify organization access
	var org models.Organization
	if err := db.Where("id = ? AND userId = ? AND deletedAt IS NULL", organizationID, user.ID).
		First(&org).Error; err != nil {
		return response.Forbidden(c, "Organization not found or unauthorized access")
	}

	// Fetch GitHub accounts
	var accounts []models.GithubAccount
	if err := db.Select("id, username, email, avatarUrl, createdAt, updatedAt").
		Where("organizationId = ? AND deletedAt IS NULL", organizationID).
		Order("createdAt ASC").
		Find(&accounts).Error; err != nil {
		return response.InternalServerError(c, "Failed to fetch GitHub accounts")
	}

	// Format response
	result := make([]fiber.Map, 0, len(accounts))
	for _, acc := range accounts {
		result = append(result, fiber.Map{
			"id":        acc.ID,
			"username":  acc.Username,
			"email":     acc.Email,
			"avatarUrl": acc.AvatarUrl,
			"createdAt": acc.CreatedAt,
			"updatedAt": acc.UpdatedAt,
		})
	}

	return response.Success(c, result)
}
