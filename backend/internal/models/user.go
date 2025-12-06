package models

import (
	"gorm.io/gorm"
	"time"
)

// User represents a user in the system
type User struct {
	ID        uint           `json:"id" gorm:"primaryKey"`
	Address   string         `json:"address" gorm:"uniqueIndex;not null;size:42"`
	Nonce     string         `json:"nonce" gorm:"size:64"`
	Roles     []string       `json:"roles" gorm:"type:text[]"`
	IsActive  bool           `json:"is_active" gorm:"default:true"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"deleted_at" gorm:"index"`

	// Relationships
	Transactions       []Transaction       `json:"transactions" gorm:"foreignKey:UserAddress;references:Address"`
	LiquidityPositions []LiquidityPosition `json:"liquidity_positions" gorm:"foreignKey:UserAddress;references:Address"`
}

// TableName returns the table name for User model
func (User) TableName() string {
	return "users"
}

// BeforeCreate hook to set default values
func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.Roles == nil {
		u.Roles = []string{"user"}
	}
	return nil
}
