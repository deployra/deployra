package middleware

import (
	"strings"
	"time"

	"github.com/deployra/deployra/api/internal/config"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// AuthMiddleware validates only JWT token (no API key support)
func AuthMiddleware(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, err := authenticate(c, cfg.JWTSecret, false)
		if err != nil {
			return response.Unauthorized(c, err.Error())
		}

		c.Locals("user", user)
		return c.Next()
	}
}

// AuthMiddlewareWithApiKey validates JWT token or API key
func AuthMiddlewareWithApiKey(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, err := authenticate(c, cfg.JWTSecret, true)
		if err != nil {
			return response.Unauthorized(c, err.Error())
		}

		c.Locals("user", user)
		return c.Next()
	}
}

func authenticate(c *fiber.Ctx, jwtSecret string, allowApiKey bool) (*models.User, error) {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid or missing token")
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid or missing token")
	}

	token := parts[1]
	db := database.GetDatabase()

	// API key authentication (only if allowed)
	if allowApiKey && strings.HasPrefix(token, "dk_") {
		var apiKey models.ApiKey
		if err := db.Preload("User").Where("key = ? AND revoked = ?", token, false).First(&apiKey).Error; err != nil {
			return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid or revoked API key")
		}

		if apiKey.User.DeletedAt != nil {
			return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid or revoked API key")
		}

		db.Model(&apiKey).Update("lastUsedAt", time.Now())
		return &apiKey.User, nil
	}

	// JWT authentication
	claims, err := parseJWT(token, jwtSecret)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid token")
	}

	var user models.User
	if err := db.Where("id = ? AND deletedAt IS NULL", claims.UserID).First(&user).Error; err != nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid token")
	}

	return &user, nil
}

func parseJWT(tokenString string, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid token")
}

// WebhookApiKeyMiddleware validates the X-Api-Key header against WEBHOOK_API_KEY
// Used by internal services: builder, kronjob, kubestrator, kumonitor
func WebhookApiKeyMiddleware(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		apiKey := c.Get("X-Api-Key")

		if apiKey == "" {
			return response.Unauthorized(c, "Missing API key header")
		}

		if cfg.WebhookApiKey == "" {
			return response.InternalServerError(c, "Webhook API key is not configured")
		}

		if apiKey != cfg.WebhookApiKey {
			return response.Unauthorized(c, "Invalid API key")
		}

		return c.Next()
	}
}
