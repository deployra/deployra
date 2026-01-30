package account

import (
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/bcrypt"
)

type UpdatePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
	ConfirmPassword string `json:"confirmPassword"`
}

func UpdatePassword(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Invalid authentication")
	}

	var req UpdatePasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate
	if len(req.CurrentPassword) < 6 {
		return response.BadRequest(c, "Current password must be at least 6 characters")
	}
	if len(req.NewPassword) < 6 {
		return response.BadRequest(c, "New password must be at least 6 characters")
	}
	if req.NewPassword != req.ConfirmPassword {
		return response.BadRequest(c, "Passwords don't match")
	}

	// Verify current password
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.CurrentPassword)); err != nil {
		return response.BadRequest(c, "Current password is incorrect")
	}

	// Hash new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), 12)
	if err != nil {
		return response.InternalServerError(c, "Failed to update password")
	}

	// Update password
	if err := db.Model(&models.User{}).Where("id = ?", user.ID).Update("password", string(hashedPassword)).Error; err != nil {
		return response.InternalServerError(c, "Failed to update password")
	}

	return response.Success(c, fiber.Map{
		"message": "Password updated successfully",
	})
}
