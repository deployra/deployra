package callback

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/deployra/deployra/api/internal/config"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/utils"
	"github.com/gofiber/fiber/v2"
)

// GitHubTokenResponse represents the response from GitHub OAuth token exchange
type GitHubTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

// GitHubUserResponse represents the response from GitHub user API
type GitHubUserResponse struct {
	Login     string `json:"login"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

// GitHub handles the GitHub OAuth callback
// GET /api/callback/github
func GitHub(c *fiber.Ctx) error {
	cfg := config.Get()
	origin := cfg.AppURL

	code := c.Query("code")
	organizationID := c.Query("organizationId")
	installationID := c.Query("installation_id")
	setupAction := c.Query("setup_action")
	state := c.Query("state")

	db := database.GetDatabase()

	// INSTALLATION WORKFLOW - If we have installation_id, this is a GitHub App installation callback
	if installationID != "" {
		return handleInstallation(c, db, cfg, origin, installationID, setupAction, state, organizationID)
	}

	// AUTHENTICATION WORKFLOW - This is the standard OAuth callback
	if code == "" {
		return redirectWithError(c, origin, organizationID, "missing_params")
	}

	if organizationID == "" {
		return redirectWithError(c, origin, "default", "missing_organization")
	}

	// Exchange the code for an access token
	tokenData, err := exchangeCodeForToken(cfg, code)
	if err != nil || tokenData.AccessToken == "" {
		fmt.Printf("Failed to exchange code for token: %v\n", err)
		return redirectWithError(c, origin, organizationID, "auth_failed")
	}

	// Get GitHub user data
	userData, err := getGitHubUser(tokenData)
	if err != nil {
		fmt.Printf("Failed to get GitHub user: %v\n", err)
		return redirectWithError(c, origin, organizationID, "user_data_failed")
	}

	// Check if the GitHub account already exists for this organization
	var existingAccount models.GithubAccount
	err = db.Where("organizationId = ? AND username = ?", organizationID, userData.Login).
		First(&existingAccount).Error

	// Calculate token expiry (GitHub tokens expire after 6 hours)
	expiresAt := time.Now().Add(6 * time.Hour)

	var githubAccount models.GithubAccount
	if err == nil {
		// Update existing account
		existingAccount.AccessToken = tokenData.AccessToken
		existingAccount.RefreshToken = &tokenData.RefreshToken
		existingAccount.ExpiresAt = &expiresAt
		existingAccount.TokenType = &tokenData.TokenType
		existingAccount.Scope = &tokenData.Scope
		existingAccount.Email = &userData.Email
		existingAccount.AvatarUrl = &userData.AvatarURL
		existingAccount.UpdatedAt = time.Now()

		if err := db.Save(&existingAccount).Error; err != nil {
			fmt.Printf("Failed to update GitHub account: %v\n", err)
			return redirectWithError(c, origin, organizationID, "auth_failed")
		}
		githubAccount = existingAccount
	} else {
		// Create new GitHub account
		githubAccount = models.GithubAccount{
			ID:             utils.GenerateShortID(),
			OrganizationID: organizationID,
			Username:       userData.Login,
			Email:          &userData.Email,
			AvatarUrl:      &userData.AvatarURL,
			AccessToken:    tokenData.AccessToken,
			RefreshToken:   &tokenData.RefreshToken,
			ExpiresAt:      &expiresAt,
			TokenType:      &tokenData.TokenType,
			Scope:          &tokenData.Scope,
		}

		if err := db.Create(&githubAccount).Error; err != nil {
			fmt.Printf("Failed to create GitHub account: %v\n", err)
			return redirectWithError(c, origin, organizationID, "auth_failed")
		}
	}

	// Redirect to GitHub App installation page
	if cfg.GitHubAppName == "" {
		// Fallback to settings page if app name is not configured
		return redirectWithHeaders(c, fmt.Sprintf("%s/dashboard/%s/settings/git-providers?success=true&accountId=%s",
			origin, organizationID, githubAccount.ID))
	}

	// Create state parameter with organizationId and githubAccountId
	stateParam := fmt.Sprintf("%s:%s", organizationID, githubAccount.ID)

	// Redirect to GitHub app installation URL
	callbackURL := fmt.Sprintf("%s/api/callback/github", origin)
	encodedCallback := url.QueryEscape(callbackURL)
	installURL := fmt.Sprintf("https://github.com/apps/%s/installations/new?state=%s&redirect_uri=%s",
		cfg.GitHubAppName, stateParam, encodedCallback)

	return c.Redirect(installURL)
}

// handleInstallation handles the GitHub App installation callback
func handleInstallation(c *fiber.Ctx, db interface{}, cfg *config.Config, origin, installationID, setupAction, state, organizationID string) error {
	gormDB := database.GetDatabase()

	// Parse state which should contain organizationId:githubAccountId
	if state == "" || !strings.Contains(state, ":") {
		return redirectWithError(c, origin, "default", "missing_installation_params")
	}

	parts := strings.Split(state, ":")
	stateOrgID := parts[0]
	githubAccountID := ""
	if len(parts) > 1 {
		githubAccountID = parts[1]
	}

	activeOrgID := stateOrgID
	if activeOrgID == "" {
		activeOrgID = organizationID
	}
	if activeOrgID == "" {
		activeOrgID = "default"
	}

	if githubAccountID == "" {
		return redirectWithError(c, origin, activeOrgID, "invalid_state_format")
	}

	// Check if the provider already exists
	var existingProvider models.GitProvider
	err := gormDB.Where("organizationId = ? AND githubAccountId = ? AND deletedAt IS NULL",
		activeOrgID, githubAccountID).First(&existingProvider).Error

	repositorySelection := "all"
	if setupAction == "update" {
		repositorySelection = "selected"
	}

	if err == nil {
		// Update the existing provider with the new installation ID
		existingProvider.InstallationID = &installationID
		existingProvider.RepositorySelection = &repositorySelection
		existingProvider.UpdatedAt = time.Now()

		if err := gormDB.Save(&existingProvider).Error; err != nil {
			fmt.Printf("Failed to update git provider: %v\n", err)
			return redirectWithError(c, origin, activeOrgID, "installation_failed")
		}
	} else {
		// Create a new Git provider
		providerType := models.GitProviderTypeGitHub
		newProvider := models.GitProvider{
			ID:                  utils.GenerateShortID(),
			OrganizationID:      activeOrgID,
			GithubAccountID:     &githubAccountID,
			Type:                providerType,
			InstallationID:      &installationID,
			RepositorySelection: &repositorySelection,
		}

		if err := gormDB.Create(&newProvider).Error; err != nil {
			fmt.Printf("Failed to create git provider: %v\n", err)
			return redirectWithError(c, origin, activeOrgID, "installation_failed")
		}
	}

	// Redirect back to the git providers page with success message
	return redirectWithHeaders(c, fmt.Sprintf("%s/dashboard/%s/settings/git-providers?installation_success=true",
		origin, activeOrgID))
}

// exchangeCodeForToken exchanges the OAuth code for an access token
func exchangeCodeForToken(cfg *config.Config, code string) (*GitHubTokenResponse, error) {
	data := url.Values{}
	data.Set("client_id", cfg.GitHubClientID)
	data.Set("client_secret", cfg.GitHubClientSecret)
	data.Set("code", code)

	req, err := http.NewRequest("POST", "https://github.com/login/oauth/access_token", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var tokenData GitHubTokenResponse
	if err := json.Unmarshal(body, &tokenData); err != nil {
		return nil, err
	}

	return &tokenData, nil
}

// getGitHubUser gets the GitHub user data
func getGitHubUser(tokenData *GitHubTokenResponse) (*GitHubUserResponse, error) {
	req, err := http.NewRequest("GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}

	tokenType := tokenData.TokenType
	if tokenType == "" {
		tokenType = "token"
	}
	req.Header.Set("Authorization", fmt.Sprintf("%s %s", tokenType, tokenData.AccessToken))
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get user data: %s", string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var userData GitHubUserResponse
	if err := json.Unmarshal(body, &userData); err != nil {
		return nil, err
	}

	return &userData, nil
}

// redirectWithError redirects with an error query parameter
func redirectWithError(c *fiber.Ctx, origin, organizationID, errorCode string) error {
	return redirectWithHeaders(c, fmt.Sprintf("%s/dashboard/%s/settings/git-providers?error=%s",
		origin, organizationID, errorCode))
}

// redirectWithHeaders sets cache headers and redirects
func redirectWithHeaders(c *fiber.Ctx, url string) error {
	c.Set("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Redirect(url)
}
