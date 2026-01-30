package auth

import (
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// GET /api/auth/user (protected)
func GetUser(c *fiber.Ctx) error {
	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid token")
	}

	return response.Success(c, fiber.Map{
		"id":            user.ID,
		"email":         user.Email,
		"firstName":     user.FirstName,
		"lastName":      user.LastName,
		"emailVerified": user.EmailVerified,
		"createdAt":     user.CreatedAt,
	})
}
