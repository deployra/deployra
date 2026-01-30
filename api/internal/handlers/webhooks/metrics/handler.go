package metrics

import (
	"fmt"
	"log"
	"math"
	"time"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
)

// PodMetric represents a single pod's metrics
type PodMetric struct {
	PodID       string   `json:"podId"`
	CpuUsage    float64  `json:"cpuUsage"`
	CpuLimit    *float64 `json:"cpuLimit,omitempty"`
	MemoryUsage float64  `json:"memoryUsage"`
	MemoryLimit *float64 `json:"memoryLimit,omitempty"`
}

// ServiceMetric represents a service's metrics
type ServiceMetric struct {
	ServiceID                   string      `json:"serviceId"`
	DeploymentID                *string     `json:"deploymentId,omitempty"`
	TotalCpuUsage               float64     `json:"totalCpuUsage"`
	AvgCpuUsage                 float64     `json:"avgCpuUsage"`
	TotalMemoryUsage            float64     `json:"totalMemoryUsage"`
	AvgMemoryUsage              float64     `json:"avgMemoryUsage"`
	CpuUtilizationPercentage    *float64    `json:"cpuUtilizationPercentage,omitempty"`
	MemoryUtilizationPercentage *float64    `json:"memoryUtilizationPercentage,omitempty"`
	Pods                        []PodMetric `json:"pods"`
}

// ServiceMetricsRequest represents the service metrics webhook request
type ServiceMetricsRequest struct {
	Metrics   []ServiceMetric `json:"metrics"`
	Timestamp string          `json:"timestamp,omitempty"`
}

// PVCMetric represents a single PVC's metrics
type PVCMetric struct {
	StorageUsage float64 `json:"storageUsage"` // in bytes
}

// StorageMetric represents storage metrics for a service
type StorageMetric struct {
	ServiceID string      `json:"serviceId"`
	PVCs      []PVCMetric `json:"pvcs"`
}

// StorageMetricsRequest represents the storage metrics webhook request
type StorageMetricsRequest struct {
	Metrics   []StorageMetric `json:"metrics"`
	Timestamp string          `json:"timestamp,omitempty"`
}

// POST /api/webhooks/service-metrics
func HandleServiceMetrics(c *fiber.Ctx) error {
	db := database.GetDatabase()

	var req ServiceMetricsRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if len(req.Metrics) == 0 {
		return response.BadRequest(c, "Invalid request: Missing or empty metrics array")
	}

	// Parse timestamp
	var timestamp time.Time
	if req.Timestamp != "" {
		var err error
		timestamp, err = time.Parse(time.RFC3339, req.Timestamp)
		if err != nil {
			timestamp = time.Now()
		}
	} else {
		timestamp = time.Now()
	}

	// Get all service IDs to validate they exist
	serviceIDs := make([]string, 0, len(req.Metrics))
	for _, m := range req.Metrics {
		if m.ServiceID != "" {
			serviceIDs = append(serviceIDs, m.ServiceID)
		}
	}

	if len(serviceIDs) == 0 {
		return response.Success(c, fiber.Map{
			"message": "No valid service IDs provided",
		})
	}

	// Fetch all services in one query
	var existingServices []models.Service
	db.Where("id IN ?", serviceIDs).Select("id").Find(&existingServices)

	// Create a set of existing service IDs
	validServiceIDs := make(map[string]bool)
	for _, s := range existingServices {
		validServiceIDs[s.ID] = true
	}

	// Process each service's metrics
	processedCount := 0
	totalPods := 0

	for _, m := range req.Metrics {
		if m.ServiceID == "" || !validServiceIDs[m.ServiceID] {
			continue
		}

		// Create service metrics record
		serviceMetrics := models.ServiceMetrics{
			ServiceID:                   m.ServiceID,
			DeploymentID:                m.DeploymentID,
			TotalCpuUsage:               m.TotalCpuUsage,
			AvgCpuUsage:                 m.AvgCpuUsage,
			TotalMemoryUsage:            m.TotalMemoryUsage,
			AvgMemoryUsage:              m.AvgMemoryUsage,
			CpuUtilizationPercentage:    m.CpuUtilizationPercentage,
			MemoryUtilizationPercentage: m.MemoryUtilizationPercentage,
			Timestamp:                   timestamp,
		}

		if err := db.Create(&serviceMetrics).Error; err != nil {
			log.Printf("Error creating service metrics for %s: %v", m.ServiceID, err)
			continue
		}

		// Create pod metrics
		if len(m.Pods) > 0 {
			podMetrics := make([]models.PodMetrics, 0, len(m.Pods))
			for _, pod := range m.Pods {
				podMetrics = append(podMetrics, models.PodMetrics{
					PodID:            pod.PodID,
					ServiceID:        m.ServiceID,
					ServiceMetricsID: serviceMetrics.ID,
					CpuUsage:         pod.CpuUsage,
					CpuLimit:         pod.CpuLimit,
					MemoryUsage:      pod.MemoryUsage,
					MemoryLimit:      pod.MemoryLimit,
					Timestamp:        timestamp,
				})
			}

			if err := db.CreateInBatches(podMetrics, 100).Error; err != nil {
				log.Printf("Error creating pod metrics for %s: %v", m.ServiceID, err)
			}

			totalPods += len(m.Pods)
		}

		processedCount++
	}

	return response.Success(c, fiber.Map{
		"message": fmt.Sprintf("Successfully processed metrics for %d services with %d pods", processedCount, totalPods),
	})
}

// POST /api/webhooks/storage-metrics
func HandleStorageMetrics(c *fiber.Ctx) error {
	db := database.GetDatabase()

	var req StorageMetricsRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if len(req.Metrics) == 0 {
		return response.BadRequest(c, "Invalid request: Missing or empty metrics array")
	}

	// Get all service IDs to validate they exist
	serviceIDs := make([]string, 0, len(req.Metrics))
	for _, m := range req.Metrics {
		if m.ServiceID != "" {
			serviceIDs = append(serviceIDs, m.ServiceID)
		}
	}

	if len(serviceIDs) == 0 {
		return response.Success(c, fiber.Map{
			"message": "No valid service IDs provided",
		})
	}

	// Fetch all services in one query
	var existingServices []models.Service
	db.Where("id IN ?", serviceIDs).Select("id").Find(&existingServices)

	// Create a set of existing service IDs
	validServiceIDs := make(map[string]bool)
	for _, s := range existingServices {
		validServiceIDs[s.ID] = true
	}

	// Process each service's storage metrics
	processedCount := 0

	for _, m := range req.Metrics {
		if m.ServiceID == "" || !validServiceIDs[m.ServiceID] || len(m.PVCs) == 0 {
			continue
		}

		// Convert bytes to GB and round to 2 decimal places
		storageUsageGB := math.Round((m.PVCs[0].StorageUsage/1024/1024/1024)*100) / 100

		// Update the service record
		if err := db.Model(&models.Service{}).
			Where("id = ?", m.ServiceID).
			Update("storageUsage", storageUsageGB).Error; err != nil {
			log.Printf("Error updating storage usage for %s: %v", m.ServiceID, err)
			continue
		}

		processedCount++
	}

	return response.Success(c, fiber.Map{
		"message": fmt.Sprintf("Successfully processed storage metrics for %d services", processedCount),
	})
}
