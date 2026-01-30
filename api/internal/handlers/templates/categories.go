package templates

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

type CategoryCount struct {
	Category string `gorm:"column:category" json:"name"`
	Count    int64  `gorm:"column:count" json:"count"`
}

// GET /api/templates/categories
func Categories(c *fiber.Ctx) error {
	db := database.GetDatabase()

	var results []CategoryCount
	db.Model(&models.Template{}).
		Select("category, COUNT(*) as count").
		Where("published = ?", true).
		Group("category").
		Order("count DESC").
		Scan(&results)

	return response.Success(c, results)
}
