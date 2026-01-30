package services

import (
	"strings"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// GET /api/services?projectId=xxx
func List(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	projectID := c.Query("projectId")
	if projectID == "" {
		return response.BadRequest(c, "Project ID is required")
	}

	// Check if project exists and user has access
	var project models.Project
	projectQuery := db.Preload("Organization").Where("id = ? AND deletedAt IS NULL", projectID)
	if err := projectQuery.First(&project).Error; err != nil {
		return response.NotFound(c, "Project not found")
	}

	// Check access
	if project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Project not found or unauthorized access")
	}

	// Fetch services
	var services []models.Service
	if err := db.Where("projectId = ? AND deletedAt IS NULL", projectID).
		Preload("Deployments", func(db *gorm.DB) *gorm.DB {
			return db.Order("createdAt DESC").Limit(1)
		}).
		Preload("InstanceType").
		Preload("ServiceType").
		Preload("Credentials").
		Preload("Ports").
		Order("createdAt ASC").
		Find(&services).Error; err != nil {
		return response.InternalServerError(c, "Failed to fetch services")
	}

	// Format response
	result := make([]fiber.Map, len(services))
	for i, service := range services {
		// Calculate scaleToZeroEnabled
		scaleToZeroEnabled := service.ServiceTypeID == "web" && strings.Contains(service.InstanceTypeID, "free")

		var lastDeployment interface{}
		if len(service.Deployments) > 0 {
			lastDeployment = service.Deployments[0]
		}

		result[i] = fiber.Map{
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
			"subdomain":                 service.Subdomain,
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
			"instanceType":              service.InstanceType,
			"serviceType":               service.ServiceType,
			"credentials":               service.Credentials,
			"ports":                     service.Ports,
			"lastDeployment":            lastDeployment,
			"scaleToZeroEnabled":        scaleToZeroEnabled,
			"currentReplicas":           service.CurrentReplicas,
			"targetReplicas":            service.TargetReplicas,
			"storageCapacity":           service.StorageCapacity,
			"scalingStatus":             service.ScalingStatus,
		}
	}

	return response.Success(c, result)
}
