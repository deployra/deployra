package models

import "time"

type Project struct {
	ID             string       `gorm:"primaryKey;size:191;column:id" json:"id"`
	Name           string       `gorm:"size:191;column:name" json:"name"`
	Description    *string      `gorm:"size:191;column:description" json:"description,omitempty"`
	OrganizationID string       `gorm:"index;size:191;column:organizationId" json:"organizationId"`
	WebhookUrl     *string      `gorm:"size:191;column:webhookUrl" json:"webhookUrl,omitempty"`
	CreatedAt      time.Time    `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt      time.Time    `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	DeletedAt      *time.Time   `gorm:"index;column:deletedAt" json:"deletedAt,omitempty"`
	Organization   Organization `gorm:"foreignKey:OrganizationID" json:"organization,omitempty"`
	Services       []Service    `gorm:"foreignKey:ProjectID" json:"services,omitempty"`
}

func (Project) TableName() string {
	return "Project"
}
