package account

import (
	"net/mail"
	"time"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

type UpdateProfileRequest struct {
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	Email     string `json:"email"`
}

type ProfileResponse struct {
	ID            string     `json:"id"`
	Email         string     `json:"email"`
	FirstName     string     `json:"firstName"`
	LastName      string     `json:"lastName"`
	EmailVerified *time.Time `json:"emailVerified"`
}

func UpdateProfile(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	var req UpdateProfileRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate
	if len(req.FirstName) < 2 {
		return response.BadRequest(c, "First name must be at least 2 characters")
	}
	if len(req.LastName) < 2 {
		return response.BadRequest(c, "Last name must be at least 2 characters")
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return response.BadRequest(c, "Invalid email format")
	}

	// Check if email is already taken by another user
	var existingUser models.User
	if err := db.Where("email = ? AND id != ?", req.Email, user.ID).First(&existingUser).Error; err == nil {
		return response.BadRequest(c, "Email already taken")
	}

	// Update user profile
	if err := db.Model(&models.User{}).Where("id = ?", user.ID).Updates(map[string]interface{}{
		"firstName": req.FirstName,
		"lastName":  req.LastName,
		"email":     req.Email,
	}).Error; err != nil {
		return response.InternalServerError(c, "Failed to update profile")
	}

	// Get updated user
	var updatedUser models.User
	db.Where("id = ?", user.ID).First(&updatedUser)

	return response.Success(c, fiber.Map{
		"user": ProfileResponse{
			ID:            updatedUser.ID,
			Email:         updatedUser.Email,
			FirstName:     *updatedUser.FirstName,
			LastName:      *updatedUser.LastName,
			EmailVerified: updatedUser.EmailVerified,
		},
	})
}
