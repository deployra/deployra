package envvars

import (
	"context"
	"encoding/json"
	"log"
	"net/url"
	"regexp"
	"strings"

	"github.com/deployra/deployra/api/internal/crypto"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/deploy"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/internal/redis"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// ENV_KEY_REGEX validates environment variable key format
var ENV_KEY_REGEX = regexp.MustCompile(`^[-._a-zA-Z0-9]+$`)

// EnvironmentVariable represents an environment variable
type EnvironmentVariable struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// checkEnvVariableAccess checks if user has access to environment variables
// NO admin bypass - only the service owner can access environment variables
func checkEnvVariableAccess(user *models.User, service *models.Service) bool {
	// Environment variables are sensitive - only owner can access, not admin
	return service.Project.Organization.UserID == user.ID
}

// replaceEnvVarsInHeaders replaces environment variable references in headers
func replaceEnvVarsInHeaders(headers map[string]string, envVars []EnvironmentVariable) map[string]string {
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

// UpdateEnvVarsRequest represents the request body for updating environment variables
type UpdateEnvVarsRequest struct {
	Variables []EnvironmentVariable `json:"variables"`
}

// DeleteEnvVarsRequest represents the request body for deleting environment variables
type DeleteEnvVarsRequest struct {
	Keys []string `json:"keys"`
}

// GET /api/services/:serviceId/environment-variables
// Returns all environment variables with masked values
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

	// Check access - NO admin bypass for environment variables
	if !checkEnvVariableAccess(user, &service) {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Parse environment variables and mask values
	var envVars []EnvironmentVariable
	service.EnvironmentVariables.UnmarshalTo(&envVars)

	// Mask all values
	maskedVars := make([]EnvironmentVariable, len(envVars))
	for i, v := range envVars {
		maskedVars[i] = EnvironmentVariable{
			Key:   v.Key,
			Value: "***",
		}
	}

	return response.Success(c, maskedVars)
}

// GET /api/services/:serviceId/environment-variables/:key
// Returns a specific environment variable value (owner only)
func Get(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	key := c.Params("key")
	if serviceID == "" || key == "" {
		return response.BadRequest(c, "Service ID and environment variable key are required")
	}

	// URL decode the key
	decodedKey, err := url.QueryUnescape(key)
	if err != nil {
		decodedKey = key
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access - NO admin bypass for environment variables
	if !checkEnvVariableAccess(user, &service) {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Parse environment variables
	var envVars []EnvironmentVariable
	service.EnvironmentVariables.UnmarshalTo(&envVars)

	// Decrypt environment variables
	cryptoEnvVars := make([]crypto.EnvironmentVariable, len(envVars))
	for i, v := range envVars {
		cryptoEnvVars[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
	}
	decryptedEnvVars, _ := crypto.DecryptEnvVars(cryptoEnvVars)

	// Find the requested key
	for _, v := range decryptedEnvVars {
		if v.Key == decodedKey {
			return response.Success(c, fiber.Map{
				"value": v.Value,
			})
		}
	}

	return response.NotFound(c, "Environment variable not found")
}

// PATCH /api/services/:serviceId/environment-variables/update
// Updates or adds environment variables
func Update(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	var req UpdateEnvVarsRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if len(req.Variables) == 0 {
		return response.BadRequest(c, "No environment variables provided for update")
	}

	// Validate environment variable keys
	for _, v := range req.Variables {
		if v.Key == "" {
			return response.BadRequest(c, "Invalid environment variable key")
		}
		if !ENV_KEY_REGEX.MatchString(v.Key) {
			return response.BadRequest(c, "Invalid key format: \""+v.Key+"\". Keys must only contain letters, numbers, hyphens, underscores, and periods.")
		}
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access - NO admin bypass for environment variables
	if !checkEnvVariableAccess(user, &service) {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Get current environment variables and decrypt them
	var currentEnvVars []EnvironmentVariable
	service.EnvironmentVariables.UnmarshalTo(&currentEnvVars)

	// Decrypt existing variables for comparison
	cryptoEnvVars := make([]crypto.EnvironmentVariable, len(currentEnvVars))
	for i, v := range currentEnvVars {
		cryptoEnvVars[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
	}
	decryptedEnvVars, _ := crypto.DecryptEnvVars(cryptoEnvVars)

	// Convert back to local type
	currentDecrypted := make([]EnvironmentVariable, len(decryptedEnvVars))
	for i, v := range decryptedEnvVars {
		currentDecrypted[i] = EnvironmentVariable{Key: v.Key, Value: v.Value}
	}

	// Update or add variables (working with decrypted values)
	for _, newVar := range req.Variables {
		found := false
		for i, existingVar := range currentDecrypted {
			if existingVar.Key == newVar.Key {
				currentDecrypted[i] = newVar
				found = true
				break
			}
		}
		if !found {
			currentDecrypted = append(currentDecrypted, newVar)
		}
	}

	// Encrypt before storing
	toEncrypt := make([]crypto.EnvironmentVariable, len(currentDecrypted))
	for i, v := range currentDecrypted {
		toEncrypt[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
	}
	encryptedEnvVars, err := crypto.EncryptEnvVars(toEncrypt)
	if err != nil {
		return response.InternalServerError(c, "Failed to encrypt environment variables")
	}

	// Convert back to local type for storage
	currentEnvVars = make([]EnvironmentVariable, len(encryptedEnvVars))
	for i, v := range encryptedEnvVars {
		currentEnvVars[i] = EnvironmentVariable{Key: v.Key, Value: v.Value}
	}

	// Update service
	envJSON, _ := json.Marshal(currentEnvVars)
	if err := db.Model(&service).Update("environmentVariables", envJSON).Error; err != nil {
		return response.InternalServerError(c, "Failed to update environment variables")
	}

	// Trigger redeploy if service is running
	if service.Status == models.ServiceStatusRunning ||
		service.Status == models.ServiceStatusFailed ||
		service.Status == models.ServiceStatusRestarting {
		go func() {
			if err := deploy.DeployService("deploy-service", nil, serviceID); err != nil {
				log.Printf("Error redeploying service: %v", err)
			}
		}()
	}

	// Update cronjobs with decrypted values
	updateCronJobsForService(serviceID, service.ProjectID, currentDecrypted)

	return response.Success(c, fiber.Map{
		"message": "Environment variables updated successfully",
		"count":   len(req.Variables),
	})
}

// POST /api/services/:serviceId/environment-variables/delete
// Deletes specified environment variables
func Delete(c *fiber.Ctx) error {
	db := database.GetDatabase()

	user, ok := c.Locals("user").(*models.User)
	if !ok {
		return response.Unauthorized(c, "Unauthorized")
	}

	serviceID := c.Params("serviceId")
	if serviceID == "" {
		return response.BadRequest(c, "Service ID is required")
	}

	var req DeleteEnvVarsRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if len(req.Keys) == 0 {
		return response.BadRequest(c, "No environment variable keys provided for deletion")
	}

	// Fetch the service with access check
	var service models.Service
	if err := db.Preload("Project.Organization").
		Where("id = ? AND deletedAt IS NULL", serviceID).
		First(&service).Error; err != nil {
		return response.NotFound(c, "Service not found")
	}

	// Check access - NO admin bypass for environment variables
	if !checkEnvVariableAccess(user, &service) {
		return response.Forbidden(c, "Service not found or access denied")
	}

	// Get current environment variables and decrypt them
	var currentEnvVars []EnvironmentVariable
	service.EnvironmentVariables.UnmarshalTo(&currentEnvVars)

	// Decrypt existing variables
	cryptoEnvVars := make([]crypto.EnvironmentVariable, len(currentEnvVars))
	for i, v := range currentEnvVars {
		cryptoEnvVars[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
	}
	decryptedEnvVars, _ := crypto.DecryptEnvVars(cryptoEnvVars)

	// Convert back to local type
	currentDecrypted := make([]EnvironmentVariable, len(decryptedEnvVars))
	for i, v := range decryptedEnvVars {
		currentDecrypted[i] = EnvironmentVariable{Key: v.Key, Value: v.Value}
	}

	// Filter out variables to delete (working with decrypted values)
	keysToDelete := make(map[string]bool)
	for _, key := range req.Keys {
		keysToDelete[key] = true
	}

	var updatedDecrypted []EnvironmentVariable
	for _, v := range currentDecrypted {
		if !keysToDelete[v.Key] {
			updatedDecrypted = append(updatedDecrypted, v)
		}
	}

	deletedCount := len(currentDecrypted) - len(updatedDecrypted)

	// Encrypt before storing
	toEncrypt := make([]crypto.EnvironmentVariable, len(updatedDecrypted))
	for i, v := range updatedDecrypted {
		toEncrypt[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
	}
	encryptedEnvVars, err := crypto.EncryptEnvVars(toEncrypt)
	if err != nil {
		return response.InternalServerError(c, "Failed to encrypt environment variables")
	}

	// Convert back to local type for storage
	updatedEnvVars := make([]EnvironmentVariable, len(encryptedEnvVars))
	for i, v := range encryptedEnvVars {
		updatedEnvVars[i] = EnvironmentVariable{Key: v.Key, Value: v.Value}
	}

	// Update service
	envJSON, _ := json.Marshal(updatedEnvVars)
	if err := db.Model(&service).Update("environmentVariables", envJSON).Error; err != nil {
		return response.InternalServerError(c, "Failed to delete environment variables")
	}

	// Trigger redeploy if service is running
	if service.Status == models.ServiceStatusRunning ||
		service.Status == models.ServiceStatusFailed ||
		service.Status == models.ServiceStatusRestarting {
		go func() {
			if err := deploy.DeployService("deploy-service", nil, serviceID); err != nil {
				log.Printf("Error redeploying service: %v", err)
			}
		}()
	}

	// Update cronjobs with decrypted values
	updateCronJobsForService(serviceID, service.ProjectID, updatedDecrypted)

	return response.Success(c, fiber.Map{
		"message": "Environment variables deleted successfully",
		"count":   deletedCount,
	})
}

// updateCronJobsForService publishes cronjob update events when environment variables change
func updateCronJobsForService(serviceID, projectID string, envVars []EnvironmentVariable) {
	db := database.GetDatabase()
	var cronjobs []models.CronJob
	db.Where("serviceId = ? AND enabled = ?", serviceID, true).Find(&cronjobs)

	ctx := context.Background()
	for _, cronjob := range cronjobs {
		// Parse and process headers with environment variables
		var processedHeaders map[string]string
		if cronjob.Headers != nil {
			var headers map[string]string
			cronjob.Headers.UnmarshalTo(&headers)
			// Decrypt headers before processing
			decryptedHeaders, _ := crypto.DecryptHeaders(headers)
			processedHeaders = replaceEnvVarsInHeaders(decryptedHeaders, envVars)
		}

		// Publish update event to Redis for the cron executor with full payload
		cronJobEvent := redis.CronJobEvent{
			ID:        cronjob.ID,
			Name:      cronjob.Name,
			Schedule:  cronjob.Schedule,
			Path:      cronjob.Path,
			Headers:   processedHeaders,
			Enabled:   cronjob.Enabled,
			ServiceID: cronjob.ServiceID,
			ProjectID: projectID,
		}
		if err := redis.PublishCronJobUpdated(ctx, cronJobEvent); err != nil {
			log.Printf("Failed to publish cronjob updated event for %s: %v", cronjob.ID, err)
		} else {
			log.Printf("Published cronjob updated event for %s due to env vars change", cronjob.ID)
		}
	}
}
