package cronjobs

import (
	"context"
	"encoding/json"
	"log"
	"regexp"
	"strings"

	"github.com/deployra/deployra/api/internal/crypto"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/redis"
	"github.com/deployra/deployra/api/internal/utils"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// envVar represents an environment variable
type envVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// replaceEnvVarsInHeaders replaces environment variable references in headers
func replaceEnvVarsInHeaders(headers map[string]string, envVars []envVar) map[string]string {
	if headers == nil {
		return nil
	}

	result := make(map[string]string)
	for key, value := range headers {
		newValue := value
		for _, env := range envVars {
			newValue = strings.ReplaceAll(newValue, "${"+env.Key+"}", env.Value)
			newValue = strings.ReplaceAll(newValue, "$"+env.Key, env.Value)
		}
		result[key] = newValue
	}

	return result
}

// cronExpressionRegex validates cron expression format
var cronExpressionRegex = regexp.MustCompile(`^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$`)

// CreateCronJobRequest represents the request body for creating a cronjob
type CreateCronJobRequest struct {
	Name     string            `json:"name"`
	Schedule string            `json:"schedule"`
	Path     string            `json:"path"`
	Headers  map[string]string `json:"headers,omitempty"`
	Enabled  *bool             `json:"enabled,omitempty"`
}

// UpdateCronJobRequest represents the request body for updating a cronjob
type UpdateCronJobRequest struct {
	Name     *string            `json:"name,omitempty"`
	Schedule *string            `json:"schedule,omitempty"`
	Path     *string            `json:"path,omitempty"`
	Headers  *map[string]string `json:"headers,omitempty"`
	Enabled  *bool              `json:"enabled,omitempty"`
}

// GET /api/services/:serviceId/cronjobs
func List(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Fetch cronjobs
	var cronJobs []models.CronJob
	db.Where("serviceId = ?", serviceID).
		Order("createdAt DESC").
		Find(&cronJobs)

	return response.Success(c, cronJobs)
}

// POST /api/services/:serviceId/cronjobs
func Create(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	var req CreateCronJobRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate required fields
	if req.Name == "" {
		return response.BadRequest(c, "Name is required")
	}
	if req.Schedule == "" {
		return response.BadRequest(c, "Schedule is required")
	}
	if req.Path == "" {
		return response.BadRequest(c, "Path is required")
	}

	// Validate cron expression
	if !cronExpressionRegex.MatchString(req.Schedule) {
		return response.BadRequest(c, "Invalid cron expression format")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Check for duplicate name
	var existingCronJob models.CronJob
	if err := db.Where("serviceId = ? AND name = ?", serviceID, req.Name).
		First(&existingCronJob).Error; err == nil {
		return c.Status(409).JSON(fiber.Map{
			"status":  "error",
			"message": "A cronjob with this name already exists for this service",
		})
	}

	// Create cronjob
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	var headersJSON models.JSON
	if req.Headers != nil {
		// Encrypt headers before storing
		encryptedHeaders, err := crypto.EncryptHeaders(req.Headers)
		if err != nil {
			return response.InternalServerError(c, "Failed to encrypt headers")
		}
		headersBytes, _ := json.Marshal(encryptedHeaders)
		headersJSON = models.JSON(headersBytes)
	}

	cronJob := models.CronJob{
		ID:        utils.GenerateShortID(),
		Name:      req.Name,
		Schedule:  req.Schedule,
		Path:      req.Path,
		Headers:   headersJSON,
		Enabled:   enabled,
		ServiceID: serviceID,
	}

	if err := db.Create(&cronJob).Error; err != nil {
		return response.InternalServerError(c, "Failed to create cronjob")
	}

	// Parse environment variables from service
	var envVars []envVar
	if service.EnvironmentVariables != nil {
		service.EnvironmentVariables.UnmarshalTo(&envVars)
		// Decrypt environment variables
		cryptoEnvVars := make([]crypto.EnvironmentVariable, len(envVars))
		for i, v := range envVars {
			cryptoEnvVars[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
		}
		decryptedEnvVars, _ := crypto.DecryptEnvVars(cryptoEnvVars)
		envVars = make([]envVar, len(decryptedEnvVars))
		for i, v := range decryptedEnvVars {
			envVars[i] = envVar{Key: v.Key, Value: v.Value}
		}
	}

	// Process headers with environment variables
	var processedHeaders map[string]string
	if req.Headers != nil {
		processedHeaders = replaceEnvVarsInHeaders(req.Headers, envVars)
	}

	// Publish to Redis for cron executor with full payload
	cronJobEvent := redis.CronJobEvent{
		ID:        cronJob.ID,
		Name:      cronJob.Name,
		Schedule:  cronJob.Schedule,
		Path:      cronJob.Path,
		Headers:   processedHeaders,
		Enabled:   cronJob.Enabled,
		ServiceID: cronJob.ServiceID,
		ProjectID: service.ProjectID,
	}
	if err := redis.PublishCronJobAdded(context.Background(), cronJobEvent); err != nil {
		log.Printf("Failed to publish cronjob added event: %v", err)
	}
	log.Printf("Created cronjob %s for service %s", cronJob.ID, serviceID)

	return response.Success(c, cronJob)
}

// GET /api/services/:serviceId/cronjobs/:cronJobId
func Get(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	cronJobID := c.Params("cronJobId")
	if serviceID == "" || cronJobID == "" {
		return response.BadRequest(c, "Service ID and CronJob ID are required")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Fetch cronjob
	var cronJob models.CronJob
	if err := db.Where("id = ? AND serviceId = ?", cronJobID, serviceID).
		First(&cronJob).Error; err != nil {
		return response.NotFound(c, "CronJob not found")
	}

	return response.Success(c, cronJob)
}

// PATCH /api/services/:serviceId/cronjobs/:cronJobId
func Update(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	cronJobID := c.Params("cronJobId")
	if serviceID == "" || cronJobID == "" {
		return response.BadRequest(c, "Service ID and CronJob ID are required")
	}

	var req UpdateCronJobRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate cron expression if provided
	if req.Schedule != nil && !cronExpressionRegex.MatchString(*req.Schedule) {
		return response.BadRequest(c, "Invalid cron expression format")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Fetch existing cronjob
	var cronJob models.CronJob
	if err := db.Where("id = ? AND serviceId = ?", cronJobID, serviceID).
		First(&cronJob).Error; err != nil {
		return response.NotFound(c, "CronJob not found")
	}

	// Check for duplicate name if updating
	if req.Name != nil && *req.Name != cronJob.Name {
		var existingCronJob models.CronJob
		if err := db.Where("serviceId = ? AND name = ? AND id != ?", serviceID, *req.Name, cronJobID).
			First(&existingCronJob).Error; err == nil {
			return c.Status(409).JSON(fiber.Map{
				"status":  "error",
				"message": "A cronjob with this name already exists for this service",
			})
		}
	}

	// Build update map
	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Schedule != nil {
		updates["schedule"] = *req.Schedule
	}
	if req.Path != nil {
		updates["path"] = *req.Path
	}
	if req.Headers != nil {
		// Encrypt headers before storing
		encryptedHeaders, err := crypto.EncryptHeaders(*req.Headers)
		if err != nil {
			return response.InternalServerError(c, "Failed to encrypt headers")
		}
		headersBytes, _ := json.Marshal(encryptedHeaders)
		updates["headers"] = models.JSON(headersBytes)
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}

	// Update cronjob
	if len(updates) > 0 {
		if err := db.Model(&models.CronJob{}).Where("id = ?", cronJobID).Updates(updates).Error; err != nil {
			return response.InternalServerError(c, "Failed to update cronjob")
		}
	}

	// Reload cronjob
	db.First(&cronJob, "id = ?", cronJobID)

	// Parse environment variables from service
	var envVars []envVar
	if service.EnvironmentVariables != nil {
		service.EnvironmentVariables.UnmarshalTo(&envVars)
		// Decrypt environment variables
		cryptoEnvVars := make([]crypto.EnvironmentVariable, len(envVars))
		for i, v := range envVars {
			cryptoEnvVars[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
		}
		decryptedEnvVars, _ := crypto.DecryptEnvVars(cryptoEnvVars)
		envVars = make([]envVar, len(decryptedEnvVars))
		for i, v := range decryptedEnvVars {
			envVars[i] = envVar{Key: v.Key, Value: v.Value}
		}
	}

	// Parse and process headers with environment variables
	var processedHeaders map[string]string
	if cronJob.Headers != nil {
		var headers map[string]string
		cronJob.Headers.UnmarshalTo(&headers)
		// Decrypt headers before processing
		decryptedHeaders, _ := crypto.DecryptHeaders(headers)
		processedHeaders = replaceEnvVarsInHeaders(decryptedHeaders, envVars)
	}

	// Publish update to Redis for cron executor with full payload
	cronJobEvent := redis.CronJobEvent{
		ID:        cronJob.ID,
		Name:      cronJob.Name,
		Schedule:  cronJob.Schedule,
		Path:      cronJob.Path,
		Headers:   processedHeaders,
		Enabled:   cronJob.Enabled,
		ServiceID: cronJob.ServiceID,
		ProjectID: service.ProjectID,
	}
	if err := redis.PublishCronJobUpdated(context.Background(), cronJobEvent); err != nil {
		log.Printf("Failed to publish cronjob updated event: %v", err)
	}
	log.Printf("Updated cronjob %s for service %s", cronJobID, serviceID)

	return response.Success(c, cronJob)
}

// DELETE /api/services/:serviceId/cronjobs/:cronJobId
func Delete(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	cronJobID := c.Params("cronJobId")
	if serviceID == "" || cronJobID == "" {
		return response.BadRequest(c, "Service ID and CronJob ID are required")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access
	if service.Project.Organization.UserID != user.ID {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Fetch cronjob
	var cronJob models.CronJob
	if err := db.Where("id = ? AND serviceId = ?", cronJobID, serviceID).
		First(&cronJob).Error; err != nil {
		return response.NotFound(c, "CronJob not found")
	}

	// Delete cronjob
	if err := db.Delete(&cronJob).Error; err != nil {
		return response.InternalServerError(c, "Failed to delete cronjob")
	}

	// Publish deletion to Redis for cron executor with full payload
	deleteEvent := redis.CronJobDeleteEvent{
		ID:        cronJobID,
		ServiceID: serviceID,
		ProjectID: service.ProjectID,
	}
	if err := redis.PublishCronJobDeleted(context.Background(), deleteEvent); err != nil {
		log.Printf("Failed to publish cronjob deleted event: %v", err)
	}
	log.Printf("Deleted cronjob %s for service %s", cronJobID, serviceID)

	return response.Success(c, fiber.Map{
		"message": "CronJob deleted successfully",
	})
}
