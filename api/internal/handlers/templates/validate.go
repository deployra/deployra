package templates

import (
	"fmt"
	"strings"

	"github.com/deployra/deployra/api/internal/database"
	"github.com/deployra/deployra/api/internal/models"
	"github.com/deployra/deployra/api/pkg/response"
	"github.com/gofiber/fiber/v2"
	"gopkg.in/yaml.v3"
)

// ValidateRequest represents the validation request body
type ValidateRequest struct {
	YamlTemplate string `json:"yamlTemplate"`
}

// TemplateService represents a service in the template
type TemplateService struct {
	Name                           string           `yaml:"name"`
	Type                           string           `yaml:"type"`
	Plan                           string           `yaml:"plan"`
	Runtime                        string           `yaml:"runtime"`
	Image                          *TemplateImage   `yaml:"image,omitempty"`
	Git                            *TemplateGit     `yaml:"git,omitempty"`
	EnvVars                        []TemplateEnvVar `yaml:"envVars,omitempty"`
	HealthCheckPath                string           `yaml:"healthCheckPath,omitempty"`
	AutoScaling                    bool             `yaml:"autoScaling,omitempty"`
	AutoDeployment                 bool             `yaml:"autoDeployment,omitempty"`
	MaxReplicas                    int              `yaml:"maxReplicas,omitempty"`
	MinReplicas                    int              `yaml:"minReplicas,omitempty"`
	TargetCPUUtilizationPercentage int              `yaml:"targetCPUUtilizationPercentage,omitempty"`
	Ports                          []TemplatePort   `yaml:"ports"`
}

// TemplateImage represents an image configuration
type TemplateImage struct {
	URL string `yaml:"url"`
	Tag string `yaml:"tag,omitempty"`
}

// TemplateGit represents git configuration
type TemplateGit struct {
	ProviderID string `yaml:"providerId"`
	Repository string `yaml:"repository"`
	Branch     string `yaml:"branch"`
}

// TemplateEnvVar represents an environment variable
type TemplateEnvVar struct {
	Key          string                `yaml:"key"`
	Value        string                `yaml:"value,omitempty"`
	FromDatabase *TemplateFromDatabase `yaml:"fromDatabase,omitempty"`
}

// TemplateFromDatabase represents a database reference
type TemplateFromDatabase struct {
	Name string `yaml:"name"`
}

// TemplatePort represents a port configuration
type TemplatePort struct {
	ServicePort   int `yaml:"servicePort"`
	ContainerPort int `yaml:"containerPort"`
}

// TemplateDatabase represents a database in the template
type TemplateDatabase struct {
	Name            string `yaml:"name"`
	Type            string `yaml:"type"`
	Plan            string `yaml:"plan"`
	StorageCapacity int    `yaml:"storageCapacity"`
}

// TemplateMemory represents a memory service in the template
type TemplateMemory struct {
	Name string `yaml:"name"`
	Type string `yaml:"type"`
	Plan string `yaml:"plan"`
}

// Template represents the full template structure
type Template struct {
	Services  []TemplateService  `yaml:"services"`
	Databases []TemplateDatabase `yaml:"databases,omitempty"`
	Memory    []TemplateMemory   `yaml:"memory,omitempty"`
}

// ValidationError represents a validation error
type ValidationError struct {
	Path    []string `json:"path"`
	Message string   `json:"message"`
}

// Validate validates a YAML template
// POST /api/templates/validate
func Validate(c *fiber.Ctx) error {
	var req ValidateRequest
	if err := c.BodyParser(&req); err != nil {
		return response.BadRequest(c, "Invalid request body")
	}

	if req.YamlTemplate == "" {
		return response.BadRequest(c, "YAML template is required")
	}

	// Parse the YAML
	var template Template
	if err := yaml.Unmarshal([]byte(req.YamlTemplate), &template); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"status":  "error",
			"message": "Invalid YAML format",
			"data": []ValidationError{{
				Path:    []string{"yamlTemplate"},
				Message: err.Error(),
			}},
		})
	}

	// Validate the template
	if len(template.Services) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"status":  "error",
			"message": "Invalid template structure",
			"data": []ValidationError{{
				Path:    []string{"services"},
				Message: "At least one service must be defined",
			}},
		})
	}

	db := database.GetDatabase()

	// Load instance types with their pricing information
	var instanceTypes []models.InstanceType
	db.Preload("InstanceTypeGroup").Where("isVisible = ?", true).Find(&instanceTypes)

	// Perform validation
	var validationErrors []ValidationError
	names := make(map[string]bool)

	availableServiceTypes := []string{"web", "private"}
	availableDatabaseTypes := []string{"mysql", "postgresql"}
	availableMemoryTypes := []string{"memory"}

	// Validate services
	for _, service := range template.Services {
		// Check for duplicate names
		if names[service.Name] {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"services", "name"},
				Message: fmt.Sprintf("Duplicate service name: %s", service.Name),
			})
		}
		names[service.Name] = true

		// Validate name length
		if len(service.Name) < 3 {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"services", service.Name, "name"},
				Message: "Service name must be at least 3 characters",
			})
		}
		if len(service.Name) > 30 {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"services", service.Name, "name"},
				Message: "Service name must be less than 30 characters",
			})
		}

		// Validate service type
		if service.Type == "" {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"services", service.Name, "type"},
				Message: "Service type is required and must be one of: web, private",
			})
			continue
		}

		if !contains(availableServiceTypes, service.Type) {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"services", service.Name, "type"},
				Message: fmt.Sprintf("Unknown service type: %s. Must be one of: %s", service.Type, strings.Join(availableServiceTypes, ", ")),
			})
			continue
		}

		// Validate plan
		availablePlans := getAvailablePlans(instanceTypes, service.Type)
		planKey := strings.ToLower(strings.TrimSpace(service.Plan))
		if !contains(availablePlans, planKey) {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"services", service.Name, "plan"},
				Message: fmt.Sprintf("Unknown service plan: %s. Must be one of: %s", service.Plan, strings.Join(availablePlans, ", ")),
			})
		}

		// Validate ports
		if len(service.Ports) == 0 {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"services", service.Name, "ports"},
				Message: "At least one port is required",
			})
		}

		// Validate image if runtime is image
		runtime := service.Runtime
		if runtime == "" {
			runtime = "image"
		}
		if runtime == "image" && (service.Image == nil || service.Image.URL == "") {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"services", service.Name, "image"},
				Message: "Docker image URL is required when runtime is 'image'",
			})
		}

		// Check database references
		for _, envVar := range service.EnvVars {
			if envVar.FromDatabase != nil {
				dbName := envVar.FromDatabase.Name
				dbExists := false
				for _, db := range template.Databases {
					if db.Name == dbName {
						dbExists = true
						break
					}
				}
				if !dbExists {
					for _, mem := range template.Memory {
						if mem.Name == dbName {
							dbExists = true
							break
						}
					}
				}
				if !dbExists {
					validationErrors = append(validationErrors, ValidationError{
						Path:    []string{"services", service.Name, "envVars"},
						Message: fmt.Sprintf("Referenced database '%s' is not defined in the template", dbName),
					})
				}
			}
		}
	}

	// Validate databases
	for _, database := range template.Databases {
		// Check for duplicate names
		if names[database.Name] {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"databases", "name"},
				Message: fmt.Sprintf("Duplicate database name: %s", database.Name),
			})
		}
		names[database.Name] = true

		// Validate name length
		if len(database.Name) < 3 {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"databases", database.Name, "name"},
				Message: "Database name must be at least 3 characters",
			})
		}
		if len(database.Name) > 30 {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"databases", database.Name, "name"},
				Message: "Database name must be less than 30 characters",
			})
		}

		// Validate database type
		if database.Type == "" {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"databases", database.Name, "type"},
				Message: "Database type is required and must be one of: mysql, postgresql",
			})
			continue
		}

		if !contains(availableDatabaseTypes, database.Type) {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"databases", database.Name, "type"},
				Message: fmt.Sprintf("Unknown database type: %s. Must be one of: %s", database.Type, strings.Join(availableDatabaseTypes, ", ")),
			})
			continue
		}

		// Validate plan
		availablePlans := getAvailablePlans(instanceTypes, database.Type)
		planKey := strings.ToLower(strings.TrimSpace(database.Plan))
		if !contains(availablePlans, planKey) {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"databases", database.Name, "plan"},
				Message: fmt.Sprintf("Unknown database plan: %s. Must be one of: %s", database.Plan, strings.Join(availablePlans, ", ")),
			})
		}

		// Validate storage capacity
		if database.StorageCapacity < 10 {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"databases", database.Name, "storageCapacity"},
				Message: "Storage capacity must be at least 10 GB",
			})
		}
	}

	// Validate memory services
	for _, memory := range template.Memory {
		// Check for duplicate names
		if names[memory.Name] {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"memory", "name"},
				Message: fmt.Sprintf("Duplicate service name: %s", memory.Name),
			})
		}
		names[memory.Name] = true

		// Validate name length
		if len(memory.Name) < 3 {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"memory", memory.Name, "name"},
				Message: "Memory service name must be at least 3 characters",
			})
		}
		if len(memory.Name) > 30 {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"memory", memory.Name, "name"},
				Message: "Memory service name must be less than 30 characters",
			})
		}

		// Validate memory type
		if memory.Type == "" {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"memory", memory.Name, "type"},
				Message: "Memory service type is required and must be: memory",
			})
			continue
		}

		if !contains(availableMemoryTypes, memory.Type) {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"memory", memory.Name, "type"},
				Message: fmt.Sprintf("Unknown memory service type: %s. Must be: memory", memory.Type),
			})
			continue
		}

		// Validate plan
		availablePlans := getAvailablePlans(instanceTypes, memory.Type)
		planKey := strings.ToLower(strings.TrimSpace(memory.Plan))
		if !contains(availablePlans, planKey) {
			validationErrors = append(validationErrors, ValidationError{
				Path:    []string{"memory", memory.Name, "plan"},
				Message: fmt.Sprintf("Unknown memory service plan: %s. Must be one of: %s", memory.Plan, strings.Join(availablePlans, ", ")),
			})
		}
	}

	// Return validation errors if any
	if len(validationErrors) > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"status":  "error",
			"message": "Template validation failed",
			"data":    validationErrors,
		})
	}

	return response.Success(c, fiber.Map{
		"valid":         true,
		"serviceCount":  len(template.Services),
		"databaseCount": len(template.Databases),
		"memoryCount":   len(template.Memory),
	})
}

// Helper functions
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func getAvailablePlans(instanceTypes []models.InstanceType, serviceType string) []string {
	var plans []string
	for _, it := range instanceTypes {
		if it.InstanceTypeGroup.ID != "" && it.InstanceTypeGroup.ServiceTypeID == serviceType {
			plans = append(plans, it.ID)
		}
	}
	return plans
}

