package models

import "time"

type Deployment struct {
	ID               string                  `gorm:"primaryKey;size:191;column:id" json:"id"`
	ServiceID        string                  `gorm:"index;size:191;column:serviceId" json:"serviceId"`
	DeploymentNumber int                     `gorm:"default:1;column:deploymentNumber" json:"deploymentNumber"`
	Status           DeploymentStatus        `gorm:"size:191;default:PENDING;column:status" json:"status"`
	CommitSha        *string                 `gorm:"size:191;column:commitSha" json:"commitSha,omitempty"`
	Branch           *string                 `gorm:"size:191;column:branch" json:"branch,omitempty"`
	TriggeredBy      *string                 `gorm:"size:191;column:triggeredBy" json:"triggeredBy,omitempty"`
	TriggerType      string                  `gorm:"size:191;column:triggerType" json:"triggerType"`
	StartedAt        time.Time               `gorm:"autoCreateTime;column:startedAt" json:"startedAt"`
	CompletedAt      *time.Time              `gorm:"column:completedAt" json:"completedAt,omitempty"`
	CreatedAt        time.Time               `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt        time.Time               `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	Service          Service                 `gorm:"foreignKey:ServiceID" json:"service,omitempty"`
	Logs             []DeploymentLog         `gorm:"foreignKey:DeploymentID" json:"logs,omitempty"`
	Events           []ServiceEvent          `gorm:"foreignKey:DeploymentID" json:"events,omitempty"`
	ScalingHistory   []ServiceScalingHistory `gorm:"foreignKey:DeploymentID" json:"scalingHistory,omitempty"`
}

func (Deployment) TableName() string {
	return "Deployment"
}

type DeploymentLog struct {
	ID           int        `gorm:"primaryKey;autoIncrement;column:id" json:"id"`
	DeploymentID string     `gorm:"index;size:191;column:deploymentId" json:"deploymentId"`
	Type         LogType    `gorm:"size:191;default:STDOUT;column:type" json:"type"`
	Text         string     `gorm:"type:text;column:text" json:"text"`
	CreatedAt    time.Time  `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	Deployment   Deployment `gorm:"foreignKey:DeploymentID;references:ID" json:"deployment,omitempty"`
}

func (DeploymentLog) TableName() string {
	return "DeploymentLog"
}
