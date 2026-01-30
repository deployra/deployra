package instancetypes

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/instance-types?instanceTypeGroupId=xxx
func List(c *fiber.Ctx) error {
	db := database.GetDatabase()

	instanceTypeGroupID := c.Query("instanceTypeGroupId")
	if instanceTypeGroupID == "" {
		return response.BadRequest(c, "Instance type group ID is required")
	}

	var instanceTypes []models.InstanceType
	err := db.Where("instanceTypeGroupId = ? AND isVisible = ?", instanceTypeGroupID, true).
		Order("`index` ASC").
		Find(&instanceTypes).Error

	if err != nil {
		return response.InternalServerError(c, "Failed to fetch instance types")
	}

	return response.Success(c, instanceTypes)
}
