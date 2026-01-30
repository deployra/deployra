package create

import (
	"log"
	"strings"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/deploy"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/utils"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

func createMySQLService(c *fiber.Ctx, user *models.User, req CreateServiceRequest, project models.Project, instanceType models.InstanceType) error {
	db := database.GetDatabase()

	// Create service
	service := models.Service{
		ID:              utils.GenerateShortID(),
		Name:            req.Name,
		ServiceTypeID:   "mysql",
		ProjectID:       req.ProjectID,
		Runtime:         models.RuntimeImage,
		InstanceTypeID:  req.InstanceTypeID,
		StorageCapacity: req.StorageCapacity,
	}

	// Save service
	if err := db.Create(&service).Error; err != nil {
		log.Printf("Error creating MySQL service: %v", err)
		return response.InternalServerError(c, "Failed to create service")
	}

	// Create port (MySQL default: 3306)
	db.Create(&models.ServicePort{
		ServiceID:     service.ID,
		ServicePort:   3306,
		ContainerPort: 3306,
	})

	// Create credentials
	username := "user_" + utils.GenerateRandomString(10)
	dbName := "db_" + strings.ToLower(service.ID)
	password := utils.GeneratePassword()

	credential := models.ServiceCredential{
		ID:        utils.GenerateShortID(),
		ServiceID: service.ID,
		Host:      "",
		Port:      3306,
		Username:  username,
		Password:  password,
		Database:  dbName,
	}
	if err := db.Create(&credential).Error; err != nil {
		log.Printf("Error creating MySQL credentials: %v", err)
	}

	log.Printf("MySQL service %s created", req.Name)

	// Deploy to Kubernetes
	go func() {
		if err := deploy.DeployService("deploy-service", nil, service.ID); err != nil {
			log.Printf("Error deploying MySQL service: %v", err)
		}
	}()

	return response.Success(c, fiber.Map{
		"id":              service.ID,
		"name":            service.Name,
		"serviceTypeId":   service.ServiceTypeID,
		"projectId":       service.ProjectID,
		"runtime":         service.Runtime,
		"createdAt":       service.CreatedAt,
		"updatedAt":       service.UpdatedAt,
		"status":          service.Status,
		"deployedAt":      service.DeployedAt,
		"instanceTypeId":  service.InstanceTypeID,
		"currentReplicas": service.CurrentReplicas,
		"targetReplicas":  service.TargetReplicas,
		"storageCapacity": service.StorageCapacity,
		"scalingStatus":   service.ScalingStatus,
	})
}

func createPostgreSQLService(c *fiber.Ctx, user *models.User, req CreateServiceRequest, project models.Project, instanceType models.InstanceType) error {
	db := database.GetDatabase()

	// Create service
	service := models.Service{
		ID:              utils.GenerateShortID(),
		Name:            req.Name,
		ServiceTypeID:   "postgresql",
		ProjectID:       req.ProjectID,
		Runtime:         models.RuntimeImage,
		InstanceTypeID:  req.InstanceTypeID,
		StorageCapacity: req.StorageCapacity,
	}

	// Save service
	if err := db.Create(&service).Error; err != nil {
		log.Printf("Error creating PostgreSQL service: %v", err)
		return response.InternalServerError(c, "Failed to create service")
	}

	// Create port (PostgreSQL default: 5432)
	db.Create(&models.ServicePort{
		ServiceID:     service.ID,
		ServicePort:   5432,
		ContainerPort: 5432,
	})

	// Create credentials
	username := "user_" + utils.GenerateRandomString(10)
	dbName := "db_" + strings.ToLower(service.ID)
	password := utils.GeneratePassword()

	credential := models.ServiceCredential{
		ID:        utils.GenerateShortID(),
		ServiceID: service.ID,
		Host:      "",
		Port:      5432,
		Username:  username,
		Password:  password,
		Database:  dbName,
	}
	if err := db.Create(&credential).Error; err != nil {
		log.Printf("Error creating PostgreSQL credentials: %v", err)
	}

	log.Printf("PostgreSQL service %s created", req.Name)

	// Deploy to Kubernetes
	go func() {
		if err := deploy.DeployService("deploy-service", nil, service.ID); err != nil {
			log.Printf("Error deploying PostgreSQL service: %v", err)
		}
	}()

	return response.Success(c, fiber.Map{
		"id":              service.ID,
		"name":            service.Name,
		"serviceTypeId":   service.ServiceTypeID,
		"projectId":       service.ProjectID,
		"runtime":         service.Runtime,
		"createdAt":       service.CreatedAt,
		"updatedAt":       service.UpdatedAt,
		"status":          service.Status,
		"deployedAt":      service.DeployedAt,
		"instanceTypeId":  service.InstanceTypeID,
		"currentReplicas": service.CurrentReplicas,
		"targetReplicas":  service.TargetReplicas,
		"storageCapacity": service.StorageCapacity,
		"scalingStatus":   service.ScalingStatus,
	})
}

func createMemoryService(c *fiber.Ctx, user *models.User, req CreateServiceRequest, project models.Project, instanceType models.InstanceType) error {
	db := database.GetDatabase()

	// Create service
	service := models.Service{
		ID:             utils.GenerateShortID(),
		Name:           req.Name,
		ServiceTypeID:  "memory",
		ProjectID:      req.ProjectID,
		Runtime:        models.RuntimeImage,
		InstanceTypeID: req.InstanceTypeID,
	}

	// Save service
	if err := db.Create(&service).Error; err != nil {
		log.Printf("Error creating Memory service: %v", err)
		return response.InternalServerError(c, "Failed to create service")
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

	log.Printf("Memory service %s created", req.Name)

	// Deploy to Kubernetes
	go func() {
		if err := deploy.DeployService("deploy-service", nil, service.ID); err != nil {
			log.Printf("Error deploying Memory service: %v", err)
		}
	}()

	return response.Success(c, fiber.Map{
		"id":              service.ID,
		"name":            service.Name,
		"serviceTypeId":   service.ServiceTypeID,
		"projectId":       service.ProjectID,
		"runtime":         service.Runtime,
		"createdAt":       service.CreatedAt,
		"updatedAt":       service.UpdatedAt,
		"status":          service.Status,
		"deployedAt":      service.DeployedAt,
		"instanceTypeId":  service.InstanceTypeID,
		"currentReplicas": service.CurrentReplicas,
		"targetReplicas":  service.TargetReplicas,
		"scalingStatus":   service.ScalingStatus,
	})
}
