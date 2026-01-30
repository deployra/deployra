package models

import "time"

type ServiceTypeTag struct {
	ID           string        `gorm:"primaryKey;size:191;column:id" json:"id"`
	Label        string        `gorm:"size:191;column:label" json:"label"`
	Index        int           `gorm:"column:index" json:"index"`
	CreatedAt    time.Time     `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt    time.Time     `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	ServiceTypes []ServiceType `gorm:"foreignKey:TagID" json:"serviceTypes,omitempty"`
}

func (ServiceTypeTag) TableName() string {
	return "ServiceTypeTag"
}

type ServiceType struct {
	ID                 string              `gorm:"primaryKey;size:191;column:id" json:"id"`
	Title              string              `gorm:"size:191;column:title" json:"title"`
	Description        string              `gorm:"size:191;column:description" json:"description"`
	TagID              string              `gorm:"index;size:191;column:tagId" json:"tagId"`
	Index              int                 `gorm:"column:index" json:"index"`
	IsVisible          bool                `gorm:"default:true;column:isVisible" json:"isVisible"`
	CreatedAt          time.Time           `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt          time.Time           `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	Services           []Service           `gorm:"foreignKey:ServiceTypeID" json:"services,omitempty"`
	InstanceTypeGroups []InstanceTypeGroup `gorm:"foreignKey:ServiceTypeID" json:"instanceTypeGroups,omitempty"`
	Tag                ServiceTypeTag      `gorm:"foreignKey:TagID" json:"tag,omitempty"`
}

func (ServiceType) TableName() string {
	return "ServiceType"
}
