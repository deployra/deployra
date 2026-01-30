package auth

import (
	"fmt"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/deployra/deployra/api/pkg/utils"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/bcrypt"
)

// LoginRequest represents the login request body
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Login handles user login
func Login(c *fiber.Ctx) error {
	// Parse request body
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate email
	if !utils.ValidateEmail(req.Email) {
		return response.BadRequest(c, "Invalid email address")
	}

	// Validate password
	if len(req.Password) == 0 {
		return response.BadRequest(c, "Password is required")
	}

	db := database.GetDatabase()

	// Find user by email
	var user models.User
	if err := db.Where("email = ? AND deletedAt IS NULL", req.Email).First(&user).Error; err != nil {
		return response.BadRequest(c, "Email and password do not match")
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		return response.BadRequest(c, "Email and password do not match")
	}

	// Generate JWT token
	token, err := utils.GenerateToken(user.ID, user.Email)
	if err != nil {
		fmt.Printf("Token generation error: %v\n", err)
		return response.InternalServerError(c, "Internal server error")
	}

	return response.Success(c, fiber.Map{
		"user": fiber.Map{
			"id":            user.ID,
			"email":         user.Email,
			"firstName":     user.FirstName,
			"lastName":      user.LastName,
			"emailVerified": user.EmailVerified,
		},
		"token": token,
	})
}
