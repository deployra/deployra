package template

import "github.com/deployra/deployra/api/internal/models"

// Request types
type CreateFromTemplateRequest struct {
	ProjectID    string `json:"projectId"`
	YamlTemplate string `json:"yamlTemplate"`
}

// Parsed template types
type ParsedTemplate struct {
	Services  []ServiceTemplate  `yaml:"services"`
	Databases []DatabaseTemplate `yaml:"databases"`
	Memory    []MemoryTemplate   `yaml:"memory"`
}

type ServiceTemplate struct {
	Name            string           `yaml:"name"`
	Type            string           `yaml:"type"`
	Plan            string           `yaml:"plan"`
	Runtime         string           `yaml:"runtime"`
	Image           *ImageConfig     `yaml:"image"`
	EnvVars         []EnvVarTemplate `yaml:"envVars"`
	HealthCheckPath *string          `yaml:"healthCheckPath"`
	Ports           []PortConfig     `yaml:"ports"`
	StorageCapacity *int             `yaml:"storageCapacity"`
}

type DatabaseTemplate struct {
	Name            string `yaml:"name"`
	Type            string `yaml:"type"`
	Plan            string `yaml:"plan"`
	StorageCapacity int    `yaml:"storageCapacity"`
}

type MemoryTemplate struct {
	Name string `yaml:"name"`
	Type string `yaml:"type"`
	Plan string `yaml:"plan"`
}

type ImageConfig struct {
	URL string `yaml:"url"`
	Tag string `yaml:"tag"`
}

type EnvVarTemplate struct {
	Key           string              `yaml:"key"`
	Value         string              `yaml:"value"`
	GenerateValue bool                `yaml:"generateValue"`
	FromDatabase  *FromDatabaseConfig `yaml:"fromDatabase"`
}

type FromDatabaseConfig struct {
	Name     string `yaml:"name"`
	Property string `yaml:"property"`
}

type PortConfig struct {
	ServicePort   int `yaml:"servicePort"`
	ContainerPort int `yaml:"containerPort"`
}

// EnvironmentVariable represents an environment variable
type EnvironmentVariable struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// CreatedServiceInfo holds created service info with credentials for env var resolution
type CreatedServiceInfo struct {
	ID          string
	Name        string
	Credentials *models.ServiceCredential
}
