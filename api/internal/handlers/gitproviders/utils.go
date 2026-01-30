package gitproviders

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

// checkGitProviderAccess checks if user has access to the git provider
func checkGitProviderAccess(user *models.User, providerID string) bool {
	db := database.GetDatabase()

	var provider models.GitProvider
	if err := db.Preload("Organization").
		Where("id = ? AND deletedAt IS NULL", providerID).
		First(&provider).Error; err != nil {
		return false
	}

	return provider.Organization.UserID == user.ID
}
