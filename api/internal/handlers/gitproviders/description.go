package gitproviders

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/github"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/transport/http"
	"github.com/gofiber/fiber/v2"
)

// DescriptionRequest represents the repository description request body
type DescriptionRequest struct {
	RepositoryName string `json:"repositoryName"`
	Branch         string `json:"branch"`
	DockerfilePath string `json:"dockerfilePath"`
}

// GetRepositoryDescription analyzes a repository
func GetRepositoryDescription(c *fiber.Ctx) error {
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

	var req DescriptionRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if req.RepositoryName == "" {
		return response.BadRequest(c, "Repository name is required")
	}

	if req.Branch == "" {
		return response.BadRequest(c, "Branch name is required")
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
	parts := strings.Split(req.RepositoryName, "/")
	if len(parts) != 2 {
		return response.BadRequest(c, "Invalid repository name format. Expected format: owner/repo")
	}
	owner, repo := parts[0], parts[1]

	var desc *github.RepoDescription

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

		desc, err = client.GetRepoDescription(ctx, owner, repo, req.Branch, req.DockerfilePath)
		if err != nil {
			fmt.Printf("Failed to get repo description: %v\n", err)
			return response.InternalServerError(c, "Failed to fetch data from GitHub API")
		}
	} else if provider.Type == models.GitProviderTypeCustom {
		// For custom providers, clone the repo to check for files
		if provider.Password == nil || provider.URL == nil || provider.Username == nil {
			return response.BadRequest(c, "Missing required Git provider credentials")
		}

		// Create a temporary directory
		randomBytes := make([]byte, 8)
		rand.Read(randomBytes)
		tempDir := filepath.Join(os.TempDir(), "git-repo-"+hex.EncodeToString(randomBytes))
		if err := os.MkdirAll(tempDir, 0755); err != nil {
			return response.InternalServerError(c, "Failed to create temporary directory")
		}
		defer os.RemoveAll(tempDir)

		// Construct the Git URL with authentication
		parsedURL, err := url.Parse(*provider.URL)
		if err != nil {
			return response.BadRequest(c, "Invalid Git provider URL")
		}
		gitURL := fmt.Sprintf("%s/%s/%s.git", parsedURL.String(), owner, repo)

		// Clone the repository
		_, err = git.PlainClone(tempDir, false, &git.CloneOptions{
			URL:           gitURL,
			ReferenceName: plumbing.NewBranchReferenceName(req.Branch),
			Depth:         1,
			Auth: &http.BasicAuth{
				Username: *provider.Username,
				Password: *provider.Password,
			},
		})
		if err != nil {
			fmt.Printf("Failed to clone repository: %v\n", err)
			return response.InternalServerError(c, "Failed to fetch data from custom Git provider")
		}

		desc = &github.RepoDescription{
			Languages:     make(map[string]int),
			HasDockerfile: false,
			HasProcfile:   false,
			DefaultBranch: req.Branch,
		}

		// Check if Dockerfile exists
		dockerfilePath := req.DockerfilePath
		if dockerfilePath == "" {
			dockerfilePath = "Dockerfile"
		}
		if _, err := os.Stat(filepath.Join(tempDir, dockerfilePath)); err == nil {
			desc.HasDockerfile = true
		}

		// Check if Procfile exists
		if _, err := os.Stat(filepath.Join(tempDir, "Procfile")); err == nil {
			desc.HasProcfile = true
		}

		// Detect languages based on common files
		if _, err := os.Stat(filepath.Join(tempDir, "package.json")); err == nil {
			desc.Languages["JavaScript"] = 1
		}
		if _, err := os.Stat(filepath.Join(tempDir, "go.mod")); err == nil {
			desc.Languages["Go"] = 1
		}
		if _, err := os.Stat(filepath.Join(tempDir, "requirements.txt")); err == nil {
			desc.Languages["Python"] = 1
		}
		if _, err := os.Stat(filepath.Join(tempDir, "Gemfile")); err == nil {
			desc.Languages["Ruby"] = 1
		}
	}

	return response.Success(c, desc)
}
