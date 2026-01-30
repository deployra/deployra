package models

import "time"

type User struct {
	ID            string     `gorm:"primaryKey;size:191;column:id" json:"id"`
	Email         string     `gorm:"uniqueIndex;size:191;column:email" json:"email"`
	Password      string     `gorm:"size:191;column:password" json:"-"`
	EmailVerified *time.Time `gorm:"column:emailVerified" json:"emailVerified,omitempty"`
	FirstName     *string    `gorm:"size:191;column:firstName" json:"firstName,omitempty"`
	LastName      *string    `gorm:"size:191;column:lastName" json:"lastName,omitempty"`
	CreatedAt     time.Time  `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt     time.Time  `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	DeletedAt     *time.Time `gorm:"index;column:deletedAt" json:"deletedAt,omitempty"`
	ApiKeys       []ApiKey   `gorm:"foreignKey:UserID" json:"apiKeys,omitempty"`
}

func (User) TableName() string {
	return "User"
}
