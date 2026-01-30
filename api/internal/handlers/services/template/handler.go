package template

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/deployra/deployra/api/internal/crypto"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/deploy"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/utils"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
	"gopkg.in/yaml.v3"
	"gorm.io/gorm"
)

// Create handles POST /api/services/template
func Create(c *fiber.Ctx) error {
	db := database.GetDatabase()

	// Get user from context
	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	// Parse request body
	var req CreateFromTemplateRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate required fields
	if req.ProjectID == "" {
		return response.BadRequest(c, "Project ID is required")
	}
	if req.YamlTemplate == "" {
		return response.BadRequest(c, "YAML template is required")
	}

	// Parse YAML template
	var template ParsedTemplate
	if err := yaml.Unmarshal([]byte(req.YamlTemplate), &template); err != nil {
		return response.BadRequest(c, "Invalid YAML format: "+err.Error())
	}

	// Validate template has at least one service
	if len(template.Services) == 0 {
		return response.BadRequest(c, "At least one service must be defined")
	}

	// Check project access
	var project models.Project
	projectQuery := db.Where("id = ? AND deletedAt IS NULL", req.ProjectID).
		Joins("JOIN Organization ON Organization.id = Project.organizationId").
		Where("Organization.userId = ?", user.ID)

	if err := projectQuery.Preload("Organization").First(&project).Error; err != nil {
		return response.Forbidden(c, "Project not found or unauthorized access")
	}

	// Load all instance types for validation
	var instanceTypes []models.InstanceType
	db.Preload("InstanceTypeGroup").Where("isVisible = ?", true).Find(&instanceTypes)

	// Validate services
	for _, service := range template.Services {
		if service.Type == "" {
			return response.BadRequest(c, fmt.Sprintf("Service type is required for service: %s", service.Name))
		}
		if service.Type != "web" && service.Type != "private" {
			return response.BadRequest(c, fmt.Sprintf("Invalid service type '%s' for service: %s", service.Type, service.Name))
		}

		instanceType := findInstanceType(instanceTypes, service.Plan, service.Type)
		if instanceType == nil {
			return response.BadRequest(c, fmt.Sprintf("Instance type '%s' not found for service type '%s'", service.Plan, service.Type))
		}
	}

	// Validate databases
	for _, database := range template.Databases {
		if database.Type == "" {
			return response.BadRequest(c, fmt.Sprintf("Database type is required for database: %s", database.Name))
		}
		if database.Type != "mysql" && database.Type != "postgresql" {
			return response.BadRequest(c, fmt.Sprintf("Invalid database type '%s' for database: %s", database.Type, database.Name))
		}

		instanceType := findInstanceType(instanceTypes, database.Plan, database.Type)
		if instanceType == nil {
			return response.BadRequest(c, fmt.Sprintf("Instance type '%s' not found for database type '%s'", database.Plan, database.Type))
		}
	}

	// Validate memory services
	for _, memory := range template.Memory {
		if memory.Type == "" {
			return response.BadRequest(c, fmt.Sprintf("Memory service type is required for: %s", memory.Name))
		}
		if memory.Type != "memory" {
			return response.BadRequest(c, fmt.Sprintf("Invalid memory service type '%s' for: %s", memory.Type, memory.Name))
		}

		instanceType := findInstanceType(instanceTypes, memory.Plan, memory.Type)
		if instanceType == nil {
			return response.BadRequest(c, fmt.Sprintf("Instance type '%s' not found for memory type '%s'", memory.Plan, memory.Type))
		}
	}

	// Create all services from the template
	createdServices := make([]CreatedServiceInfo, 0)
	createdServiceResponses := make([]fiber.Map, 0)

	// Create databases FIRST (they are dependencies for other services)
	for _, dbTemplate := range template.Databases {
		service, serviceResponse, err := createDatabaseFromTemplate(db, dbTemplate, req.ProjectID)
		if err != nil {
			log.Printf("Error creating database from template: %v", err)
			return response.InternalServerError(c, "Failed to create services from template")
		}
		createdServices = append(createdServices, *service)
		createdServiceResponses = append(createdServiceResponses, serviceResponse)
	}

	// Create memory services SECOND (they might be dependencies)
	for _, memTemplate := range template.Memory {
		service, serviceResponse, err := createMemoryFromTemplate(db, memTemplate, req.ProjectID)
		if err != nil {
			log.Printf("Error creating memory service from template: %v", err)
			return response.InternalServerError(c, "Failed to create services from template")
		}
		createdServices = append(createdServices, *service)
		createdServiceResponses = append(createdServiceResponses, serviceResponse)
	}

	// Create web/application services LAST (they depend on databases/memory)
	for _, serviceTemplate := range template.Services {
		service, serviceResponse, err := createServiceFromTemplate(db, user, serviceTemplate, req.ProjectID, createdServices)
		if err != nil {
			log.Printf("Error creating service from template: %v", err)
			return response.InternalServerError(c, "Failed to create services from template")
		}
		createdServices = append(createdServices, *service)
		createdServiceResponses = append(createdServiceResponses, serviceResponse)
	}

	return response.Success(c, createdServiceResponses)
}

func findInstanceType(instanceTypes []models.InstanceType, plan string, serviceType string) *models.InstanceType {
	planLower := strings.ToLower(strings.TrimSpace(plan))
	for i, it := range instanceTypes {
		if it.ID == planLower && it.InstanceTypeGroup.ServiceTypeID == serviceType {
			return &instanceTypes[i]
		}
	}
	return nil
}

func createServiceFromTemplate(db *gorm.DB, user *models.User, template ServiceTemplate, projectID string, createdServices []CreatedServiceInfo) (*CreatedServiceInfo, fiber.Map, error) {
	// Determine runtime
	runtime := models.RuntimeImage
	if template.Runtime == "docker" {
		runtime = models.RuntimeDocker
	}

	// Generate subdomain for web services
	var subdomain *string
	if template.Type == "web" {
		sub := utils.GenerateSubdomain(template.Name)
		subdomain = &sub
	}

	// Process environment variables
	var envVarsJSON []byte
	if len(template.EnvVars) > 0 {
		envVars := make([]EnvironmentVariable, 0)
		for _, envVar := range template.EnvVars {
			if envVar.GenerateValue {
				envVars = append(envVars, EnvironmentVariable{
					Key:   envVar.Key,
					Value: utils.GenerateRandomString(32),
				})
			} else if envVar.Value != "" {
				envVars = append(envVars, EnvironmentVariable{
					Key:   envVar.Key,
					Value: envVar.Value,
				})
			} else if envVar.FromDatabase != nil {
				// Find the database service by name in created services
				var dbService *CreatedServiceInfo
				for i, s := range createdServices {
					if s.Name == envVar.FromDatabase.Name {
						dbService = &createdServices[i]
						break
					}
				}

				if dbService != nil && dbService.Credentials != nil {
					var value string
					switch envVar.FromDatabase.Property {
					case "host":
						value = dbService.ID + "-service"
					case "user", "username":
						value = dbService.Credentials.Username
					case "password":
						value = dbService.Credentials.Password
					case "database":
						value = dbService.Credentials.Database
					case "port":
						value = fmt.Sprintf("%d", dbService.Credentials.Port)
					default:
						log.Printf("Unknown database property '%s' for service '%s'", envVar.FromDatabase.Property, envVar.FromDatabase.Name)
						continue
					}

					envVars = append(envVars, EnvironmentVariable{
						Key:   envVar.Key,
						Value: value,
					})
				} else {
					log.Printf("Database service '%s' not found or has no credentials", envVar.FromDatabase.Name)
				}
			}
		}

		if len(envVars) > 0 {
			// Convert to crypto type for encryption
			cryptoEnvVars := make([]crypto.EnvironmentVariable, len(envVars))
			for i, v := range envVars {
				cryptoEnvVars[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
			}
			encryptedEnvVars, err := crypto.EncryptEnvVars(cryptoEnvVars)
			if err != nil {
				log.Printf("Error encrypting environment variables: %v", err)
				return nil, nil, fmt.Errorf("failed to encrypt environment variables: %w", err)
			}
			// Convert back for storage
			storageEnvVars := make([]EnvironmentVariable, len(encryptedEnvVars))
			for i, v := range encryptedEnvVars {
				storageEnvVars[i] = EnvironmentVariable{Key: v.Key, Value: v.Value}
			}
			envVarsJSON, _ = json.Marshal(storageEnvVars)
		}
	}

	// Create service
	service := models.Service{
		ID:              utils.GenerateShortID(),
		Name:            template.Name,
		ServiceTypeID:   template.Type,
		ProjectID:       projectID,
		Subdomain:       subdomain,
		Runtime:         runtime,
		InstanceTypeID:  strings.ToLower(strings.TrimSpace(template.Plan)),
		HealthCheckPath: template.HealthCheckPath,
	}

	if len(envVarsJSON) > 0 {
		service.EnvironmentVariables = envVarsJSON
	}

	// Add image-specific parameters
	if runtime == models.RuntimeImage && template.Image != nil && template.Image.URL != "" {
		containerType := "docker"
		service.ContainerRegistryType = &containerType
		service.ContainerRegistryImageUri = &template.Image.URL
	}

	// Save service
	if err := db.Create(&service).Error; err != nil {
		return nil, nil, fmt.Errorf("failed to create service: %w", err)
	}

	// Create service ports
	for _, port := range template.Ports {
		db.Create(&models.ServicePort{
			ServiceID:     service.ID,
			ServicePort:   port.ServicePort,
			ContainerPort: port.ContainerPort,
		})
	}

	log.Printf("Service %s created from template", template.Name)

	// Deploy the service
	if runtime == models.RuntimeDocker {
		go func() {
			if _, err := deploy.BuildService(service.ID, user.ID, "automatic", ""); err != nil {
				log.Printf("Error starting build: %v", err)
			}
		}()
	} else if runtime == models.RuntimeImage {
		go func() {
			if err := deploy.DeployService("deploy-service", nil, service.ID); err != nil {
				log.Printf("Error deploying service: %v", err)
			}
		}()
	}

	serviceResponse := fiber.Map{
		"id":              service.ID,
		"name":            service.Name,
		"serviceTypeId":   service.ServiceTypeID,
		"projectId":       service.ProjectID,
		"subdomain":       service.Subdomain,
		"runtime":         service.Runtime,
		"createdAt":       service.CreatedAt,
		"updatedAt":       service.UpdatedAt,
		"status":          service.Status,
		"instanceTypeId":  service.InstanceTypeID,
		"healthCheckPath": service.HealthCheckPath,
	}

	return &CreatedServiceInfo{
		ID:   service.ID,
		Name: service.Name,
	}, serviceResponse, nil
}

func createDatabaseFromTemplate(db *gorm.DB, template DatabaseTemplate, projectID string) (*CreatedServiceInfo, fiber.Map, error) {
	storageCapacity := template.StorageCapacity
	if storageCapacity < 10 {
		storageCapacity = 10
	}

	// Create service
	service := models.Service{
		ID:              utils.GenerateShortID(),
		Name:            template.Name,
		ServiceTypeID:   template.Type,
		ProjectID:       projectID,
		Runtime:         models.RuntimeImage,
		InstanceTypeID:  strings.ToLower(strings.TrimSpace(template.Plan)),
		StorageCapacity: &storageCapacity,
	}

	// Save service
	if err := db.Create(&service).Error; err != nil {
		return nil, nil, fmt.Errorf("failed to create database: %w", err)
	}

	// Create port based on database type
	var port int
	switch template.Type {
	case "mysql":
		port = 3306
	case "postgresql":
		port = 5432
	default:
		port = 3306
	}

	db.Create(&models.ServicePort{
		ServiceID:     service.ID,
		ServicePort:   port,
		ContainerPort: port,
	})

	// Create credentials
	username := "user_" + utils.GenerateRandomString(10)
	dbName := "db_" + strings.ToLower(service.ID)
	password := utils.GeneratePassword()

	credential := models.ServiceCredential{
		ID:        utils.GenerateShortID(),
		ServiceID: service.ID,
		Host:      "",
		Port:      port,
		Username:  username,
		Password:  password,
		Database:  dbName,
	}

	if err := db.Create(&credential).Error; err != nil {
		log.Printf("Error creating database credentials: %v", err)
	}

	log.Printf("Database %s created from template", template.Name)

	// Deploy to Kubernetes
	go func() {
		if err := deploy.DeployService("deploy-service", nil, service.ID); err != nil {
			log.Printf("Error deploying database: %v", err)
		}
	}()

	serviceResponse := fiber.Map{
		"id":              service.ID,
		"name":            service.Name,
		"serviceTypeId":   service.ServiceTypeID,
		"projectId":       service.ProjectID,
		"runtime":         service.Runtime,
		"createdAt":       service.CreatedAt,
		"updatedAt":       service.UpdatedAt,
		"status":          service.Status,
		"instanceTypeId":  service.InstanceTypeID,
		"storageCapacity": service.StorageCapacity,
	}

	return &CreatedServiceInfo{
		ID:          service.ID,
		Name:        service.Name,
		Credentials: &credential,
	}, serviceResponse, nil
}

func createMemoryFromTemplate(db *gorm.DB, template MemoryTemplate, projectID string) (*CreatedServiceInfo, fiber.Map, error) {
	// Create service
	service := models.Service{
		ID:             utils.GenerateShortID(),
		Name:           template.Name,
		ServiceTypeID:  template.Type,
		ProjectID:      projectID,
		Runtime:        models.RuntimeImage,
		InstanceTypeID: strings.ToLower(strings.TrimSpace(template.Plan)),
	}

	// Save service
	if err := db.Create(&service).Error; err != nil {
		return nil, nil, fmt.Errorf("failed to create memory service: %w", err)
	}

	// Create port (Memory default: 6379)
	db.Create(&models.ServicePort{
		ServiceID:     service.ID,
		ServicePort:   6379,
		ContainerPort: 6379,
	})

	// Create credentials
	username := "user_" + utils.GenerateRandomString(10)
	dbName := "db_" + strings.ToLower(service.ID)
	password := utils.GeneratePassword()

	credential := models.ServiceCredential{
		ID:        utils.GenerateShortID(),
		ServiceID: service.ID,
		Host:      "",
		Port:      6379,
		Username:  username,
		Password:  password,
		Database:  dbName,
	}

	if err := db.Create(&credential).Error; err != nil {
		log.Printf("Error creating Memory credentials: %v", err)
	}

	log.Printf("Memory service %s created from template", template.Name)

	// Deploy to Kubernetes
	go func() {
		if err := deploy.DeployService("deploy-service", nil, service.ID); err != nil {
			log.Printf("Error deploying Memory: %v", err)
		}
	}()

	serviceResponse := fiber.Map{
		"id":             service.ID,
		"name":           service.Name,
		"serviceTypeId":  service.ServiceTypeID,
		"projectId":      service.ProjectID,
		"runtime":        service.Runtime,
		"createdAt":      service.CreatedAt,
		"updatedAt":      service.UpdatedAt,
		"status":         service.Status,
		"instanceTypeId": service.InstanceTypeID,
	}

	return &CreatedServiceInfo{
		ID:          service.ID,
		Name:        service.Name,
		Credentials: &credential,
	}, serviceResponse, nil
}
