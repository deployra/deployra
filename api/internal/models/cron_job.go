package models

import "time"

type CronJob struct {
	ID         string             `gorm:"primaryKey;size:191;column:id" json:"id"`
	Name       string             `gorm:"size:191;column:name" json:"name"`
	Schedule   string             `gorm:"size:191;column:schedule" json:"schedule"`
	Path       string             `gorm:"size:191;column:path" json:"path"`
	Headers    JSON               `gorm:"type:json;column:headers" json:"headers,omitempty"`
	Enabled    bool               `gorm:"default:true;column:enabled" json:"enabled"`
	ServiceID  string             `gorm:"index;size:191;column:serviceId" json:"serviceId"`
	CreatedAt  time.Time          `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt  time.Time          `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	LastRunAt  *time.Time         `gorm:"column:lastRunAt" json:"lastRunAt,omitempty"`
	NextRunAt  *time.Time         `gorm:"column:nextRunAt" json:"nextRunAt,omitempty"`
	Service    Service            `gorm:"foreignKey:ServiceID" json:"service,omitempty"`
	Executions []CronJobExecution `gorm:"foreignKey:CronJobID" json:"executions,omitempty"`
}

func (CronJob) TableName() string {
	return "CronJob"
}

type CronJobExecution struct {
	ID         string    `gorm:"primaryKey;size:191;column:id" json:"id"`
	CronJobID  string    `gorm:"index;size:191;column:cronJobId" json:"cronJobId"`
	Status     string    `gorm:"size:191;column:status" json:"status"`
	StatusCode *int      `gorm:"column:statusCode" json:"statusCode,omitempty"`
	Response   *string   `gorm:"size:191;column:response" json:"response,omitempty"`
	Error      *string   `gorm:"size:191;column:error" json:"error,omitempty"`
	ExecutedAt time.Time `gorm:"index;column:executedAt" json:"executedAt"`
	CreatedAt  time.Time `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	CronJob    CronJob   `gorm:"foreignKey:CronJobID" json:"cronJob,omitempty"`
}

func (CronJobExecution) TableName() string {
	return "CronJobExecution"
}
