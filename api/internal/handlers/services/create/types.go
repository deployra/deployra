package create

type EnvironmentVariable struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type PortSetting struct {
	ServicePort   int `json:"servicePort"`
	ContainerPort int `json:"containerPort"`
}

type CreateServiceRequest struct {
	Name                 string                `json:"name"`
	ServiceTypeID        string                `json:"serviceTypeId"`
	ProjectID            string                `json:"projectId"`
	GitProviderID        *string               `json:"gitProviderId,omitempty"`
	RepositoryName       *string               `json:"repositoryName,omitempty"`
	Branch               *string               `json:"branch,omitempty"`
	RuntimeFilePath      *string               `json:"runtimeFilePath,omitempty"`
	DockerImageUrl       *string               `json:"dockerImageUrl,omitempty"`
	DockerUsername       *string               `json:"dockerUsername,omitempty"`
	DockerPassword       *string               `json:"dockerPassword,omitempty"`
	EnvironmentVariables []EnvironmentVariable `json:"environmentVariables,omitempty"`
	PortSettings         []PortSetting         `json:"portSettings,omitempty"`
	HealthCheckPath      *string               `json:"healthCheckPath,omitempty"`
	AutoDeployEnabled    *bool                 `json:"autoDeployEnabled,omitempty"`
	InstanceTypeID       string                `json:"instanceTypeId"`
	StorageCapacity      *int                  `json:"storageCapacity,omitempty"`
}
