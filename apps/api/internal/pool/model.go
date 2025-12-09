package pool

import (
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"time"
)

// Pool represents a liquidity pool
type Pool struct {
	ID        uint            `json:"id" gorm:"primaryKey"`
	PoolID    string          `json:"pool_id" gorm:"uniqueIndex;not null;size:66"` // Unique pool identifier
	Token0    string          `json:"token0" gorm:"not null;size:42"`              // First token address
	Token1    string          `json:"token1" gorm:"not null;size:42"`              // Second token address
	FeeRate   decimal.Decimal `json:"fee_rate" gorm:"type:decimal(10,6);not null"` // Fee rate (e.g., 0.003)
	Liquidity decimal.Decimal `json:"liquidity" gorm:"type:decimal(36,18)"`        // Total liquidity
	Reserve0  decimal.Decimal `json:"reserve0" gorm:"type:decimal(36,18)"`         // Reserve of token0
	Reserve1  decimal.Decimal `json:"reserve1" gorm:"type:decimal(36,18)"`         // Reserve of token1
	Volume24h decimal.Decimal `json:"volume_24h" gorm:"type:decimal(36,18)"`       // 24h trading volume
	TVL       decimal.Decimal `json:"tvl" gorm:"type:decimal(36,18)"`              // Total Value Locked
	IsActive  bool            `json:"is_active" gorm:"default:true"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
	DeletedAt gorm.DeletedAt  `json:"deleted_at" gorm:"index"`

	// Relationships
	// Transactions       []Transaction       `json:"transactions" gorm:"foreignKey:PoolID;references:PoolID"`
	// LiquidityPositions []LiquidityPosition `json:"liquidity_positions" gorm:"foreignKey:PoolID;references:PoolID"`
}

// TableName returns the table name for Pool model
func (Pool) TableName() string {
	return "pools"
}

// BeforeCreate hook to validate pool data
func (p *Pool) BeforeCreate(tx *gorm.DB) error {
	if p.Token0 == p.Token1 {
		return gorm.ErrInvalidData
	}
	return nil
}
