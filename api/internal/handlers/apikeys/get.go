package apikeys

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/api-keys/:apiKeyId
func Get(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	apiKeyId := c.Params("apiKeyId")

	var apiKey models.ApiKey
	if err := db.Where("id = ? AND userId = ?", apiKeyId, user.ID).First(&apiKey).Error; err != nil {
		return response.NotFound(c, "API key not found or unauthorized access")
	}

	return response.Success(c, fiber.Map{
		"id":         apiKey.ID,
		"name":       apiKey.Name,
		"key":        maskKey(apiKey.Key),
		"createdAt":  apiKey.CreatedAt,
		"updatedAt":  apiKey.UpdatedAt,
		"expiresAt":  apiKey.ExpiresAt,
		"lastUsedAt": apiKey.LastUsedAt,
		"revoked":    apiKey.Revoked,
	})
}
