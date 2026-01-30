package servicetypes

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/service-types
func List(c *fiber.Ctx) error {
	db := database.GetDatabase()

	var serviceTypes []models.ServiceType
	if err := db.Preload("Tag").
		Where("isVisible = ?", true).
		Order("`index` ASC, title ASC").
		Find(&serviceTypes).Error; err != nil {
		return response.InternalServerError(c, "Failed to fetch service types")
	}

	return response.Success(c, serviceTypes)
}
