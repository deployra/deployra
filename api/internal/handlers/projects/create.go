package projects

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/deployra/deployra/api/pkg/utils"
	"github.com/gofiber/fiber/v2"
)

type CreateProjectRequest struct {
	Name           string  `json:"name"`
	Description    *string `json:"description"`
	OrganizationID string  `json:"organizationId"`
}

// POST /api/projects
func Create(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	var req CreateProjectRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate
	if len(req.Name) < 3 {
		return response.BadRequest(c, "Project name must be at least 3 characters")
	}
	if len(req.Name) > 50 {
		return response.BadRequest(c, "Project name must be at most 50 characters")
	}
	if req.OrganizationID == "" {
		return response.BadRequest(c, "Organization ID is required")
	}

	// Check organization access
	if !checkOrganizationAccess(user, req.OrganizationID) {
		return response.Forbidden(c, "Organization not found or unauthorized access")
	}

	// Check if organization exists
	var org models.Organization
	if err := db.Where("id = ? AND deletedAt IS NULL", req.OrganizationID).
		First(&org).Error; err != nil {
		return response.NotFound(c, "Organization not found")
	}

	// Check if project with same name exists
	var existingProject models.Project
	if err := db.Where("name = ? AND organizationId = ? AND deletedAt IS NULL", req.Name, req.OrganizationID).
		First(&existingProject).Error; err == nil {
		return response.Error(c, fiber.StatusConflict, "A project with this name already exists in this organization")
	}

	project := models.Project{
		ID:             utils.GenerateShortID(),
		Name:           req.Name,
		Description:    req.Description,
		OrganizationID: req.OrganizationID,
	}

	if err := db.Create(&project).Error; err != nil {
		return response.InternalServerError(c, "Failed to create project")
	}

	return response.Success(c, project)
}
