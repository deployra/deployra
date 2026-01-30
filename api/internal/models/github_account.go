package models

import "time"

type GithubAccount struct {
	ID             string        `gorm:"primaryKey;size:191;column:id" json:"id"`
	Username       string        `gorm:"size:191;column:username" json:"username"`
	AccessToken    string        `gorm:"type:text;column:accessToken" json:"-"`
	RefreshToken   *string       `gorm:"type:text;column:refreshToken" json:"-"`
	ExpiresAt      *time.Time    `gorm:"column:expiresAt" json:"expiresAt,omitempty"`
	OrganizationID string        `gorm:"index;size:191;column:organizationId" json:"organizationId"`
	AvatarUrl      *string       `gorm:"size:191;column:avatarUrl" json:"avatarUrl,omitempty"`
	Email          *string       `gorm:"size:191;column:email" json:"email,omitempty"`
	Scope          *string       `gorm:"size:191;column:scope" json:"scope,omitempty"`
	TokenType      *string       `gorm:"size:191;column:tokenType" json:"tokenType,omitempty"`
	CreatedAt      time.Time     `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt      time.Time     `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	DeletedAt      *time.Time    `gorm:"index;column:deletedAt" json:"deletedAt,omitempty"`
	GitProviders   []GitProvider `gorm:"foreignKey:GithubAccountID" json:"gitProviders,omitempty"`
	Organization   Organization  `gorm:"foreignKey:OrganizationID" json:"organization,omitempty"`
}

func (GithubAccount) TableName() string {
	return "GithubAccount"
}
