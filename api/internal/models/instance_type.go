package models

import "time"

type InstanceTypeGroup struct {
	ID            string         `gorm:"primaryKey;size:191;column:id" json:"id"`
	Name          string         `gorm:"size:191;column:name" json:"name"`
	Description   *string        `gorm:"size:191;column:description" json:"description,omitempty"`
	ServiceTypeID string         `gorm:"index;size:191;column:serviceTypeId" json:"serviceTypeId"`
	Index         int            `gorm:"default:0;column:index" json:"index"`
	IsVisible     bool           `gorm:"default:true;column:isVisible" json:"isVisible"`
	CreatedAt     time.Time      `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt     time.Time      `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	InstanceTypes []InstanceType `gorm:"foreignKey:InstanceTypeGroupID" json:"instanceTypes,omitempty"`
	ServiceType   ServiceType    `gorm:"foreignKey:ServiceTypeID" json:"serviceType,omitempty"`
}

func (InstanceTypeGroup) TableName() string {
	return "InstanceTypeGroup"
}

type InstanceType struct {
	ID                  string                  `gorm:"primaryKey;size:191;column:id" json:"id"`
	Name                string                  `gorm:"size:191;column:name" json:"name"`
	Description         *string                 `gorm:"size:191;column:description" json:"description,omitempty"`
	InstanceTypeGroupID string                  `gorm:"index;size:191;column:instanceTypeGroupId" json:"instanceTypeGroupId"`
	CpuCount            float64                 `gorm:"column:cpuCount" json:"cpuCount"`
	MemoryMB            int                     `gorm:"column:memoryMB" json:"memoryMB"`
	Index               int                     `gorm:"default:0;column:index" json:"index"`
	IsVisible           bool                    `gorm:"default:true;column:isVisible" json:"isVisible"`
	CreatedAt           time.Time               `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt           time.Time               `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
	InstanceTypeGroup   InstanceTypeGroup       `gorm:"foreignKey:InstanceTypeGroupID" json:"instanceTypeGroup,omitempty"`
	Services            []Service               `gorm:"foreignKey:InstanceTypeID" json:"services,omitempty"`
	Pods                []PodTracking           `gorm:"foreignKey:InstanceTypeID" json:"pods,omitempty"`
	ScalingHistory      []ServiceScalingHistory `gorm:"foreignKey:InstanceTypeID" json:"scalingHistory,omitempty"`
}

func (InstanceType) TableName() string {
	return "InstanceType"
}
