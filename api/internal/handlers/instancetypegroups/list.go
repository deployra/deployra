package instancetypegroups

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// GET /api/instance-type-groups?serviceTypeId=xxx
func List(c *fiber.Ctx) error {
	db := database.GetDatabase()

	serviceTypeID := c.Query("serviceTypeId")
	if serviceTypeID == "" {
		return response.BadRequest(c, "serviceTypeId is required")
	}

	var instanceTypeGroups []models.InstanceTypeGroup
	err := db.Where("serviceTypeId = ? AND isVisible = ?", serviceTypeID, true).
		Order("`index` ASC").
		Preload("InstanceTypes", func(db *gorm.DB) *gorm.DB {
			return db.Where("isVisible = ?", true).Order("`index` ASC")
		}).
		Find(&instanceTypeGroups).Error

	if err != nil {
		return response.InternalServerError(c, "Failed to fetch instance type groups")
	}

	return response.Success(c, instanceTypeGroups)
}
