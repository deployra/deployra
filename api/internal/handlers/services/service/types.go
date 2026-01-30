package service

// UpdateServiceRequest represents the request body for updating a service
type UpdateServiceRequest struct {
	Name                         *string              `json:"name"`
	EnvironmentVariables         []EnvironmentVar     `json:"environmentVariables"`
	Replicas                     *int                 `json:"replicas"`
	TargetCPUUtilizationPercentage *int               `json:"targetCPUUtilizationPercentage"`
	MinReplicas                  *int                 `json:"minReplicas"`
	MaxReplicas                  *int                 `json:"maxReplicas"`
	AutoScalingEnabled           *bool                `json:"autoScalingEnabled"`
	AutoDeployEnabled            *bool                `json:"autoDeployEnabled"`
	CustomDomain                 *string              `json:"customDomain"`
	HealthCheckPath              *string              `json:"healthCheckPath"`
	InstanceTypeID               *string              `json:"instanceTypeId"`
	StorageCapacity              *int                 `json:"storageCapacity"`
	PortSettings                 []PortSetting        `json:"portSettings"`
}

// EnvironmentVar represents an environment variable
type EnvironmentVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// PortSetting represents a port configuration
type PortSetting struct {
	ServicePort   int `json:"servicePort"`
	ContainerPort int `json:"containerPort"`
}

// DeployRequest represents the request body for deploying a service
type DeployRequest struct {
	CommitSha *string `json:"commitSha"`
}
