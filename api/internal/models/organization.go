package models

import "time"

type Organization struct {
	ID             string          `gorm:"primaryKey;size:191;column:id" json:"id"`
	Name           string          `gorm:"size:191;column:name" json:"name"`
	Description    *string         `gorm:"size:191;column:description" json:"description,omitempty"`
	CreatedAt      time.Time       `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt      time.Time       `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	DeletedAt      *time.Time      `gorm:"index;column:deletedAt" json:"deletedAt,omitempty"`
	UserID         string          `gorm:"index;size:191;column:userId" json:"userId"`
	GitProviders   []GitProvider   `gorm:"foreignKey:OrganizationID" json:"gitProviders,omitempty"`
	GithubAccounts []GithubAccount `gorm:"foreignKey:OrganizationID" json:"githubAccounts,omitempty"`
	Projects       []Project       `gorm:"foreignKey:OrganizationID" json:"projects,omitempty"`
}

func (Organization) TableName() string {
	return "Organization"
}
