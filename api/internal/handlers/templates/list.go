package templates

import (
	"strconv"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/templates
func List(c *fiber.Ctx) error {
	db := database.GetDatabase()

	search := c.Query("search")
	category := c.Query("category")
	featured := c.Query("featured")
	limit, _ := strconv.Atoi(c.Query("limit", "20"))
	offset, _ := strconv.Atoi(c.Query("offset", "0"))

	query := db.Model(&models.Template{}).Where("published = ?", true)

	if search != "" {
		query = query.Where("title LIKE ? OR description LIKE ? OR tags LIKE ?",
			"%"+search+"%", "%"+search+"%", "%"+search+"%")
	}

	if category != "" {
		query = query.Where("category = ?", category)
	}

	if featured == "true" {
		query = query.Where("featured = ?", true)
	}

	// Count total
	var total int64
	query.Count(&total)

	// Get templates
	var templates []models.Template
	query.Select("id, slug, title, description, category, tags, author, featured, usageCount, createdAt, updatedAt").
		Order("featured DESC, usageCount DESC, createdAt DESC").
		Limit(limit).
		Offset(offset).
		Find(&templates)

	return response.Success(c, fiber.Map{
		"templates": templates,
		"total":     total,
		"hasMore":   int64(offset+limit) < total,
	})
}
