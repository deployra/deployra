package gitproviders

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// ListProviders returns all git providers for an organization
func ListProviders(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	organizationID := c.Query("organizationId")
	if organizationID == "" {
		return response.BadRequest(c, "Organization ID is required")
	}

	// Check access
	if !checkOrganizationAccess(user, organizationID) {
		return response.Forbidden(c, "Organization not found or access denied")
	}

	// Fetch git providers
	var providers []models.GitProvider
	if err := db.Preload("GithubAccount").
		Where("organizationId = ? AND deletedAt IS NULL", organizationID).
		Order("createdAt DESC").
		Find(&providers).Error; err != nil {
		return response.InternalServerError(c, "Failed to fetch git providers")
	}

	// Format response (remove password)
	result := make([]fiber.Map, 0, len(providers))
	for _, p := range providers {
		item := fiber.Map{
			"id":                  p.ID,
			"organizationId":      p.OrganizationID,
			"type":                p.Type,
			"githubAccountId":     p.GithubAccountID,
			"installationId":      p.InstallationID,
			"repositorySelection": p.RepositorySelection,
			"url":                 p.URL,
			"username":            p.Username,
			"createdAt":           p.CreatedAt,
			"updatedAt":           p.UpdatedAt,
		}

		if p.GithubAccount != nil {
			item["githubAccount"] = fiber.Map{
				"username":  p.GithubAccount.Username,
				"avatarUrl": p.GithubAccount.AvatarUrl,
			}
		}

		result = append(result, item)
	}

	return response.Success(c, result)
}
