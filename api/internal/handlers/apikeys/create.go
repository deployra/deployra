package apikeys

import (
	"strings"
	"time"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

type CreateApiKeyRequest struct {
	Name      string  `json:"name"`
	ExpiresAt *string `json:"expiresAt"`
}

func generateApiKey() string {
	return "dk_" + strings.ReplaceAll(uuid.New().String(), "-", "")
}

// POST /api/api-keys
func Create(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	var req CreateApiKeyRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate
	if len(req.Name) < 3 {
		return response.BadRequest(c, "API key name must be at least 3 characters")
	}
	if len(req.Name) > 50 {
		return response.BadRequest(c, "API key name must be at most 50 characters")
	}

	// Parse expiresAt if provided
	var expiresAt *time.Time
	if req.ExpiresAt != nil {
		parsed, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil {
			return response.BadRequest(c, "Invalid expiresAt format")
		}
		expiresAt = &parsed
	}

	// Generate API key
	apiKeyValue := generateApiKey()

	// Create API key
	apiKey := models.ApiKey{
		ID:        uuid.New().String(),
		Name:      req.Name,
		Key:       apiKeyValue,
		UserID:    user.ID,
		ExpiresAt: expiresAt,
	}

	if err := db.Create(&apiKey).Error; err != nil {
		return response.InternalServerError(c, "Failed to create API key")
	}

	return response.Success(c, fiber.Map{
		"id":        apiKey.ID,
		"name":      apiKey.Name,
		"key":       apiKey.Key, // Full key only on creation
		"createdAt": apiKey.CreatedAt,
		"expiresAt": apiKey.ExpiresAt,
	})
}
