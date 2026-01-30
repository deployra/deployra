package models

import "time"

type GitProvider struct {
	ID                  string          `gorm:"primaryKey;size:191;column:id" json:"id"`
	OrganizationID      string          `gorm:"index;size:191;column:organizationId" json:"organizationId"`
	Type                GitProviderType `gorm:"size:191;column:type" json:"type"`
	GithubAccountID     *string         `gorm:"index;size:191;column:githubAccountId" json:"githubAccountId,omitempty"`
	InstallationID      *string         `gorm:"size:191;column:installationId" json:"installationId,omitempty"`
	RepositorySelection *string         `gorm:"size:191;column:repositorySelection" json:"repositorySelection,omitempty"`
	Permissions         JSON            `gorm:"type:json;column:permissions" json:"permissions,omitempty"`
	URL                 *string         `gorm:"size:191;column:url" json:"url,omitempty"`
	Username            *string         `gorm:"size:191;column:username" json:"username,omitempty"`
	Password            *string         `gorm:"size:191;column:password" json:"-"`
	CreatedAt           time.Time       `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt           time.Time       `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	DeletedAt           *time.Time      `gorm:"index;column:deletedAt" json:"deletedAt,omitempty"`
	GithubAccount       *GithubAccount  `gorm:"foreignKey:GithubAccountID" json:"githubAccount,omitempty"`
	Organization        Organization    `gorm:"foreignKey:OrganizationID" json:"organization,omitempty"`
	Services            []Service       `gorm:"foreignKey:GitProviderID" json:"services,omitempty"`
}

func (GitProvider) TableName() string {
	return "GitProvider"
}
