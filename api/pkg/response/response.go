package response

import "github.com/gofiber/fiber/v2"

// Response represents the standard API response structure
// This structure MUST match the existing NextJS API response format
type Response struct {
	Status  string      `json:"status"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// Success returns a success response
func Success(c *fiber.Ctx, data interface{}) error {
	return c.JSON(Response{
		Status: "success",
		Data:   data,
	})
}

// SuccessWithMessage returns a success response with message
func SuccessWithMessage(c *fiber.Ctx, message string, data interface{}) error {
	return c.JSON(Response{
		Status:  "success",
		Message: message,
		Data:    data,
	})
}

// Error returns an error response with status code
func Error(c *fiber.Ctx, statusCode int, message string) error {
	return c.Status(statusCode).JSON(Response{
		Status:  "error",
		Message: message,
	})
}

// BadRequest returns a 400 error
func BadRequest(c *fiber.Ctx, message string) error {
	return Error(c, fiber.StatusBadRequest, message)
}

// Unauthorized returns a 401 error
func Unauthorized(c *fiber.Ctx, message string) error {
	return Error(c, fiber.StatusUnauthorized, message)
}

// Forbidden returns a 403 error
func Forbidden(c *fiber.Ctx, message string) error {
	return Error(c, fiber.StatusForbidden, message)
}

// NotFound returns a 404 error
func NotFound(c *fiber.Ctx, message string) error {
	return Error(c, fiber.StatusNotFound, message)
}

// InternalServerError returns a 500 error
func InternalServerError(c *fiber.Ctx, message string) error {
	return Error(c, fiber.StatusInternalServerError, message)
}

// TooManyRequests returns a 429 error
func TooManyRequests(c *fiber.Ctx, message string) error {
	return Error(c, fiber.StatusTooManyRequests, message)
}

// PaymentRequired returns a 402 error
func PaymentRequired(c *fiber.Ctx, message string, data interface{}) error {
	return c.Status(fiber.StatusPaymentRequired).JSON(Response{
		Status:  "error",
		Message: message,
		Data:    data,
	})
}
