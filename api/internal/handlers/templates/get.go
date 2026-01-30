package templates

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/templates/:slug
func Get(c *fiber.Ctx) error {
	db := database.GetDatabase()
	slug := c.Params("slug")

	if slug == "" {
		return response.BadRequest(c, "Template slug is required")
	}

	var template models.Template
	if err := db.Where("slug = ? AND published = ?", slug, true).
		First(&template).Error; err != nil {
		return response.NotFound(c, "Template not found")
	}

	// Increment usage count
	db.Model(&template).Update("usageCount", template.UsageCount+1)

	return response.Success(c, template)
}
