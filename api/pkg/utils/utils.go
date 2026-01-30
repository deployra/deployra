package utils

import (
	"net/mail"
	"regexp"
	"time"

	"github.com/deployra/deployra/api/internal/config"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	gonanoid "github.com/matoous/go-nanoid/v2"
)

// GenerateShortID generates a short ID (first char alphabetic, rest alphanumeric)
// This matches the NextJS generateShortId function
func GenerateShortID() string {
	firstChar, _ := gonanoid.Generate("abcdefghijklmnopqrstuvwxyz", 1)
	rest, _ := gonanoid.Generate("abcdefghijklmnopqrstuvwxyz0123456789", 19)
	return firstChar + rest
}

// ValidateEmail validates email format using Go's net/mail package
func ValidateEmail(email string) bool {
	_, err := mail.ParseAddress(email)
	return err == nil
}

// PasswordValidationResult holds the result of password validation
type PasswordValidationResult struct {
	IsValid bool
	Errors  []string
}

// ValidatePassword validates password strength
func ValidatePassword(password string) PasswordValidationResult {
	var errors []string

	if len(password) < 8 {
		errors = append(errors, "Password must be at least 8 characters")
	}

	if !regexp.MustCompile(`[A-Z]`).MatchString(password) {
		errors = append(errors, "Password must contain at least one uppercase letter")
	}

	if !regexp.MustCompile(`[a-z]`).MatchString(password) {
		errors = append(errors, "Password must contain at least one lowercase letter")
	}

	if !regexp.MustCompile(`[0-9]`).MatchString(password) {
		errors = append(errors, "Password must contain at least one number")
	}

	if !regexp.MustCompile(`[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]`).MatchString(password) {
		errors = append(errors, "Password must contain at least one special character")
	}

	return PasswordValidationResult{
		IsValid: len(errors) == 0,
		Errors:  errors,
	}
}

// GetClientIP extracts client IP from Fiber request
func GetClientIP(c *fiber.Ctx) string {
	// Check X-Forwarded-For header first
	if xff := c.Get("X-Forwarded-For"); xff != "" {
		return xff
	}
	// Check X-Real-IP header
	if xri := c.Get("X-Real-IP"); xri != "" {
		return xri
	}
	// Fall back to remote address
	return c.IP()
}

// GenerateToken generates a JWT token for authentication
func GenerateToken(userID, email string) (string, error) {
	cfg := config.Get()
	claims := jwt.MapClaims{
		"userId": userID,
		"email":  email,
		"exp":    time.Now().Add(time.Hour * 24 * 7).Unix(), // 7 days
		"iat":    time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(cfg.JWTSecret))
}
