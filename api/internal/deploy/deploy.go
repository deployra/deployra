package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/deployra/deployra/api/internal/config"
	"github.com/deployra/deployra/api/internal/crypto"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/redis"
	"github.com/deployra/deployra/api/internal/utils"
)

// BuildService starts a new build for a service
func BuildService(serviceID string, userID string, triggerType string, commitSha string) (*models.Deployment, error) {
	db := database.GetDatabase()
	ctx := context.Background()

	// Get the service with git provider info
	var service models.Service
	if err := db.Preload("GitProvider.GithubAccount").
		Preload("Ports").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return nil, fmt.Errorf("service not found")
	}

	// Check if there's already a deployment in progress
	var activeDeployment models.Deployment
	err := db.Where("serviceId = ? AND status IN ?", serviceID,
		[]string{"PENDING", "BUILDING", "DEPLOYING"}).
		First(&activeDeployment).Error
	if err == nil {
		return nil, fmt.Errorf("a deployment is already in progress")
	}

	// Get the latest deployment number
	var latestDeployment models.Deployment
	db.Where("serviceId = ?", serviceID).
		Order("deploymentNumber DESC").
		First(&latestDeployment)

	nextDeploymentNumber := 1
	if latestDeployment.ID != "" {
		nextDeploymentNumber = latestDeployment.DeploymentNumber + 1
	}

	branch := "main"
	if service.Branch != nil {
		branch = *service.Branch
	}

	// Create a new deployment record
	deployment := models.Deployment{
		ID:               utils.GenerateShortID(),
		DeploymentNumber: nextDeploymentNumber,
		ServiceID:        serviceID,
		Status:           models.DeploymentStatusPending,
		CommitSha:        &commitSha,
		Branch:           &branch,
		TriggeredBy:      &userID,
		TriggerType:      triggerType,
	}

	if err := db.Create(&deployment).Error; err != nil {
		return nil, fmt.Errorf("failed to create deployment: %w", err)
	}

	// Create a service event
	eventType := models.EventTypeDeployStarted
	db.Create(&models.ServiceEvent{
		ServiceID:    serviceID,
		Type:         eventType,
		DeploymentID: &deployment.ID,
	})

	// Parse environment variables
	var envVars []redis.EnvironmentVariable
	if service.EnvironmentVariables != nil {
		service.EnvironmentVariables.UnmarshalTo(&envVars)
	}

	// Decrypt environment variables before sending to builder
	cryptoEnvVars := make([]crypto.EnvironmentVariable, len(envVars))
	for i, v := range envVars {
		cryptoEnvVars[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
	}
	decryptedEnvVars, _ := crypto.DecryptEnvVars(cryptoEnvVars)
	envVars = make([]redis.EnvironmentVariable, len(decryptedEnvVars))
	for i, v := range decryptedEnvVars {
		envVars[i] = redis.EnvironmentVariable{Key: v.Key, Value: v.Value}
	}

	// Convert ports
	var ports []redis.Port
	for _, p := range service.Ports {
		ports = append(ports, redis.Port{
			ServicePort:   p.ServicePort,
			ContainerPort: p.ContainerPort,
		})
	}

	// Build the job
	job := redis.BuilderJob{
		DeploymentID:         deployment.ID,
		ServiceID:            serviceID,
		CommitSha:            commitSha,
		Branch:               branch,
		RepositoryName:       "",
		RuntimeFilePath:      service.RuntimeFilePath,
		EnvironmentVariables: envVars,
		Ports:                ports,
	}

	if service.RepositoryName != nil {
		job.RepositoryName = *service.RepositoryName
	}

	// Add git provider info
	if service.GitProvider != nil {
		gitProvider := &redis.BuilderGitProvider{
			Type:           string(service.GitProvider.Type),
			InstallationID: service.GitProvider.InstallationID,
			URL:            service.GitProvider.URL,
			Username:       service.GitProvider.Username,
			Password:       service.GitProvider.Password,
		}

		if service.GitProvider.GithubAccount != nil {
			gitProvider.GithubAccount = &redis.BuilderGithubAccount{
				Username:    service.GitProvider.GithubAccount.Username,
				AccessToken: service.GitProvider.GithubAccount.AccessToken,
			}
		}

		job.GitProvider = gitProvider
	}

	// Add to builder queue
	if err := redis.AddToBuilderQueue(ctx, job); err != nil {
		return nil, fmt.Errorf("failed to add job to builder queue: %w", err)
	}

	return &deployment, nil
}

// DeployService sends a service to the deployment queue
func DeployService(deployType string, deploymentID *string, serviceID string) error {
	db := database.GetDatabase()
	ctx := context.Background()

	// Get the service
	var service models.Service
	if err := db.Preload("InstanceType").
		Preload("Credentials").
		Preload("Ports").
		Where("id = ?", serviceID).
		First(&service).Error; err != nil {
		return fmt.Errorf("service not found: %s", serviceID)
	}

	// Get the project for organization ID
	var project models.Project
	if err := db.Where("id = ?", service.ProjectID).First(&project).Error; err != nil {
		return fmt.Errorf("project not found for service: %s", serviceID)
	}

	// Parse environment variables
	var envVars []redis.EnvironmentVariable
	if service.EnvironmentVariables != nil {
		service.EnvironmentVariables.UnmarshalTo(&envVars)
	}

	// Decrypt environment variables before sending to kubestrator
	cryptoEnvVars := make([]crypto.EnvironmentVariable, len(envVars))
	for i, v := range envVars {
		cryptoEnvVars[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
	}
	decryptedEnvVars, _ := crypto.DecryptEnvVars(cryptoEnvVars)
	envVars = make([]redis.EnvironmentVariable, len(decryptedEnvVars))
	for i, v := range decryptedEnvVars {
		envVars[i] = redis.EnvironmentVariable{Key: v.Key, Value: v.Value}
	}

	// Create domains array
	var domains []string
	if service.Subdomain != nil && config.Get().AppDomain != "" {
		domains = append(domains, *service.Subdomain+"."+config.Get().AppDomain)
	}
	if service.CustomDomain != nil {
		domains = append(domains, *service.CustomDomain)
	}

	// Calculate scaleToZeroEnabled
	scaleToZeroEnabled := service.ServiceTypeID == "web" && strings.Contains(service.InstanceTypeID, "free")

	// Find HTTP service port
	var httpPort *models.ServicePort
	for i, port := range service.Ports {
		if port.ServicePort == 80 {
			httpPort = &service.Ports[i]
			break
		}
	}

	// Add PORT environment variable if not exists
	if httpPort != nil {
		hasPort := false
		for _, env := range envVars {
			if env.Key == "PORT" {
				hasPort = true
				break
			}
		}
		if !hasPort {
			envVars = append(envVars, redis.EnvironmentVariable{
				Key:   "PORT",
				Value: fmt.Sprintf("%d", httpPort.ContainerPort),
			})
		}
	}

	// Convert ports
	var ports []redis.Port
	for _, p := range service.Ports {
		ports = append(ports, redis.Port{
			ServicePort:   p.ServicePort,
			ContainerPort: p.ContainerPort,
		})
	}

	// Parse container command if present
	var command []string
	if service.ContainerCommand != nil && *service.ContainerCommand != "" {
		json.Unmarshal([]byte(*service.ContainerCommand), &command)
	}

	// Build the deployment job
	job := redis.DeploymentJob{
		Type:           deployType,
		ServiceType:    service.ServiceTypeID,
		DeploymentID:   deploymentID,
		ServiceID:      serviceID,
		ProjectID:      service.ProjectID,
		OrganizationID: project.OrganizationID,
		ContainerRegistry: redis.ContainerRegistry{
			Type:     utils.PtrValue(service.ContainerRegistryType, "ecr"),
			ImageUri: utils.PtrValue(service.ContainerRegistryImageUri, ""),
			Username: utils.PtrValue(service.ContainerRegistryUsername, ""),
			Password: utils.PtrValue(service.ContainerRegistryPassword, ""),
		},
		EnvironmentVariables: envVars,
		AutoScalingEnabled:   service.AutoScalingEnabled,
		Scaling: &redis.Scaling{
			Replicas:                       service.Replicas,
			MinReplicas:                    service.MinReplicas,
			MaxReplicas:                    service.MaxReplicas,
			TargetCPUUtilizationPercentage: utils.PtrValue(service.TargetCPUUtilizationPercentage, 80),
		},
		Resources: &redis.Resources{
			Limits: &redis.ResourceLimits{
				CPU:    fmt.Sprintf("%dm", int(service.InstanceType.CpuCount*1000)),
				Memory: fmt.Sprintf("%dMi", service.InstanceType.MemoryMB),
			},
		},
		Ports:              ports,
		Domains:            domains,
		ScaleToZeroEnabled: scaleToZeroEnabled,
		Command:            command,
	}

	// Add probes for HTTP services
	if httpPort != nil {
		healthPath := "/"
		if service.HealthCheckPath != nil {
			healthPath = *service.HealthCheckPath
		}

		job.ReadinessProbe = &redis.Probe{
			HTTPGet: &redis.HTTPGet{
				Path: healthPath,
				Port: httpPort.ContainerPort,
			},
			InitialDelaySeconds: 10,
			PeriodSeconds:       5,
		}
		job.LivenessProbe = &redis.Probe{
			HTTPGet: &redis.HTTPGet{
				Path: healthPath,
				Port: httpPort.ContainerPort,
			},
			InitialDelaySeconds: 30,
			PeriodSeconds:       10,
		}
	}

	// Add storage if configured (for database services and web/private with persistent storage)
	if service.StorageCapacity != nil {
		storageClass := "hcloud-volumes"
		if service.StorageClass != nil {
			storageClass = *service.StorageClass
		}
		job.Storage = &redis.Storage{
			Size:         fmt.Sprintf("%dGi", *service.StorageCapacity),
			StorageClass: storageClass,
		}
	}

	// Add credentials for database services
	if service.Credentials != nil {
		job.Credentials = &redis.Credentials{
			Username: service.Credentials.Username,
			Password: service.Credentials.Password,
			Database: service.Credentials.Database,
		}
	}

	// Add to deployment queue
	if err := redis.AddToDeploymentQueue(ctx, job); err != nil {
		return fmt.Errorf("failed to add job to deployment queue: %w", err)
	}

	return nil
}
