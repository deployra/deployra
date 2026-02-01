package create

import (
	"encoding/json"
	"log"

	"github.com/deployra/deployra/api/internal/crypto"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/deploy"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/utils"
	"github.com/deployra/deployra/api/pkg/github"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

func createPrivateService(c *fiber.Ctx, user *models.User, req CreateServiceRequest, project models.Project, instanceType models.InstanceType) error {
	db := database.GetDatabase()

	// Determine runtime
	runtime := models.RuntimeImage
	if req.GitProviderID != nil && req.RepositoryName != nil && req.Branch != nil {
		runtime = models.RuntimeDocker
	}

	// Parse and encrypt environment variables
	var envVarsJSON []byte
	if len(req.EnvironmentVariables) > 0 {
		// Convert to crypto type for encryption
		cryptoEnvVars := make([]crypto.EnvironmentVariable, len(req.EnvironmentVariables))
		for i, v := range req.EnvironmentVariables {
			cryptoEnvVars[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
		}
		encryptedEnvVars, err := crypto.EncryptEnvVars(cryptoEnvVars)
		if err != nil {
			log.Printf("Error encrypting environment variables: %v", err)
			return response.InternalServerError(c, "Failed to encrypt environment variables")
		}
		// Convert back for storage
		storageEnvVars := make([]EnvironmentVariable, len(encryptedEnvVars))
		for i, v := range encryptedEnvVars {
			storageEnvVars[i] = EnvironmentVariable{Key: v.Key, Value: v.Value}
		}
		envVarsJSON, _ = json.Marshal(storageEnvVars)
	}

	// Set autoDeployEnabled
	autoDeployEnabled := true
	if req.AutoDeployEnabled != nil {
		autoDeployEnabled = *req.AutoDeployEnabled
	}

	// Create service
	service := models.Service{
		ID:                utils.GenerateShortID(),
		Name:              req.Name,
		ServiceTypeID:     "private",
		ProjectID:         req.ProjectID,
		Runtime:           runtime,
		InstanceTypeID:    req.InstanceTypeID,
		AutoDeployEnabled: autoDeployEnabled,
		HealthCheckPath:   req.HealthCheckPath,
		StorageCapacity:   req.StorageCapacity,
	}

	if len(envVarsJSON) > 0 {
		service.EnvironmentVariables = envVarsJSON
	}

	// Set runtime-specific parameters
	if runtime == models.RuntimeDocker {
		service.GitProviderID = req.GitProviderID
		service.RepositoryName = req.RepositoryName
		service.Branch = req.Branch
		service.RuntimeFilePath = req.RuntimeFilePath
	} else if runtime == models.RuntimeImage {
		if req.DockerImageUrl != nil {
			containerType := "docker"
			service.ContainerRegistryType = &containerType
			service.ContainerRegistryImageUri = req.DockerImageUrl
			service.ContainerRegistryUsername = req.DockerUsername
			service.ContainerRegistryPassword = req.DockerPassword
		}
	}

	// Save service
	if err := db.Create(&service).Error; err != nil {
		log.Printf("Error creating private service: %v", err)
		return response.InternalServerError(c, "Failed to create service")
	}

	// Create service ports
	if len(req.PortSettings) > 0 {
		for _, port := range req.PortSettings {
			servicePort := models.ServicePort{
				ServiceID:     service.ID,
				ServicePort:   port.ServicePort,
				ContainerPort: port.ContainerPort,
			}
			if err := db.Create(&servicePort).Error; err != nil {
				log.Printf("Error creating service port: %v", err)
			}
		}
	}

	log.Printf("Private service %s created", req.Name)

	// Set up GitHub webhook
	if req.GitProviderID != nil && req.RepositoryName != nil && runtime == models.RuntimeDocker {
		var gitProvider models.GitProvider
		if err := db.Where("id = ? AND deletedAt IS NULL", *req.GitProviderID).First(&gitProvider).Error; err == nil {
			if gitProvider.Type == models.GitProviderTypeGitHub {
				go func() {
					if err := github.EnsureRepositoryWebhook(*req.GitProviderID, *req.RepositoryName); err != nil {
						log.Printf("Error setting up webhook: %v", err)
					}
				}()
			}
		}
	}

	// Start deployment
	if runtime == models.RuntimeDocker {
		if autoDeployEnabled {
			go func() {
				if _, err := deploy.BuildService(service.ID, user.ID, "automatic", ""); err != nil {
					log.Printf("Error starting build: %v", err)
				}
			}()
		}
	} else if runtime == models.RuntimeImage {
		go func() {
			if err := deploy.DeployService("deploy-service", nil, service.ID); err != nil {
				log.Printf("Error deploying service: %v", err)
			}
		}()
	}

	return response.Success(c, fiber.Map{
		"id":                        service.ID,
		"name":                      service.Name,
		"serviceTypeId":             service.ServiceTypeID,
		"projectId":                 service.ProjectID,
		"gitProviderId":             service.GitProviderID,
		"repositoryName":            service.RepositoryName,
		"branch":                    service.Branch,
		"runtimeFilePath":           service.RuntimeFilePath,
		"runtime":                   service.Runtime,
		"createdAt":                 service.CreatedAt,
		"updatedAt":                 service.UpdatedAt,
		"status":                    service.Status,
		"deployedAt":                service.DeployedAt,
		"customDomain":              service.CustomDomain,
		"healthCheckPath":           service.HealthCheckPath,
		"autoScalingEnabled":        service.AutoScalingEnabled,
		"autoDeployEnabled":         service.AutoDeployEnabled,
		"maxReplicas":               service.MaxReplicas,
		"minReplicas":               service.MinReplicas,
		"replicas":                  service.Replicas,
		"containerRegistryType":     service.ContainerRegistryType,
		"containerRegistryImageUri": service.ContainerRegistryImageUri,
		"containerRegistryUsername": service.ContainerRegistryUsername,
		"instanceTypeId":            service.InstanceTypeID,
		"currentReplicas":           service.CurrentReplicas,
		"targetReplicas":            service.TargetReplicas,
		"storageCapacity":           service.StorageCapacity,
		"scalingStatus":             service.ScalingStatus,
		"scaleToZeroEnabled":        false, // Private services don't support scale to zero
	})
}
