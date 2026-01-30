package gitproviders

import (
	"context"
	"fmt"
	"strconv"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/github"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// ListRepositories returns repositories for a git provider
func ListRepositories(c *fiber.Ctx) error {
	db := database.GetDatabase()
	providerID := c.Params("providerId")
	ctx := context.Background()

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

	// Find provider with GitHub account
	var provider models.GitProvider
	if err := db.Preload("GithubAccount").
		Where("id = ? AND deletedAt IS NULL", providerID).
		First(&provider).Error; err != nil {
		return response.NotFound(c, "Git provider not found")
	}

	var repos []github.Repository

	if provider.Type == models.GitProviderTypeGitHub {
		if provider.GithubAccount == nil {
			return response.NotFound(c, "GitHub account not found for this provider")
		}

		if provider.InstallationID != nil && *provider.InstallationID != "" {
			// GitHub App installation
			installationID, err := strconv.ParseInt(*provider.InstallationID, 10, 64)
			if err != nil {
				return response.BadRequest(c, "Invalid installation ID")
			}

			repos, err = github.ListRepositoriesForInstallation(ctx, installationID)
			if err != nil {
				fmt.Printf("Failed to list installation repos: %v\n", err)
				return response.Unauthorized(c, "Failed to authenticate with GitHub App installation")
			}
		} else {
			// Personal access token - ensure token is valid and refresh if needed
			validAccount, err := github.EnsureValidGithubToken(provider.GithubAccount.ID)
			if err != nil {
				fmt.Printf("Failed to ensure valid GitHub token: %v\n", err)
				return response.Unauthorized(c, "Failed to authenticate with GitHub: "+err.Error())
			}

			repos, err = github.ListRepositoriesForUser(ctx, validAccount.AccessToken)
			if err != nil {
				fmt.Printf("Failed to list user repos: %v\n", err)
				return response.Unauthorized(c, "Failed to authenticate with GitHub")
			}
		}
	} else if provider.Type == models.GitProviderTypeCustom {
		// Custom providers not supported for repo listing
		repos = []github.Repository{}
	}

	return response.Success(c, repos)
}
