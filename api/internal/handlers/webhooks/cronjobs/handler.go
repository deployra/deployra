package cronjobs

import (
	"log"
	"strings"
	"time"

	"github.com/deployra/deployra/api/internal/crypto"
	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// CronJobStatusUpdateRequest represents the cronjob status update request
type CronJobStatusUpdateRequest struct {
	LastRunAt  string  `json:"lastRunAt"`
	NextRunAt  *string `json:"nextRunAt"`
	Status     *string `json:"status,omitempty"`     // success, failed
	StatusCode *int    `json:"statusCode,omitempty"`
	Response   *string `json:"response,omitempty"`
	Error      *string `json:"error,omitempty"`
}

// CronJobResponse represents a formatted cronjob for the list endpoint
type CronJobResponse struct {
	ID               string                 `json:"id"`
	Name             string                 `json:"name"`
	Schedule         string                 `json:"schedule"`
	Path             string                 `json:"path"`
	Headers          map[string]string      `json:"headers,omitempty"`
	Enabled          bool                   `json:"enabled"`
	ServiceID        string                 `json:"serviceId"`
	CreatedAt        time.Time              `json:"createdAt"`
	UpdatedAt        time.Time              `json:"updatedAt"`
	LastRunAt        *time.Time             `json:"lastRunAt,omitempty"`
	NextRunAt        *time.Time             `json:"nextRunAt,omitempty"`
	ProjectID        string                 `json:"projectId"`
	ProjectName      string                 `json:"projectName"`
	ServiceName      string                 `json:"serviceName"`
	OrganizationID   string                 `json:"organizationId"`
	OrganizationName string                 `json:"organizationName"`
}

// GET /api/webhooks/cronjob
func List(c *fiber.Ctx) error {
	db := database.GetDatabase()

	// Get all enabled CronJobs with their service and project information
	var cronJobs []models.CronJob
	db.Preload("Service.Project.Organization").
		Where("enabled = ?", true).
		Order("updatedAt DESC").
		Find(&cronJobs)

	// Format the response
	formattedCronJobs := make([]CronJobResponse, 0, len(cronJobs))

	for _, job := range cronJobs {
		// Parse environment variables from service
		var envVars []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if job.Service.EnvironmentVariables != nil {
			job.Service.EnvironmentVariables.UnmarshalTo(&envVars)
			// Decrypt environment variables
			cryptoEnvVars := make([]crypto.EnvironmentVariable, len(envVars))
			for i, v := range envVars {
				cryptoEnvVars[i] = crypto.EnvironmentVariable{Key: v.Key, Value: v.Value}
			}
			decryptedEnvVars, _ := crypto.DecryptEnvVars(cryptoEnvVars)
			envVars = make([]struct {
				Key   string `json:"key"`
				Value string `json:"value"`
			}, len(decryptedEnvVars))
			for i, v := range decryptedEnvVars {
				envVars[i] = struct {
					Key   string `json:"key"`
					Value string `json:"value"`
				}{Key: v.Key, Value: v.Value}
			}
		}

		// Parse and process headers
		var headers map[string]string
		if job.Headers != nil {
			job.Headers.UnmarshalTo(&headers)
			// Decrypt headers before processing
			decryptedHeaders, _ := crypto.DecryptHeaders(headers)
			headers = replaceEnvVarsInHeaders(decryptedHeaders, envVars)
		}

		formattedCronJobs = append(formattedCronJobs, CronJobResponse{
			ID:               job.ID,
			Name:             job.Name,
			Schedule:         job.Schedule,
			Path:             job.Path,
			Headers:          headers,
			Enabled:          job.Enabled,
			ServiceID:        job.ServiceID,
			CreatedAt:        job.CreatedAt,
			UpdatedAt:        job.UpdatedAt,
			LastRunAt:        job.LastRunAt,
			NextRunAt:        job.NextRunAt,
			ProjectID:        job.Service.ProjectID,
			ProjectName:      job.Service.Project.Name,
			ServiceName:      job.Service.Name,
			OrganizationID:   job.Service.Project.OrganizationID,
			OrganizationName: job.Service.Project.Organization.Name,
		})
	}

	return response.Success(c, formattedCronJobs)
}

// POST /api/webhooks/cronjob/:cronjobId/status
func UpdateStatus(c *fiber.Ctx) error {
	db := database.GetDatabase()

	cronJobID := c.Params("cronjobId")
	if cronJobID == "" {
		return response.BadRequest(c, "CronJob ID is required")
	}

	var req CronJobStatusUpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	// Validate lastRunAt
	lastRunAt, err := time.Parse(time.RFC3339, req.LastRunAt)
	if err != nil {
		return response.BadRequest(c, "Invalid lastRunAt format")
	}

	// Parse nextRunAt if provided
	var nextRunAt *time.Time
	if req.NextRunAt != nil && *req.NextRunAt != "" {
		t, err := time.Parse(time.RFC3339, *req.NextRunAt)
		if err == nil {
			nextRunAt = &t
		}
	}

	// Find the CronJob
	var cronJob models.CronJob
	if err := db.Preload("Service.Project.Organization").
		Where("id = ?", cronJobID).
		First(&cronJob).Error; err != nil {
		return response.NotFound(c, "CronJob not found")
	}

	// Update the CronJob status
	updates := map[string]interface{}{
		"lastRunAt": lastRunAt,
		"updatedAt": time.Now(),
	}

	if nextRunAt != nil {
		updates["nextRunAt"] = nextRunAt
	}

	if err := db.Model(&models.CronJob{}).Where("id = ?", cronJobID).Updates(updates).Error; err != nil {
		return response.InternalServerError(c, "Failed to update CronJob status")
	}

	// Create execution record if status is provided
	if req.Status != nil {
		log.Printf("CronJob execution details: cronJobId=%s status=%s statusCode=%v executedAt=%s",
			cronJobID, *req.Status, req.StatusCode, lastRunAt)

		// Create CronJobExecution record
		execution := models.CronJobExecution{
			ID:         uuid.New().String(),
			CronJobID:  cronJobID,
			Status:     *req.Status,
			StatusCode: req.StatusCode,
			Response:   req.Response,
			Error:      req.Error,
			ExecutedAt: lastRunAt,
		}
		if err := db.Create(&execution).Error; err != nil {
			log.Printf("Failed to create CronJobExecution record: %v", err)
		}
	}

	// Reload cronJob
	db.First(&cronJob, "id = ?", cronJobID)

	return response.Success(c, cronJob)
}

// replaceEnvVarsInHeaders replaces environment variable references in headers
func replaceEnvVarsInHeaders(headers map[string]string, envVars []struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}) map[string]string {
	if headers == nil {
		return nil
	}

	result := make(map[string]string)

	for key, value := range headers {
		newValue := value
		for _, env := range envVars {
			// Replace ${VAR_NAME} or $VAR_NAME patterns
			newValue = strings.ReplaceAll(newValue, "${"+env.Key+"}", env.Value)
			newValue = strings.ReplaceAll(newValue, "$"+env.Key, env.Value)
		}
		result[key] = newValue
	}

	return result
}
