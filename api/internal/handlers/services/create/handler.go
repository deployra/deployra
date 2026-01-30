package create

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// POST /api/services
func Create(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	var req CreateServiceRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request data")
	}

	// Validate required fields
	if req.Name == "" {
		return response.BadRequest(c, "Name is required")
	}

	if req.ServiceTypeID == "" {
		return response.BadRequest(c, "Service type is required")
	}
	if req.ProjectID == "" {
		return response.BadRequest(c, "Project ID is required")
	}
	if req.InstanceTypeID == "" {
		return response.BadRequest(c, "Instance type is required")
	}

	// Validate port settings (port range 1-65535)
	if len(req.PortSettings) > 0 {
		for _, port := range req.PortSettings {
			if port.ServicePort < 1 || port.ServicePort > 65535 {
				return response.BadRequest(c, "Service port must be between 1 and 65535")
			}
			if port.ContainerPort < 1 || port.ContainerPort > 65535 {
				return response.BadRequest(c, "Container port must be between 1 and 65535")
			}
		}
	}

	// Get project with organization
	var project models.Project
	if err := db.Preload("Organization").
		Where("id = ? AND deletedAt IS NULL", req.ProjectID).
		First(&project).Error; err != nil {
		return response.NotFound(c, "Project not found")
	}

	// Check project access
	if project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Project not found or unauthorized access")
	}

	// Check if a service with the same name already exists in this project
	var existingService models.Service
	if err := db.Where("projectId = ? AND name = ? AND deletedAt IS NULL", req.ProjectID, req.Name).
		First(&existingService).Error; err == nil {
		return response.BadRequest(c, "A service with this name already exists in this project")
	}

	// Get service type
	var serviceType models.ServiceType
	if err := db.Where("id = ?", req.ServiceTypeID).First(&serviceType).Error; err != nil {
		return response.Forbidden(c, "Service type not found or unauthorized access")
	}

	// Get instance type
	var instanceType models.InstanceType
	if err := db.Preload("InstanceTypeGroup").
		Where("id = ?", req.InstanceTypeID).
		First(&instanceType).Error; err != nil {
		return response.Forbidden(c, "Instance type not found or unauthorized access")
	}

	// Verify instance type belongs to this service type
	if instanceType.InstanceTypeGroup.ServiceTypeID != req.ServiceTypeID {
		return response.Forbidden(c, "Instance type not found or unauthorized access")
	}

	// Check git provider access if provided
	if req.GitProviderID != nil && *req.GitProviderID != "" {
		var gitProvider models.GitProvider
		if err := db.Preload("Organization").Where("id = ? AND deletedAt IS NULL", *req.GitProviderID).First(&gitProvider).Error; err != nil {
			return response.NotFound(c, "Git provider not found")
		}
		if gitProvider.Organization.UserID != user.ID {
			return response.Forbidden(c, "Git provider not found or unauthorized access")
		}
	}

	// Route to appropriate handler based on service type
	switch req.ServiceTypeID {
	case "web":
		return createWebService(c, user, req, project, instanceType)
	case "private":
		return createPrivateService(c, user, req, project, instanceType)
	case "mysql":
		return createMySQLService(c, user, req, project, instanceType)
	case "postgresql":
		return createPostgreSQLService(c, user, req, project, instanceType)
	case "memory":
		return createMemoryService(c, user, req, project, instanceType)
	default:
		return response.BadRequest(c, "Invalid service type")
	}
}
