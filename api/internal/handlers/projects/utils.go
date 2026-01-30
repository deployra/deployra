package projects

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
)

// checkOrganizationAccess checks if user has access to the organization
func checkOrganizationAccess(user *models.User, organizationID string) bool {
	db := database.GetDatabase()

	var org models.Organization
	if err := db.Where("id = ? AND userId = ? AND deletedAt IS NULL", organizationID, user.ID).
		First(&org).Error; err != nil {
		return false
	}

	return true
}

// checkProjectAccess checks if user has access to the project
func checkProjectAccess(user *models.User, projectID string) bool {
	db := database.GetDatabase()

	var project models.Project
	if err := db.Preload("Organization").
		Where("id = ? AND deletedAt IS NULL", projectID).
		First(&project).Error; err != nil {
		return false
	}

	return project.Organization.UserID == user.ID
}
