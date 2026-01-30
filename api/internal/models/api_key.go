package models

import "time"

type ApiKey struct {
	ID         string     `gorm:"primaryKey;size:191;column:id" json:"id"`
	Name       string     `gorm:"size:191;column:name" json:"name"`
	Key        string     `gorm:"uniqueIndex;size:191;column:key" json:"-"`
	UserID     string     `gorm:"index;size:191;column:userId" json:"userId"`
	CreatedAt  time.Time  `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt  time.Time  `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	ExpiresAt  *time.Time `gorm:"column:expiresAt" json:"expiresAt,omitempty"`
	LastUsedAt *time.Time `gorm:"column:lastUsedAt" json:"lastUsedAt,omitempty"`
	Revoked    bool       `gorm:"default:false;column:revoked" json:"revoked"`
	User       User       `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (ApiKey) TableName() string {
	return "ApiKey"
}
