package github

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/deploy"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/utils"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// InstallationPayload represents the installation webhook payload
type InstallationPayload struct {
	Action       string `json:"action"`
	Installation struct {
		ID                  int    `json:"id"`
		RepositorySelection string `json:"repository_selection"`
	} `json:"installation"`
}

// PushPayload represents the push event payload
type PushPayload struct {
	Ref        string `json:"ref"`
	After      string `json:"after"`
	Repository struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
}

// POST /api/webhooks/github
func Handle(c *fiber.Ctx) error {
	db := database.GetDatabase()

	event := c.Get("X-GitHub-Event")
	signature := c.Get("X-Hub-Signature-256")
	rawBody := c.Body()

	// Verify webhook signature if configured
	webhookSecret := os.Getenv("GITHUB_WEBHOOK_SECRET")
	if webhookSecret != "" {
		if signature == "" {
			log.Println("No signature provided in GitHub webhook")
			return response.Unauthorized(c, "No signature provided")
		}

		// Verify signature
		mac := hmac.New(sha256.New, []byte(webhookSecret))
		mac.Write(rawBody)
		expectedSignature := "sha256=" + hex.EncodeToString(mac.Sum(nil))

		if !hmac.Equal([]byte(signature), []byte(expectedSignature)) {
			log.Println("Invalid signature in GitHub webhook")
			return response.Unauthorized(c, "Invalid signature")
		}
	}

	log.Printf("GitHub webhook event: %s", event)

	// Handle installation events
	if event == "installation" {
		var payload InstallationPayload
		if err := json.Unmarshal(rawBody, &payload); err != nil {
			return response.BadRequest(c, "Invalid payload")
		}

		log.Printf("GitHub webhook action: %s", payload.Action)
		installationID := payload.Installation.ID

		// Installation created/added event
		if payload.Action == "created" || payload.Action == "added" {
			stateParam := c.Query("state")

			if stateParam == "" || !strings.Contains(stateParam, ":") {
				log.Printf("Invalid state parameter in GitHub webhook: %s", stateParam)
				return response.BadRequest(c, "Missing or invalid state parameter")
			}

			parts := strings.Split(stateParam, ":")
			organizationID := parts[0]
			githubAccountID := parts[1]

			// Create the Git provider
			installationIDStr := strconv.Itoa(installationID)
			gitProvider := models.GitProvider{
				ID:                  utils.GenerateShortID(),
				OrganizationID:      organizationID,
				GithubAccountID:     &githubAccountID,
				Type:                models.GitProviderTypeGitHub,
				InstallationID:      &installationIDStr,
				RepositorySelection: &payload.Installation.RepositorySelection,
			}

			if err := db.Create(&gitProvider).Error; err != nil {
				log.Printf("Error creating Git provider: %v", err)
				return response.InternalServerError(c, "Failed to create Git provider")
			}

			log.Printf("Created Git provider from webhook: %s", gitProvider.ID)

			return response.Success(c, fiber.Map{
				"providerId": gitProvider.ID,
			})
		}

		// Installation deleted/removed event
		if payload.Action == "deleted" || payload.Action == "removed" {
			var providers []models.GitProvider
			db.Where("installationId = ?", installationID).Find(&providers)

			if len(providers) > 0 {
				for _, provider := range providers {
					db.Model(&provider).Update("installationId", nil)
				}
				log.Printf("Marked %d providers as uninstalled for installation %d", len(providers), installationID)
			} else {
				log.Printf("No providers found for installation %d", installationID)
			}

			return response.Success(c, fiber.Map{
				"message": "Installation uninstall processed",
			})
		}
	}

	// Handle push events
	if event == "push" {
		var payload PushPayload
		if err := json.Unmarshal(rawBody, &payload); err != nil {
			return response.BadRequest(c, "Invalid payload")
		}

		repositoryName := payload.Repository.FullName
		branch := strings.TrimPrefix(payload.Ref, "refs/heads/")

		if repositoryName == "" || branch == "" {
			log.Println("Missing repository name or branch in push event")
			return response.Success(c, fiber.Map{
				"message": "Webhook received but missing required information",
			})
		}

		log.Printf("Received push event for %s on branch %s", repositoryName, branch)

		// Find all services that use this repository and branch
		var services []models.Service
		db.Preload("Project.Organization").
			Where("repositoryName = ? AND branch = ? AND runtime = ? AND deletedAt IS NULL",
				repositoryName, branch, models.RuntimeDocker).
			Find(&services)

		if len(services) == 0 {
			log.Printf("No services found for repository %s and branch %s", repositoryName, branch)
			return response.Success(c, fiber.Map{
				"message": "Webhook received but no matching services found",
			})
		}

		log.Printf("Found %d services to rebuild for %s:%s", len(services), repositoryName, branch)

		// Trigger builds for each service
		triggeredServices := []fiber.Map{}
		for _, service := range services {
			if !service.AutoDeployEnabled {
				log.Printf("Service %s has auto deploy disabled, skipping", service.Name)
				continue
			}

			// Check if there's already a deployment in progress
			var activeDeployment models.Deployment
			err := db.Where("serviceId = ? AND status IN ?", service.ID,
				[]string{string(models.DeploymentStatusPending), string(models.DeploymentStatusBuilding), string(models.DeploymentStatusDeploying)}).
				First(&activeDeployment).Error

			// Cancel any existing deployments
			if err == nil {
				log.Printf("Cancelling existing deployment %s for service %s", activeDeployment.ID, service.Name)
				db.Model(&activeDeployment).Update("status", models.DeploymentStatusCancelled)

				// Create a service event for the cancelled deployment
				db.Create(&models.ServiceEvent{
					ServiceID:    service.ID,
					Type:         models.EventTypeDeployCancelled,
					DeploymentID: &activeDeployment.ID,
					Message:      utils.Ptr("Cancelled by new webhook trigger"),
				})
			}

			// Start a new build
			_, buildErr := deploy.BuildService(service.ID, "", "webhook", payload.After)
			if buildErr != nil {
				log.Printf("Error triggering build for service %s: %v", service.ID, buildErr)
				continue
			}

			log.Printf("Triggered build for service %s (%s)", service.Name, service.ID)
			triggeredServices = append(triggeredServices, fiber.Map{
				"id":   service.ID,
				"name": service.Name,
			})
		}

		return response.Success(c, fiber.Map{
			"message":  fmt.Sprintf("Triggered builds for %d service(s)", len(triggeredServices)),
			"services": triggeredServices,
		})
	}

	// Handle other webhook events
	return response.Success(c, fiber.Map{
		"message": "Webhook received",
	})
}

