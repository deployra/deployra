package deployments

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
)

// checkDeploymentAccess checks if user has access to the deployment
func checkDeploymentAccess(user *models.User, deploymentID string) bool {
	db := database.GetDatabase()

	var deployment models.Deployment
	if err := db.Preload("Service.Project.Organization").
		Where("id = ?", deploymentID).
		First(&deployment).Error; err != nil {
		return false
	}

	// Check if user owns the organization
	return deployment.Service.Project.Organization.UserID == user.ID
}
