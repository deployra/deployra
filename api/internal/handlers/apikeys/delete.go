package apikeys

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// DELETE /api/api-keys/:apiKeyId
func Delete(c *fiber.Ctx) error {
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

	if err := db.Delete(&apiKey).Error; err != nil {
		return response.InternalServerError(c, "Failed to delete API key")
	}

	return response.Success(c, fiber.Map{
		"message": "API key deleted successfully",
	})
}
