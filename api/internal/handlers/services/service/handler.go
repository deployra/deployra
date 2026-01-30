package service

import (
	"encoding/json"
	"log"
	"strings"
	"time"

	"github.com/deployra/deployra/api/internal/crypto"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/deploy"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/utils"
	"github.com/deployra/deployra/api/pkg/ecr"
	"github.com/deployra/deployra/api/pkg/kubernetes"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// GET /api/services/:serviceId
func Get(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	// Fetch the service with access check
	var service models.Service
	query := db.Preload("Project.Organization").
		Preload("Deployments", func(db *gorm.DB) *gorm.DB {
			return db.Order("createdAt DESC").Limit(1)
		}).
		Preload("InstanceType").
		Preload("ServiceType").
		Preload("Credentials").
		Preload("Ports").
		Where("id = ? AND deletedAt IS NULL", serviceID)

	if err := query.First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Calculate scaleToZeroEnabled
	scaleToZeroEnabled := service.ServiceTypeID == "web" && strings.Contains(service.InstanceTypeID, "free")

	// Get last deployment
	var lastDeployment interface{}
	if len(service.Deployments) > 0 {
		lastDeployment = service.Deployments[0]
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
		"project":                   service.Project,
		"lastDeployment":            lastDeployment,
		"scaleToZeroEnabled":        scaleToZeroEnabled,
		"currentReplicas":           service.CurrentReplicas,
		"targetReplicas":            service.TargetReplicas,
		"storageCapacity":           service.StorageCapacity,
		"scalingStatus":             service.ScalingStatus,
	})
}

// DELETE /api/services/:serviceId
func Delete(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Preload("InstanceType").
		Where("id = ?", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Delete ECR repository if service uses ECR
	if service.ContainerRegistryImageUri != nil && strings.Contains(*service.ContainerRegistryImageUri, ".ecr.") {
		go func() {
			if err := ecr.DeleteRepository(serviceID); err != nil {
				log.Printf("Error deleting ECR repository for service %s: %v", serviceID, err)
			}
		}()
	}

	// Soft delete the service
	now := time.Now()
	if err := db.Model(&service).Update("deletedAt", now).Error; err != nil {
		return response.InternalServerError(c, "Failed to delete service")
	}

	// Deploy deletion to Kubernetes
	go func() {
		if err := deploy.DeployService("delete-service", nil, serviceID); err != nil {
			log.Printf("Error deleting service from Kubernetes: %v", err)
		}
	}()

	return response.Success(c, fiber.Map{
		"message": "Service deleted successfully",
	})
}

// PATCH /api/services/:serviceId
func Update(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	var req UpdateServiceRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Preload("InstanceType").
		Preload("Ports").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Validate instance type if provided
	if req.InstanceTypeID != nil && *req.InstanceTypeID != service.InstanceTypeID {
		var newInstanceType models.InstanceType
		if err := db.Where("id = ?", *req.InstanceTypeID).First(&newInstanceType).Error; err != nil {
			return response.BadRequest(c, "Invalid instance type")
		}
	}

	// Build update map
	updates := make(map[string]interface{})

	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.EnvironmentVariables != nil {
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
		storageEnvVars := make([]EnvironmentVar, len(encryptedEnvVars))
		for i, v := range encryptedEnvVars {
			storageEnvVars[i] = EnvironmentVar{Key: v.Key, Value: v.Value}
		}
		envJSON, _ := json.Marshal(storageEnvVars)
		updates["environmentVariables"] = envJSON
	}
	if req.Replicas != nil {
		updates["replicas"] = *req.Replicas
	}
	if req.TargetCPUUtilizationPercentage != nil {
		updates["targetCPUUtilizationPercentage"] = *req.TargetCPUUtilizationPercentage
	}
	if req.MinReplicas != nil {
		updates["minReplicas"] = *req.MinReplicas
	}
	if req.MaxReplicas != nil {
		updates["maxReplicas"] = *req.MaxReplicas
	}
	if req.AutoScalingEnabled != nil {
		updates["autoScalingEnabled"] = *req.AutoScalingEnabled
	}
	if req.AutoDeployEnabled != nil {
		updates["autoDeployEnabled"] = *req.AutoDeployEnabled
	}
	if req.CustomDomain != nil {
		updates["customDomain"] = *req.CustomDomain
	}
	if req.HealthCheckPath != nil {
		updates["healthCheckPath"] = *req.HealthCheckPath
	}
	if req.InstanceTypeID != nil {
		updates["instanceTypeId"] = *req.InstanceTypeID
		updates["instanceTypeChangedAt"] = time.Now()
	}
	if req.StorageCapacity != nil {
		updates["storageCapacity"] = *req.StorageCapacity
		updates["storageCapacityChangedAt"] = time.Now()
	}

	// Update service
	if len(updates) > 0 {
		if err := db.Model(&service).Updates(updates).Error; err != nil {
			return response.InternalServerError(c, "Failed to update service")
		}
	}

	// Update port settings if provided
	if req.PortSettings != nil && len(req.PortSettings) > 0 {
		if service.ServiceTypeID == "web" || service.ServiceTypeID == "private" {
			// Delete existing ports
			db.Where("serviceId = ?", serviceID).Delete(&models.ServicePort{})

			if service.ServiceTypeID == "web" {
				// Web services only allow one port with servicePort=80
				db.Create(&models.ServicePort{
					ServiceID:     serviceID,
					ServicePort:   80,
					ContainerPort: req.PortSettings[0].ContainerPort,
				})
			} else {
				// Private services can have multiple ports
				for _, port := range req.PortSettings {
					db.Create(&models.ServicePort{
						ServiceID:     serviceID,
						ServicePort:   port.ServicePort,
						ContainerPort: port.ContainerPort,
					})
				}
			}
		}
	}

	// Reload service
	db.Preload("InstanceType").
		Preload("ServiceType").
		Preload("Ports").
		First(&service, "id = ?", serviceID)

	// Trigger redeploy if service is running
	if service.Status == models.ServiceStatusRunning ||
		service.Status == models.ServiceStatusFailed ||
		service.Status == models.ServiceStatusRestarting {
		go func() {
			if err := deploy.DeployService("deploy-service", nil, serviceID); err != nil {
				log.Printf("Error redeploying service: %v", err)
			}
		}()
	}

	// Calculate scaleToZeroEnabled
	scaleToZeroEnabled := service.ServiceTypeID == "web" && strings.Contains(service.InstanceTypeID, "free")

	return response.Success(c, fiber.Map{
		"id":                 service.ID,
		"name":               service.Name,
		"serviceTypeId":      service.ServiceTypeID,
		"projectId":          service.ProjectID,
		"runtime":            service.Runtime,
		"createdAt":          service.CreatedAt,
		"updatedAt":          service.UpdatedAt,
		"status":             service.Status,
		"subdomain":          service.Subdomain,
		"customDomain":       service.CustomDomain,
		"healthCheckPath":    service.HealthCheckPath,
		"autoScalingEnabled": service.AutoScalingEnabled,
		"autoDeployEnabled":  service.AutoDeployEnabled,
		"maxReplicas":        service.MaxReplicas,
		"minReplicas":        service.MinReplicas,
		"replicas":           service.Replicas,
		"instanceTypeId":     service.InstanceTypeID,
		"instanceType":       service.InstanceType,
		"serviceType":        service.ServiceType,
		"ports":              service.Ports,
		"scaleToZeroEnabled": scaleToZeroEnabled,
		"storageCapacity":    service.StorageCapacity,
	})
}

// POST /api/services/:serviceId/deploy
func Deploy(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	var req DeployRequest
	if err := c.BodyParser(&req); err != nil {
		// Allow empty body
		req = DeployRequest{}
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Check if service runtime is Docker
	if service.Runtime != models.RuntimeDocker {
		return response.BadRequest(c, "Service runtime is not Docker")
	}

	commitSha := ""
	if req.CommitSha != nil {
		commitSha = *req.CommitSha
	}

	deployment, err := deploy.BuildService(serviceID, user.ID, "manual", commitSha)
	if err != nil {
		log.Printf("Error starting deployment: %v", err)
		return response.BadRequest(c, "Failed to start deployment: "+err.Error())
	}

	return response.Success(c, deployment)
}

// POST /api/services/:serviceId/restart
func Restart(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Create restart event
	db.Create(&models.ServiceEvent{
		ServiceID: serviceID,
		Type:      models.EventTypeServiceRestartStarted,
		Message:   utils.Ptr("Service restart initiated"),
	})

	// Update service status to RESTARTING
	db.Model(&service).Update("status", models.ServiceStatusRestarting)

	// Deploy to kubernetes
	go func() {
		if err := deploy.DeployService("deploy-service", nil, serviceID); err != nil {
			log.Printf("Error restarting service: %v", err)
		}
	}()

	return response.Success(c, fiber.Map{
		"message": "Service restart initiated",
	})
}


// GET /api/services/:serviceId/deployments
func GetDeployments(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	// Parse query parameters
	status := c.Query("status")
	date := c.Query("date")
	search := c.Query("search")
	page := c.QueryInt("page", 1)
	limit := c.QueryInt("limit", 20)
	skip := (page - 1) * limit

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Build query
	query := db.Where("serviceId = ?", serviceID)

	// Add status filter
	if status != "" {
		query = query.Where("status = ?", status)
	}

	// Add date filter
	if date != "" {
		query = query.Where("DATE(createdAt) = ?", date)
	}

	// Add search filter
	if search != "" {
		query = query.Where("commitSha LIKE ? OR branch LIKE ?", "%"+search+"%", "%"+search+"%")
	}

	// Count total
	var total int64
	query.Model(&models.Deployment{}).Count(&total)

	// Fetch deployments
	var deployments []models.Deployment
	query.Preload("Service", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, name, repositoryName, branch")
	}).
		Order("createdAt DESC").
		Offset(skip).
		Limit(limit).
		Find(&deployments)

	// Get user data for triggers
	userIDs := make([]string, 0)
	for _, d := range deployments {
		if d.TriggeredBy != nil && *d.TriggeredBy != "" {
			userIDs = append(userIDs, *d.TriggeredBy)
		}
	}

	userMap := make(map[string]models.User)
	if len(userIDs) > 0 {
		var users []models.User
		db.Where("id IN ?", userIDs).Select("id, firstName, lastName, email").Find(&users)
		for _, u := range users {
			userMap[u.ID] = u
		}
	}

	// Build response
	deploymentsWithUsers := make([]fiber.Map, len(deployments))
	for i, d := range deployments {
		item := fiber.Map{
			"id":               d.ID,
			"deploymentNumber": d.DeploymentNumber,
			"serviceId":        d.ServiceID,
			"status":           d.Status,
			"commitSha":        d.CommitSha,
			"branch":           d.Branch,
			"triggeredBy":      d.TriggeredBy,
			"triggerType":      d.TriggerType,
			"createdAt":        d.CreatedAt,
			"updatedAt":        d.UpdatedAt,
			"startedAt":        d.StartedAt,
			"completedAt":      d.CompletedAt,
			"service":          d.Service,
		}

		if d.TriggeredBy != nil {
			if u, ok := userMap[*d.TriggeredBy]; ok {
				item["triggerUser"] = fiber.Map{
					"id":        u.ID,
					"firstName": u.FirstName,
					"lastName":  u.LastName,
					"email":     u.Email,
				}
			}
		}

		deploymentsWithUsers[i] = item
	}

	totalPages := int((total + int64(limit) - 1) / int64(limit))

	return response.Success(c, fiber.Map{
		"deployments": deploymentsWithUsers,
		"pagination": fiber.Map{
			"totalItems":   total,
			"totalPages":   totalPages,
			"currentPage":  page,
			"itemsPerPage": limit,
		},
	})
}

// GET /api/services/:serviceId/events
func GetEvents(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Fetch events
	var events []models.ServiceEvent
	db.Preload("Deployment").
		Where("serviceId = ?", serviceID).
		Order("createdAt DESC").
		Limit(10).
		Find(&events)

	// Get user data for deployment triggers
	userIDs := make([]string, 0)
	for _, e := range events {
		if e.Deployment != nil && e.Deployment.TriggeredBy != nil && *e.Deployment.TriggeredBy != "" {
			userIDs = append(userIDs, *e.Deployment.TriggeredBy)
		}
	}

	userMap := make(map[string]models.User)
	if len(userIDs) > 0 {
		var users []models.User
		db.Where("id IN ?", userIDs).Select("id, firstName, lastName, email").Find(&users)
		for _, u := range users {
			userMap[u.ID] = u
		}
	}

	// Build response
	eventsWithUsers := make([]fiber.Map, len(events))
	for i, e := range events {
		item := fiber.Map{
			"id":           e.ID,
			"serviceId":    e.ServiceID,
			"deploymentId": e.DeploymentID,
			"type":         e.Type,
			"message":      e.Message,
			"payload":      e.Payload,
			"createdAt":    e.CreatedAt,
		}

		if e.Deployment != nil {
			deploymentMap := fiber.Map{
				"id":               e.Deployment.ID,
				"deploymentNumber": e.Deployment.DeploymentNumber,
				"status":           e.Deployment.Status,
				"commitSha":        e.Deployment.CommitSha,
				"branch":           e.Deployment.Branch,
				"triggeredBy":      e.Deployment.TriggeredBy,
				"triggerType":      e.Deployment.TriggerType,
				"createdAt":        e.Deployment.CreatedAt,
			}

			if e.Deployment.TriggeredBy != nil {
				if u, ok := userMap[*e.Deployment.TriggeredBy]; ok {
					deploymentMap["triggerUser"] = fiber.Map{
						"id":        u.ID,
						"firstName": u.FirstName,
						"lastName":  u.LastName,
						"email":     u.Email,
					}
				}
			}

			item["deployment"] = deploymentMap
		}

		eventsWithUsers[i] = item
	}

	return response.Success(c, eventsWithUsers)
}

// GET /api/services/:serviceId/metrics
func GetMetrics(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	// Parse query parameters
	timeRange := c.Query("timeRange", "day")
	startDateStr := c.Query("startDate")
	endDateStr := c.Query("endDate")

	// Calculate date range
	now := time.Now()
	var startDateTime, endDateTime time.Time
	endDateTime = now

	if startDateStr != "" && endDateStr != "" {
		var err error
		startDateTime, err = time.Parse(time.RFC3339, startDateStr)
		if err != nil {
			startDateTime, _ = time.Parse("2006-01-02", startDateStr)
		}
		endDateTime, err = time.Parse(time.RFC3339, endDateStr)
		if err != nil {
			endDateTime, _ = time.Parse("2006-01-02", endDateStr)
		}
	} else {
		switch timeRange {
		case "hour":
			startDateTime = now.Add(-time.Hour)
		case "day":
			startDateTime = now.Add(-24 * time.Hour)
		case "week":
			startDateTime = now.Add(-7 * 24 * time.Hour)
		case "month":
			startDateTime = now.Add(-30 * 24 * time.Hour)
		default:
			startDateTime = now.Add(-24 * time.Hour)
		}
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Fetch service metrics
	var serviceMetrics []models.ServiceMetrics
	db.Preload("PodMetrics").
		Where("serviceId = ? AND timestamp >= ? AND timestamp <= ?", serviceID, startDateTime, endDateTime).
		Order("timestamp ASC").
		Find(&serviceMetrics)

	return response.Success(c, fiber.Map{
		"serviceMetrics": serviceMetrics,
	})
}

// GET /api/services/:serviceId/pods
func GetPods(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Get pods from Kubernetes
	pods, err := kubernetes.GetPodsForService(service.ProjectID, serviceID)
	if err != nil {
		log.Printf("Error getting pods for service %s: %v", serviceID, err)
		return response.Success(c, []kubernetes.Pod{})
	}

	return response.Success(c, pods)
}

