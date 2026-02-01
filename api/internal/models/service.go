package models

import "time"

type Service struct {
	ID                             string                  `gorm:"primaryKey;size:191;column:id" json:"id"`
	Name                           string                  `gorm:"size:191;column:name" json:"name"`
	ServiceTypeID                  string                  `gorm:"index;size:191;column:serviceTypeId" json:"serviceTypeId"`
	ProjectID                      string                  `gorm:"index;size:191;column:projectId" json:"projectId"`
	GitProviderID                  *string                 `gorm:"index;size:191;column:gitProviderId" json:"gitProviderId,omitempty"`
	RepositoryName                 *string                 `gorm:"size:191;column:repositoryName" json:"repositoryName,omitempty"`
	Branch                         *string                 `gorm:"size:191;column:branch" json:"branch,omitempty"`
	RuntimeFilePath                *string                 `gorm:"size:191;column:runtimeFilePath" json:"runtimeFilePath,omitempty"`
	Runtime                        Runtime                 `gorm:"size:191;default:IMAGE;column:runtime" json:"runtime"`
	EnvironmentVariables           JSON                    `gorm:"type:json;column:environmentVariables" json:"environmentVariables,omitempty"`
	CreatedAt                      time.Time               `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt                      time.Time               `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	Status                         ServiceStatus           `gorm:"size:191;default:PENDING;column:status" json:"status"`
	DeployedAt                     *time.Time              `gorm:"column:deployedAt" json:"deployedAt,omitempty"`
	Subdomain                      *string                 `gorm:"uniqueIndex;size:191;column:subdomain" json:"subdomain,omitempty"`
	CustomDomain                   *string                 `gorm:"size:191;column:customDomain" json:"customDomain,omitempty"`
	HealthCheckPath                *string                 `gorm:"size:191;column:healthCheckPath" json:"healthCheckPath,omitempty"`
	AutoScalingEnabled             bool                    `gorm:"default:false;column:autoScalingEnabled" json:"autoScalingEnabled"`
	AutoDeployEnabled              bool                    `gorm:"default:true;column:autoDeployEnabled" json:"autoDeployEnabled"`
	MaxReplicas                    int                     `gorm:"default:1;column:maxReplicas" json:"maxReplicas"`
	MinReplicas                    int                     `gorm:"default:1;column:minReplicas" json:"minReplicas"`
	Replicas                       int                     `gorm:"default:1;column:replicas" json:"replicas"`
	TargetCPUUtilizationPercentage *int                    `gorm:"column:targetCPUUtilizationPercentage" json:"targetCPUUtilizationPercentage,omitempty"`
	ContainerRegistryType          *string                 `gorm:"size:191;column:containerRegistryType" json:"containerRegistryType,omitempty"`
	ContainerRegistryImageUri      *string                 `gorm:"type:text;column:containerRegistryImageUri" json:"containerRegistryImageUri,omitempty"`
	ContainerRegistryUsername      *string                 `gorm:"size:191;column:containerRegistryUsername" json:"containerRegistryUsername,omitempty"`
	ContainerRegistryPassword      *string                 `gorm:"type:text;column:containerRegistryPassword" json:"-"`
	InstanceTypeID                 string                  `gorm:"index;size:191;column:instanceTypeId" json:"instanceTypeId"`
	InstanceTypeChangedAt          *time.Time              `gorm:"column:instanceTypeChangedAt" json:"instanceTypeChangedAt,omitempty"`
	DeletedAt                      *time.Time              `gorm:"index;column:deletedAt" json:"deletedAt,omitempty"`
	CurrentReplicas                int                     `gorm:"default:1;column:currentReplicas" json:"currentReplicas"`
	TargetReplicas                 int                     `gorm:"default:1;column:targetReplicas" json:"targetReplicas"`
	StorageCapacity                *int                    `gorm:"column:storageCapacity" json:"storageCapacity,omitempty"`
	StorageCapacityChangedAt       *time.Time              `gorm:"column:storageCapacityChangedAt" json:"storageCapacityChangedAt,omitempty"`
	StorageClass                   *string                 `gorm:"size:191;column:storageClass" json:"storageClass,omitempty"`
	StorageUsage                   *float64                `gorm:"column:storageUsage" json:"storageUsage,omitempty"`
	ContainerCommand               *string                 `gorm:"type:text;column:containerCommand" json:"containerCommand,omitempty"`
	ScalingStatus                  ServiceScalingStatus    `gorm:"size:191;default:IDLE;column:scalingStatus" json:"scalingStatus"`
	Deployments                    []Deployment            `gorm:"foreignKey:ServiceID" json:"deployments,omitempty"`
	Ports                          []ServicePort           `gorm:"foreignKey:ServiceID" json:"ports,omitempty"`
	GitProvider                    *GitProvider            `gorm:"foreignKey:GitProviderID" json:"gitProvider,omitempty"`
	Project                        Project                 `gorm:"foreignKey:ProjectID" json:"project,omitempty"`
	Events                         []ServiceEvent          `gorm:"foreignKey:ServiceID" json:"events,omitempty"`
	ServiceType                    ServiceType             `gorm:"foreignKey:ServiceTypeID" json:"serviceType,omitempty"`
	InstanceType                   InstanceType            `gorm:"foreignKey:InstanceTypeID" json:"instanceType,omitempty"`
	Credentials                    *ServiceCredential      `gorm:"foreignKey:ServiceID" json:"credentials,omitempty"`
	ScalingHistory                 []ServiceScalingHistory `gorm:"foreignKey:ServiceID" json:"scalingHistory,omitempty"`
	Metrics                        []ServiceMetrics        `gorm:"foreignKey:ServiceID" json:"metrics,omitempty"`
	PodMetrics                     []PodMetrics            `gorm:"foreignKey:ServiceID" json:"podMetrics,omitempty"`
	CronJobs                       []CronJob               `gorm:"foreignKey:ServiceID" json:"cronJobs,omitempty"`
}

func (Service) TableName() string {
	return "Service"
}

type ServiceCredential struct {
	ID        string    `gorm:"primaryKey;size:191;column:id" json:"id"`
	ServiceID string    `gorm:"uniqueIndex;size:191;column:serviceId" json:"serviceId"`
	Host      string    `gorm:"size:191;column:host" json:"host"`
	Port      int       `gorm:"default:3306;column:port" json:"port"`
	Username  string    `gorm:"size:191;column:username" json:"username"`
	Password  string    `gorm:"size:191;column:password" json:"password"`
	Database  string    `gorm:"size:191;column:database" json:"database"`
	CreatedAt time.Time `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	Service   Service   `gorm:"foreignKey:ServiceID" json:"service,omitempty"`
}

func (ServiceCredential) TableName() string {
	return "ServiceCredential"
}

type ServiceEvent struct {
	ID           int         `gorm:"primaryKey;autoIncrement;column:id" json:"id"`
	ServiceID    string      `gorm:"index;size:191;column:serviceId" json:"serviceId"`
	Type         EventType   `gorm:"size:191;column:type" json:"type"`
	Message      *string     `gorm:"size:191;column:message" json:"message,omitempty"`
	CreatedAt    time.Time   `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	DeploymentID *string     `gorm:"column:deployment_id;index;size:191" json:"deploymentId,omitempty"`
	Payload      JSON        `gorm:"type:json;column:payload" json:"payload,omitempty"`
	Deployment   *Deployment `gorm:"foreignKey:DeploymentID;references:ID" json:"deployment,omitempty"`
	Service      Service     `gorm:"foreignKey:ServiceID;references:ID" json:"service,omitempty"`
}

func (ServiceEvent) TableName() string {
	return "ServiceEvent"
}

type ServicePort struct {
	ID            int       `gorm:"primaryKey;autoIncrement;column:id" json:"id"`
	ServiceID     string    `gorm:"index;size:191;column:serviceId" json:"serviceId"`
	ServicePort   int       `gorm:"default:80;column:servicePort" json:"servicePort"`
	ContainerPort int       `gorm:"default:3000;column:containerPort" json:"containerPort"`
	CreatedAt     time.Time `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt     time.Time `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	Service       Service   `gorm:"foreignKey:ServiceID" json:"service,omitempty"`
}

func (ServicePort) TableName() string {
	return "ServicePort"
}

type ServiceScalingHistory struct {
	ID             int          `gorm:"primaryKey;autoIncrement;column:id" json:"id"`
	ServiceID      string       `gorm:"index;size:191;column:serviceId" json:"serviceId"`
	DeploymentID   *string      `gorm:"index;size:191;column:deploymentId" json:"deploymentId,omitempty"`
	InstanceTypeID string       `gorm:"index;size:191;column:instanceTypeId" json:"instanceTypeId"`
	ReplicaCount   int          `gorm:"column:replicaCount" json:"replicaCount"`
	CreatedAt      time.Time    `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	Service        Service      `gorm:"foreignKey:ServiceID;references:ID" json:"service,omitempty"`
	Deployment     *Deployment  `gorm:"foreignKey:DeploymentID;references:ID" json:"deployment,omitempty"`
	InstanceType   InstanceType `gorm:"foreignKey:InstanceTypeID;references:ID" json:"instanceType,omitempty"`
}

func (ServiceScalingHistory) TableName() string {
	return "ServiceScalingHistory"
}
