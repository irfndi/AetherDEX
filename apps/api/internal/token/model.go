package models

import (
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"time"
)

// Token represents an ERC-20 token
type Token struct {
	ID          uint            `json:"id" gorm:"primaryKey"`
	Address     string          `json:"address" gorm:"uniqueIndex;not null;size:42"`
	Symbol      string          `json:"symbol" gorm:"not null;size:20;index"`
	Name        string          `json:"name" gorm:"not null;size:100"`
	Decimals    uint8           `json:"decimals" gorm:"not null"`
	TotalSupply decimal.Decimal `json:"total_supply" gorm:"type:decimal(36,18)"`
	Price       decimal.Decimal `json:"price" gorm:"type:decimal(36,18)"`
	MarketCap   decimal.Decimal `json:"market_cap" gorm:"type:decimal(36,18)"`
	Volume24h   decimal.Decimal `json:"volume_24h" gorm:"type:decimal(36,18)"`
	IsVerified  bool            `json:"is_verified" gorm:"default:false"`
	IsActive    bool            `json:"is_active" gorm:"default:true"`
	LogoURL     string          `json:"logo_url" gorm:"size:255"`
	WebsiteURL  string          `json:"website_url" gorm:"size:255"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
	DeletedAt   gorm.DeletedAt  `json:"deleted_at" gorm:"index"`
}

// TableName returns the table name for Token model
func (Token) TableName() string {
	return "tokens"
}

// BeforeCreate hook to validate token data
func (t *Token) BeforeCreate(tx *gorm.DB) error {
	if len(t.Address) != 42 {
		return gorm.ErrInvalidData
	}
	if t.Symbol == "" || t.Name == "" {
		return gorm.ErrInvalidData
	}
	return nil
}
