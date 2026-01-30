package gitproviders

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/deployra/deployra/api/pkg/utils"
	"github.com/gofiber/fiber/v2"
)

// CreateProviderRequest represents the create provider request body
type CreateProviderRequest struct {
	Type           string `json:"type"`
	OrganizationID string `json:"organizationId"`
	URL            string `json:"url"`
	Username       string `json:"username"`
	Password       string `json:"password"`
}

// CreateProvider creates a custom git provider
func CreateProvider(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	var req CreateProviderRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate type
	if req.Type != string(models.GitProviderTypeCustom) {
		return response.BadRequest(c, "Invalid git provider type")
	}

	// Validate required fields
	if req.OrganizationID == "" || req.URL == "" || req.Username == "" || req.Password == "" {
		return response.BadRequest(c, "Organization ID, Git URL, username, and password are required")
	}

	// Check organization access
	var org models.Organization
	if err := db.Where("id = ? AND userId = ? AND deletedAt IS NULL", req.OrganizationID, user.ID).
		First(&org).Error; err != nil {
		return response.NotFound(c, "Organization not found")
	}

	// Create provider
	repoSelection := "all"
	provider := models.GitProvider{
		ID:                  utils.GenerateShortID(),
		OrganizationID:      req.OrganizationID,
		Type:                models.GitProviderTypeCustom,
		URL:                 &req.URL,
		Username:            &req.Username,
		Password:            &req.Password,
		RepositorySelection: &repoSelection,
	}

	if err := db.Create(&provider).Error; err != nil {
		return response.InternalServerError(c, "Failed to create git provider")
	}

	return response.Success(c, fiber.Map{
		"id":                  provider.ID,
		"organizationId":      provider.OrganizationID,
		"type":                provider.Type,
		"url":                 provider.URL,
		"username":            provider.Username,
		"repositorySelection": provider.RepositorySelection,
		"createdAt":           provider.CreatedAt,
		"updatedAt":           provider.UpdatedAt,
	})
}
