package github

import (
	"bytes"
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/deployra/deployra/api/internal/config"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/golang-jwt/jwt/v5"
	gh "github.com/google/go-github/v57/github"
	"golang.org/x/oauth2"
)

// Repository represents a GitHub repository
type Repository struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	FullName      string `json:"fullName"`
	Private       bool   `json:"private"`
	Description   string `json:"description"`
	DefaultBranch string `json:"defaultBranch"`
	URL           string `json:"url"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

// Branch represents a GitHub branch
type Branch struct {
	Name      string `json:"name"`
	Protected bool   `json:"protected"`
	CommitSha string `json:"commitSha"`
	URL       string `json:"url"`
}

// RepoDescription represents repository analysis
type RepoDescription struct {
	Languages     map[string]int `json:"languages"`
	HasDockerfile bool           `json:"hasDockerfile"`
	HasProcfile   bool           `json:"hasProcfile"`
	DefaultBranch string         `json:"defaultBranch"`
}

// Client wraps the GitHub client
type Client struct {
	client *gh.Client
}

// NewClientWithToken creates a GitHub client with a personal access token
func NewClientWithToken(ctx context.Context, token string) *Client {
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})
	tc := oauth2.NewClient(ctx, ts)
	return &Client{client: gh.NewClient(tc)}
}

// NewClientWithInstallation creates a GitHub client with an installation token
func NewClientWithInstallation(ctx context.Context, installationID int64) (*Client, error) {
	cfg := config.Get()

	if cfg.GitHubAppID == "" || cfg.GitHubAppPrivateKey == "" {
		return nil, fmt.Errorf("GitHub App configuration missing")
	}

	// Get installation token
	token, err := getInstallationToken(ctx, installationID)
	if err != nil {
		return nil, fmt.Errorf("failed to get installation token: %w", err)
	}

	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})
	tc := oauth2.NewClient(ctx, ts)
	return &Client{client: gh.NewClient(tc)}, nil
}

// getInstallationToken gets an installation access token from GitHub
func getInstallationToken(ctx context.Context, installationID int64) (string, error) {
	cfg := config.Get()

	// Parse private key
	privateKey, err := parsePrivateKey(cfg.GitHubAppPrivateKey)
	if err != nil {
		return "", fmt.Errorf("failed to parse private key: %w", err)
	}

	// Create JWT
	now := time.Now()
	claims := jwt.MapClaims{
		"iat": now.Unix(),
		"exp": now.Add(10 * time.Minute).Unix(),
		"iss": cfg.GitHubAppID,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	jwtToken, err := token.SignedString(privateKey)
	if err != nil {
		return "", fmt.Errorf("failed to sign JWT: %w", err)
	}

	// Exchange JWT for installation token
	req, err := http.NewRequestWithContext(ctx, "POST",
		fmt.Sprintf("https://api.github.com/app/installations/%d/access_tokens", installationID),
		nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to request installation token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("failed to get installation token: status %d", resp.StatusCode)
	}

	var result struct {
		Token string `json:"token"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Token, nil
}

// parsePrivateKey parses a PEM encoded RSA private key
func parsePrivateKey(key string) (*rsa.PrivateKey, error) {
	// Replace escaped newlines
	key = strings.ReplaceAll(key, "\\n", "\n")

	block, _ := pem.Decode([]byte(key))
	if block == nil {
		return nil, fmt.Errorf("failed to parse PEM block")
	}

	privateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		// Try PKCS8
		key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %w", err)
		}
		rsaKey, ok := key.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("private key is not RSA")
		}
		return rsaKey, nil
	}

	return privateKey, nil
}

// ListRepositoriesForInstallation lists repositories for a GitHub App installation
func ListRepositoriesForInstallation(ctx context.Context, installationID int64) ([]Repository, error) {
	client, err := NewClientWithInstallation(ctx, installationID)
	if err != nil {
		return nil, err
	}

	repos, _, err := client.client.Apps.ListRepos(ctx, &gh.ListOptions{PerPage: 100})
	if err != nil {
		return nil, fmt.Errorf("failed to list repos: %w", err)
	}

	result := make([]Repository, 0, len(repos.Repositories))
	for _, repo := range repos.Repositories {
		result = append(result, Repository{
			ID:            fmt.Sprintf("%d", repo.GetID()),
			Name:          repo.GetName(),
			FullName:      repo.GetFullName(),
			Private:       repo.GetPrivate(),
			Description:   repo.GetDescription(),
			DefaultBranch: repo.GetDefaultBranch(),
			URL:           repo.GetHTMLURL(),
			CreatedAt:     repo.GetCreatedAt().Format(time.RFC3339),
			UpdatedAt:     repo.GetUpdatedAt().Format(time.RFC3339),
		})
	}

	return result, nil
}

// tokenRefreshResponse represents the response from GitHub OAuth token refresh
type tokenRefreshResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

// EnsureValidGithubToken checks if a GitHub token is expired and refreshes it if needed
// Returns the GithubAccount with a valid token
func EnsureValidGithubToken(githubAccountID string) (*models.GithubAccount, error) {
	db := database.GetDatabase()
	cfg := config.Get()

	// Get the GitHub account
	var githubAccount models.GithubAccount
	if err := db.Where("id = ?", githubAccountID).First(&githubAccount).Error; err != nil {
		return nil, fmt.Errorf("GitHub account not found: %s", githubAccountID)
	}

	// Check if token is expired
	now := time.Now()
	isExpired := githubAccount.ExpiresAt != nil && githubAccount.ExpiresAt.Before(now)

	// If token is not expired, return the account
	if !isExpired {
		return &githubAccount, nil
	}

	// If no refresh token, we can't refresh
	if githubAccount.RefreshToken == nil || *githubAccount.RefreshToken == "" {
		return nil, fmt.Errorf("GitHub token expired and no refresh token available for account: %s", githubAccountID)
	}

	log.Printf("GitHub token expired, refreshing...")

	// Refresh the token
	requestBody, _ := json.Marshal(map[string]string{
		"client_id":     cfg.GitHubClientID,
		"client_secret": cfg.GitHubClientSecret,
		"refresh_token": *githubAccount.RefreshToken,
		"grant_type":    "refresh_token",
	})

	req, err := http.NewRequest("POST", "https://github.com/login/oauth/access_token", bytes.NewBuffer(requestBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create refresh request: %w", err)
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to refresh token: %w", err)
	}
	defer resp.Body.Close()

	var tokenData tokenRefreshResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenData); err != nil {
		return nil, fmt.Errorf("failed to decode token response: %w", err)
	}

	if tokenData.Error != "" {
		return nil, fmt.Errorf("failed to refresh GitHub token: %s - %s", tokenData.Error, tokenData.ErrorDesc)
	}

	if tokenData.AccessToken == "" {
		return nil, fmt.Errorf("failed to refresh GitHub token: no access token in response")
	}

	// Calculate new expiry (GitHub tokens expire after 6 hours)
	expiresAt := time.Now().Add(6 * time.Hour)

	// Update the account with the new token
	updates := map[string]interface{}{
		"accessToken": tokenData.AccessToken,
		"expiresAt":   expiresAt,
		"updatedAt":   time.Now(),
	}

	// Update refresh token if a new one was provided
	if tokenData.RefreshToken != "" {
		updates["refreshToken"] = tokenData.RefreshToken
	}

	if err := db.Model(&githubAccount).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("failed to update GitHub account with new token: %w", err)
	}

	// Refresh the account from DB
	if err := db.Where("id = ?", githubAccountID).First(&githubAccount).Error; err != nil {
		return nil, fmt.Errorf("failed to reload GitHub account: %w", err)
	}

	log.Printf("GitHub token refreshed successfully")

	return &githubAccount, nil
}

// ListRepositoriesForUser lists repositories for an authenticated user
func ListRepositoriesForUser(ctx context.Context, token string) ([]Repository, error) {
	client := NewClientWithToken(ctx, token)

	repos, _, err := client.client.Repositories.List(ctx, "", &gh.RepositoryListOptions{
		ListOptions: gh.ListOptions{PerPage: 100},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list repos: %w", err)
	}

	result := make([]Repository, 0, len(repos))
	for _, repo := range repos {
		result = append(result, Repository{
			ID:            fmt.Sprintf("%d", repo.GetID()),
			Name:          repo.GetName(),
			FullName:      repo.GetFullName(),
			Private:       repo.GetPrivate(),
			Description:   repo.GetDescription(),
			DefaultBranch: repo.GetDefaultBranch(),
			URL:           repo.GetHTMLURL(),
			CreatedAt:     repo.GetCreatedAt().Format(time.RFC3339),
			UpdatedAt:     repo.GetUpdatedAt().Format(time.RFC3339),
		})
	}

	return result, nil
}

// ListBranches lists branches for a repository
func (c *Client) ListBranches(ctx context.Context, owner, repo string) ([]Branch, error) {
	branches, _, err := c.client.Repositories.ListBranches(ctx, owner, repo, &gh.BranchListOptions{
		ListOptions: gh.ListOptions{PerPage: 100},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list branches: %w", err)
	}

	result := make([]Branch, 0, len(branches))
	for _, branch := range branches {
		result = append(result, Branch{
			Name:      branch.GetName(),
			Protected: branch.GetProtected(),
			CommitSha: branch.GetCommit().GetSHA(),
			URL:       branch.GetCommit().GetURL(),
		})
	}

	return result, nil
}

// EnsureRepositoryWebhook creates or updates a webhook for a GitHub repository using git provider ID
func EnsureRepositoryWebhook(gitProviderID string, repositoryName string) error {
	cfg := config.Get()
	ctx := context.Background()

	// Find the git provider
	db := database.GetDatabase()
	var gitProvider struct {
		ID             string
		Type           string
		InstallationID *string
		GithubAccount  *struct {
			AccessToken string
		} `gorm:"foreignKey:GithubAccountID"`
	}

	if err := db.Table("GitProvider").
		Select("GitProvider.id, GitProvider.type, GitProvider.installationId").
		Where("GitProvider.id = ? AND GitProvider.deletedAt IS NULL", gitProviderID).
		First(&gitProvider).Error; err != nil {
		return fmt.Errorf("git provider not found: %s", gitProviderID)
	}

	// Check if the provider is GitHub type
	if gitProvider.Type != "GITHUB" {
		return fmt.Errorf("git provider type is not GitHub: %s", gitProvider.Type)
	}

	// Get GitHub account if exists
	var githubAccount struct {
		AccessToken string
	}
	db.Table("GithubAccount").
		Joins("JOIN GitProvider ON GitProvider.githubAccountId = GithubAccount.id").
		Where("GitProvider.id = ?", gitProviderID).
		Select("GithubAccount.accessToken").
		First(&githubAccount)

	// Parse owner and repo
	parts := strings.Split(repositoryName, "/")
	if len(parts) != 2 {
		return fmt.Errorf("invalid repository name format. Expected 'owner/repo', got: %s", repositoryName)
	}
	owner, repo := parts[0], parts[1]

	// Get GitHub client
	var client *Client
	var err error

	if gitProvider.InstallationID != nil && *gitProvider.InstallationID != "" {
		// Authenticate as GitHub App
		installationID := int64(0)
		fmt.Sscanf(*gitProvider.InstallationID, "%d", &installationID)
		client, err = NewClientWithInstallation(ctx, installationID)
		if err != nil {
			return fmt.Errorf("failed to create GitHub client: %w", err)
		}
	} else if githubAccount.AccessToken != "" {
		// Use personal access token
		client = NewClientWithToken(ctx, githubAccount.AccessToken)
	} else {
		return fmt.Errorf("no GitHub authentication method available")
	}

	// Webhook URL
	webhookURL := fmt.Sprintf("%s/webhooks/github", cfg.ApiURL)

	// Create or update webhook
	err = client.ensureWebhook(ctx, owner, repo, webhookURL, cfg.GitHubWebhookSecret)
	if err != nil {
		return fmt.Errorf("failed to ensure webhook: %w", err)
	}

	return nil
}

// ensureWebhook creates or updates a webhook for a repository (internal method)
func (c *Client) ensureWebhook(ctx context.Context, owner, repo, webhookURL, secret string) error {
	// List existing webhooks
	hooks, _, err := c.client.Repositories.ListHooks(ctx, owner, repo, nil)
	if err != nil {
		return fmt.Errorf("failed to list webhooks: %w", err)
	}

	// Find existing webhook with our URL
	for _, hook := range hooks {
		if hook.Config["url"] == webhookURL {
			// Delete existing webhook
			_, err := c.client.Repositories.DeleteHook(ctx, owner, repo, hook.GetID())
			if err != nil {
				return fmt.Errorf("failed to delete existing webhook: %w", err)
			}
			break
		}
	}

	// Create new webhook
	hookConfig := map[string]interface{}{
		"url":          webhookURL,
		"content_type": "json",
	}
	if secret != "" {
		hookConfig["secret"] = secret
	}

	hook := &gh.Hook{
		Name:   gh.String("web"),
		Active: gh.Bool(true),
		Events: []string{"push", "pull_request"},
		Config: hookConfig,
	}

	_, _, err = c.client.Repositories.CreateHook(ctx, owner, repo, hook)
	if err != nil {
		return fmt.Errorf("failed to create webhook: %w", err)
	}

	return nil
}

// GetRepoDescription analyzes a repository
func (c *Client) GetRepoDescription(ctx context.Context, owner, repo, branch, dockerfilePath string) (*RepoDescription, error) {
	desc := &RepoDescription{
		Languages: make(map[string]int),
	}

	// Get repository info
	repoInfo, _, err := c.client.Repositories.Get(ctx, owner, repo)
	if err != nil {
		return nil, fmt.Errorf("failed to get repo info: %w", err)
	}
	desc.DefaultBranch = repoInfo.GetDefaultBranch()

	// Check for Dockerfile
	if dockerfilePath == "" {
		dockerfilePath = "Dockerfile"
	}
	_, _, _, err = c.client.Repositories.GetContents(ctx, owner, repo, dockerfilePath, &gh.RepositoryContentGetOptions{Ref: branch})
	desc.HasDockerfile = err == nil

	// Check for Procfile
	_, _, _, err = c.client.Repositories.GetContents(ctx, owner, repo, "Procfile", &gh.RepositoryContentGetOptions{Ref: branch})
	desc.HasProcfile = err == nil

	// Get languages
	languages, _, err := c.client.Repositories.ListLanguages(ctx, owner, repo)
	if err == nil {
		desc.Languages = languages
	}

	return desc, nil
}
