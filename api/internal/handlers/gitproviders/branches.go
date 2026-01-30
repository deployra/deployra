package gitproviders

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/github"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// ListBranches returns branches for a repository
func ListBranches(c *fiber.Ctx) error {
	db := database.GetDatabase()
	providerID := c.Params("providerId")
	repoFullName := c.Params("repoFullName")
	ctx := context.Background()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	if providerID == "" {
		return response.BadRequest(c, "Provider ID is required")
	}

	if repoFullName == "" {
		return response.BadRequest(c, "Repository name is required")
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

	// Parse repo name
	parts := strings.Split(repoFullName, "/")
	if len(parts) != 2 {
		return response.BadRequest(c, "Invalid repository name format. Expected format: owner/repo")
	}
	owner, repo := parts[0], parts[1]

	var branches []github.Branch

	if provider.Type == models.GitProviderTypeGitHub {
		if provider.GithubAccount == nil {
			return response.NotFound(c, "GitHub account not found for this provider")
		}

		var client *github.Client
		var err error

		if provider.InstallationID != nil && *provider.InstallationID != "" {
			// GitHub App installation
			installationID, parseErr := strconv.ParseInt(*provider.InstallationID, 10, 64)
			if parseErr != nil {
				return response.BadRequest(c, "Invalid installation ID")
			}

			client, err = github.NewClientWithInstallation(ctx, installationID)
			if err != nil {
				fmt.Printf("Failed to create installation client: %v\n", err)
				return response.Unauthorized(c, "Failed to authenticate with GitHub App installation")
			}
		} else {
			// Personal access token - ensure token is valid and refresh if needed
			validAccount, refreshErr := github.EnsureValidGithubToken(provider.GithubAccount.ID)
			if refreshErr != nil {
				fmt.Printf("Failed to ensure valid GitHub token: %v\n", refreshErr)
				return response.Unauthorized(c, "Failed to authenticate with GitHub: "+refreshErr.Error())
			}
			client = github.NewClientWithToken(ctx, validAccount.AccessToken)
		}

		branches, err = client.ListBranches(ctx, owner, repo)
		if err != nil {
			fmt.Printf("Failed to list branches: %v\n", err)
			return response.InternalServerError(c, "Failed to fetch branches")
		}
	}

	return response.Success(c, branches)
}
