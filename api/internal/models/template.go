package models

import "time"

type Template struct {
	ID           string    `gorm:"primaryKey;size:191;column:id" json:"id"`
	Slug         string    `gorm:"uniqueIndex;size:191;column:slug" json:"slug"`
	Title        string    `gorm:"size:191;column:title" json:"title"`
	Description  string    `gorm:"type:text;column:description" json:"description"`
	Content      *string   `gorm:"type:longtext;column:content" json:"content,omitempty"`
	Category     string    `gorm:"index;size:191;column:category" json:"category"`
	Tags         *string   `gorm:"size:191;column:tags" json:"tags,omitempty"`
	YamlTemplate string    `gorm:"type:longtext;column:yamlTemplate" json:"yamlTemplate"`
	Author       string    `gorm:"size:191;column:author" json:"author"`
	Featured     bool      `gorm:"index;default:false;column:featured" json:"featured"`
	Published    bool      `gorm:"index;default:false;column:published" json:"published"`
	UsageCount   int       `gorm:"default:0;column:usageCount" json:"usageCount"`
	CreatedAt    time.Time `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
}

func (Template) TableName() string {
	return "Template"
}

type BlogPost struct {
	ID        string    `gorm:"primaryKey;size:191;column:id" json:"id"`
	Slug      string    `gorm:"uniqueIndex;size:191;column:slug" json:"slug"`
	Title     string    `gorm:"size:191;column:title" json:"title"`
	Excerpt   string    `gorm:"type:text;column:excerpt" json:"excerpt"`
	Content   string    `gorm:"type:longtext;column:content" json:"content"`
	Author    string    `gorm:"size:191;column:author" json:"author"`
	Category  string    `gorm:"index;size:191;column:category" json:"category"`
	ReadTime  string    `gorm:"size:191;column:readTime" json:"readTime"`
	Date      time.Time `gorm:"autoCreateTime;column:date" json:"date"`
	Published bool      `gorm:"index;default:false;column:published" json:"published"`
	CreatedAt time.Time `gorm:"autoCreateTime;column:createdAt" json:"createdAt"`
	UpdatedAt time.Time `gorm:"autoUpdateTime;column:updatedAt" json:"updatedAt"`
}

func (BlogPost) TableName() string {
	return "BlogPost"
}
