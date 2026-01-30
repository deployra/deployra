package models

import "time"

type ServiceMetrics struct {
	ID                          int          `gorm:"primaryKey;autoIncrement;column:id" json:"id"`
	ServiceID                   string       `gorm:"index;size:191;column:serviceId" json:"serviceId"`
	DeploymentID                *string      `gorm:"index;size:191;column:deploymentId" json:"deploymentId,omitempty"`
	TotalCpuUsage               float64      `gorm:"column:totalCpuUsage" json:"totalCpuUsage"`
	AvgCpuUsage                 float64      `gorm:"column:avgCpuUsage" json:"avgCpuUsage"`
	TotalMemoryUsage            float64      `gorm:"column:totalMemoryUsage" json:"totalMemoryUsage"`
	AvgMemoryUsage              float64      `gorm:"column:avgMemoryUsage" json:"avgMemoryUsage"`
	CpuUtilizationPercentage    *float64     `gorm:"column:cpuUtilizationPercentage" json:"cpuUtilizationPercentage,omitempty"`
	MemoryUtilizationPercentage *float64     `gorm:"column:memoryUtilizationPercentage" json:"memoryUtilizationPercentage,omitempty"`
	Timestamp                   time.Time    `gorm:"index;column:timestamp" json:"timestamp"`
	CreatedAt                   time.Time    `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	Service                     Service      `gorm:"foreignKey:ServiceID" json:"service,omitempty"`
	PodMetrics                  []PodMetrics `gorm:"foreignKey:ServiceMetricsID" json:"podMetrics,omitempty"`
}

func (ServiceMetrics) TableName() string {
	return "ServiceMetrics"
}

type PodMetrics struct {
	ID               int            `gorm:"primaryKey;autoIncrement;column:id" json:"id"`
	PodID            string         `gorm:"index;size:191;column:podId" json:"podId"`
	ServiceID        string         `gorm:"index;size:191;column:serviceId" json:"serviceId"`
	ServiceMetricsID int            `gorm:"index;column:serviceMetricsId" json:"serviceMetricsId"`
	CpuUsage         float64        `gorm:"column:cpuUsage" json:"cpuUsage"`
	CpuLimit         *float64       `gorm:"column:cpuLimit" json:"cpuLimit,omitempty"`
	MemoryUsage      float64        `gorm:"column:memoryUsage" json:"memoryUsage"`
	MemoryLimit      *float64       `gorm:"column:memoryLimit" json:"memoryLimit,omitempty"`
	Timestamp        time.Time      `gorm:"index;column:timestamp" json:"timestamp"`
	CreatedAt        time.Time      `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	Service          Service        `gorm:"foreignKey:ServiceID" json:"service,omitempty"`
	ServiceMetrics   ServiceMetrics `gorm:"foreignKey:ServiceMetricsID" json:"serviceMetrics,omitempty"`
}

func (PodMetrics) TableName() string {
	return "PodMetrics"
}

type PodTracking struct {
	ID                   int                   `gorm:"primaryKey;autoIncrement;column:id" json:"id"`
	PodID                string                `gorm:"size:191;column:podId" json:"podId"`
	ServiceID            string                `gorm:"index;size:191;column:serviceId" json:"serviceId"`
	DeploymentID         *string               `gorm:"index;size:191;column:deploymentId" json:"deploymentId,omitempty"`
	InstanceTypeID       string                `gorm:"index;size:191;column:instanceTypeId" json:"instanceTypeId"`
	Phase                PodPhase              `gorm:"size:191;default:UNKNOWN;column:phase" json:"phase"`
	ContainerState       *ContainerState       `gorm:"size:191;column:containerState" json:"containerState,omitempty"`
	ContainerStateReason *ContainerStateReason `gorm:"size:191;column:containerStateReason" json:"containerStateReason,omitempty"`
	StartTime            time.Time             `gorm:"column:startTime" json:"startTime"`
	EndTime              *time.Time            `gorm:"column:endTime" json:"endTime,omitempty"`
	CreatedAt            time.Time             `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt            time.Time             `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	InstanceType         InstanceType          `gorm:"foreignKey:InstanceTypeID" json:"instanceType,omitempty"`
}

func (PodTracking) TableName() string {
	return "PodTracking"
}
