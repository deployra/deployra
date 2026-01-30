package gitproviders

import (
	"time"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// DeleteProvider deletes a git provider
func DeleteProvider(c *fiber.Ctx) error {
	db := database.GetDatabase()
	providerID := c.Params("providerId")

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	if providerID == "" {
		return response.BadRequest(c, "Provider ID is required")
	}

	// Check access
	if !checkGitProviderAccess(user, providerID) {
		return response.Forbidden(c, "Git provider not found or access denied")
	}

	// Find provider
	var provider models.GitProvider
	if err := db.Where("id = ? AND deletedAt IS NULL", providerID).
		First(&provider).Error; err != nil {
		return response.NotFound(c, "Git provider not found")
	}

	now := time.Now()

	// Soft delete provider
	if err := db.Model(&provider).Update("deletedAt", &now).Error; err != nil {
		return response.InternalServerError(c, "Failed to delete git provider")
	}

	// Soft delete associated GitHub account if exists
	if provider.GithubAccountID != nil {
		db.Model(&models.GithubAccount{}).
			Where("id = ?", *provider.GithubAccountID).
			Update("deletedAt", &now)
	}

	return response.Success(c, fiber.Map{
		"message": "Git provider deleted successfully",
	})
}
