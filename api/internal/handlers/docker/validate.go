package docker

import (
	"fmt"

	"github.com/deployra/deployra/api/pkg/docker"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// ValidateRequest represents the validate image request body
type ValidateRequest struct {
	ImageURL       string `json:"imageUrl"`
	DockerUsername string `json:"dockerUsername"`
	DockerPassword string `json:"dockerPassword"`
}

// ValidateImage validates if a Docker image exists
func ValidateImage(c *fiber.Ctx) error {
	var req ValidateRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if req.ImageURL == "" {
		return response.BadRequest(c, "Image URL is required")
	}

	isValid, err := docker.ValidateImage(req.ImageURL, req.DockerUsername, req.DockerPassword)
	if err != nil {
		fmt.Printf("Error validating Docker image: %v\n", err)
		return response.InternalServerError(c, "Failed to validate Docker image")
	}

	return response.Success(c, fiber.Map{
		"isValid": isValid,
	})
}
