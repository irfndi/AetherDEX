package liquidity

import (
	"github.com/irfndi/AetherDEX/apps/api/internal/pool"
	"github.com/irfndi/AetherDEX/apps/api/internal/user"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"time"
)

// LiquidityPosition represents a user's liquidity position in a pool
type LiquidityPosition struct {
	ID           uint            `json:"id" gorm:"primaryKey"`
	UserAddress  string          `json:"user_address" gorm:"not null;size:42;index"`
	PoolID       string          `json:"pool_id" gorm:"not null;size:66;index"`
	Liquidity    decimal.Decimal `json:"liquidity" gorm:"type:decimal(36,18);not null"`
	Token0Amount decimal.Decimal `json:"token0_amount" gorm:"type:decimal(36,18)"`
	Token1Amount decimal.Decimal `json:"token1_amount" gorm:"type:decimal(36,18)"`
	Shares       decimal.Decimal `json:"shares" gorm:"type:decimal(36,18)"`
	IsActive     bool            `json:"is_active" gorm:"default:true"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
	DeletedAt    gorm.DeletedAt  `json:"deleted_at" gorm:"index"`

	// Relationships
	User *user.User `json:"user,omitempty" gorm:"foreignKey:UserAddress;references:Address"`
	Pool *pool.Pool `json:"pool,omitempty" gorm:"foreignKey:PoolID;references:PoolID"`
}

// TableName returns the table name for LiquidityPosition model
func (LiquidityPosition) TableName() string {
	return "liquidity_positions"
}

// BeforeCreate hook to validate liquidity position data
func (lp *LiquidityPosition) BeforeCreate(tx *gorm.DB) error {
	if lp.Liquidity.IsZero() {
		return gorm.ErrInvalidData
	}
	return nil
}
