package ecr

import (
	"log"
	"strings"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	ecrpkg "github.com/deployra/deployra/api/pkg/ecr"
	"github.com/deployra/deployra/api/pkg/kubernetes"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// ServiceResult represents the result of processing a service
type ServiceResult struct {
	ServiceID  string `json:"serviceId"`
	SecretName string `json:"secretName"`
	Status     string `json:"status"`
}

// ServiceError represents an error for a service
type ServiceError struct {
	ServiceID string `json:"serviceId"`
	Error     string `json:"error"`
}

// GET /api/webhooks/ecr
// This endpoint renews ECR tokens for all services using ECR registries
// and updates the corresponding Kubernetes secrets
func Handle(c *fiber.Ctx) error {
	db := database.GetDatabase()

	log.Println("Processing ECR webhook to renew tokens")

	// First, refresh the system-wide ECR credentials in system-apps namespace
	systemSecretUpdated := false
	ecrDetails, err := ecrpkg.GetAuthorizationToken()
	if err != nil {
		log.Printf("Error getting ECR authorization token for system secret: %v", err)
	} else {
		// Extract registry URL from the proxyEndpoint
		// Format: https://YOUR_AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
		registryURL := strings.TrimPrefix(ecrDetails.ProxyEndpoint, "https://")

		// Update the system-wide ECR secret
		if err := kubernetes.CreateECRSecret("ecr-credentials", "system-apps", registryURL, ecrDetails.Token); err != nil {
			log.Printf("Error renewing system-wide ECR token: %v", err)
		} else {
			systemSecretUpdated = true
		}
	}

	// Find all services using ECR registries (excluding deleted services and projects)
	var services []models.Service
	db.Preload("Project").
		Where("Service.containerRegistryImageUri IS NOT NULL AND Service.containerRegistryImageUri LIKE ? AND Service.deletedAt IS NULL", "%.ecr.%").
		Joins("JOIN Project ON Service.projectId = Project.id AND Project.deletedAt IS NULL").
		Find(&services)

	log.Printf("Found %d services using ECR registries", len(services))

	var results []ServiceResult
	var errors []ServiceError

	// Process each service to renew its token
	for _, service := range services {
		if service.ContainerRegistryImageUri == nil {
			continue
		}

		imageUri := *service.ContainerRegistryImageUri

		// Extract registry URL from the image URI
		// Example: YOUR_AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/repository:tag
		// We need: YOUR_AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
		registryURL := extractRegistryURL(imageUri)

		// Get the namespace (project ID)
		namespace := service.ProjectID

		// Get fresh ECR token
		ecrToken, err := ecrpkg.GetAuthorizationToken()
		if err != nil {
			log.Printf("Error getting ECR authorization token for service %s: %v", service.ID, err)
			errors = append(errors, ServiceError{
				ServiceID: service.ID,
				Error:     err.Error(),
			})
			continue
		}

		// Create or update the secret
		secretName := service.ID + "-container-registry-secret"

		if err := kubernetes.CreateECRSecret(secretName, namespace, registryURL, ecrToken.Token); err != nil {
			log.Printf("Error creating ECR secret for service %s: %v", service.ID, err)
			errors = append(errors, ServiceError{
				ServiceID: service.ID,
				Error:     err.Error(),
			})
			continue
		}

		results = append(results, ServiceResult{
			ServiceID:  service.ID,
			SecretName: secretName,
			Status:     "updated",
		})
	}

	return response.Success(c, fiber.Map{
		"systemSecretUpdated": systemSecretUpdated,
		"servicesProcessed":   len(services),
		"successfulUpdates":   len(results),
		"failedUpdates":       len(errors),
		"results":             results,
		"errors":              errors,
	})
}

// extractRegistryURL extracts the registry URL from an image URI
func extractRegistryURL(imageUri string) string {
	// For ECR URLs, extract the host part
	// Example: YOUR_AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/repo:tag
	if strings.Contains(imageUri, ".dkr.ecr.") && strings.Contains(imageUri, ".amazonaws.com") {
		parts := strings.Split(imageUri, "/")
		return parts[0]
	}

	// For other URLs, extract everything before the first slash
	if idx := strings.Index(imageUri, "/"); idx != -1 {
		return imageUri[:idx]
	}

	return imageUri
}
