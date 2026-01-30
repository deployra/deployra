package apikeys

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/api-keys
func List(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	var apiKeys []models.ApiKey
	if err := db.Where("userId = ?", user.ID).Order("createdAt DESC").Find(&apiKeys).Error; err != nil {
		return response.InternalServerError(c, "Failed to fetch API keys")
	}

	// Mask keys
	result := make([]fiber.Map, len(apiKeys))
	for i, key := range apiKeys {
		result[i] = fiber.Map{
			"id":         key.ID,
			"name":       key.Name,
			"key":        maskKey(key.Key),
			"createdAt":  key.CreatedAt,
			"updatedAt":  key.UpdatedAt,
			"expiresAt":  key.ExpiresAt,
			"lastUsedAt": key.LastUsedAt,
			"revoked":    key.Revoked,
		}
	}

	return response.Success(c, result)
}
