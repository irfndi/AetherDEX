package models

import (
	"time"

	"github.com/lib/pq"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// User represents a user in the system
type User struct {
	ID        uint           `json:"id" gorm:"primaryKey"`
	Address   string         `json:"address" gorm:"uniqueIndex;not null;size:42"`
	Nonce     string         `json:"nonce" gorm:"size:64"`
	Roles     pq.StringArray `json:"roles" gorm:"type:text[]"`
	IsActive  *bool          `json:"is_active" gorm:"default:true"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"deleted_at" gorm:"index"`
}

// TableName returns the table name for User model
func (User) TableName() string {
	return "users"
}

// BeforeCreate hook to set default values
func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.Roles == nil {
		u.Roles = pq.StringArray{"user"}
	}
	return nil
}

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
	IsActive  *bool           `json:"is_active" gorm:"default:true"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
	DeletedAt gorm.DeletedAt  `json:"deleted_at" gorm:"index"`
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

// Token represents an ERC-20 token
type Token struct {
	ID          uint            `json:"id" gorm:"primaryKey"`
	Address     string          `json:"address" gorm:"uniqueIndex;not null;size:42"`
	Symbol      string          `json:"symbol" gorm:"not null;size:20;index"`
	Name        string          `json:"name" gorm:"not null;size:100"`
	Decimals    uint8           `json:"decimals" gorm:"not null"`
	TotalSupply decimal.Decimal `json:"total_supply" gorm:"type:decimal(36,18);column:total_supply"`
	Price       decimal.Decimal `json:"price" gorm:"type:decimal(36,18);column:price"`
	MarketCap   decimal.Decimal `json:"market_cap" gorm:"type:decimal(36,18);column:market_cap"`
	Volume24h   decimal.Decimal `json:"volume_24h" gorm:"type:decimal(36,18);column:volume_24h"`
	IsVerified  bool            `json:"is_verified" gorm:"default:false"`
	IsActive    *bool           `json:"is_active" gorm:"default:true"`
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

// LiquidityPosition represents a user's liquidity position in a pool
type LiquidityPosition struct {
	ID           uint            `json:"id" gorm:"primaryKey"`
	UserAddress  string          `json:"user_address" gorm:"not null;size:42;index"`
	PoolID       string          `json:"pool_id" gorm:"not null;size:66;index"`
	Liquidity    decimal.Decimal `json:"liquidity" gorm:"type:decimal(36,18);not null"`
	Token0Amount decimal.Decimal `json:"token0_amount" gorm:"type:decimal(36,18)"`
	Token1Amount decimal.Decimal `json:"token1_amount" gorm:"type:decimal(36,18)"`
	Shares       decimal.Decimal `json:"shares" gorm:"type:decimal(36,18)"`
	IsActive     *bool           `json:"is_active" gorm:"default:true"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
	DeletedAt    gorm.DeletedAt  `json:"deleted_at" gorm:"index"`

	// Relationships
	User *User `json:"user,omitempty" gorm:"foreignKey:UserAddress;references:Address"`
	Pool *Pool `json:"pool,omitempty" gorm:"foreignKey:PoolID;references:PoolID"`
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

// TransactionType represents the type of transaction
type TransactionType string

const (
	TransactionTypeSwap            TransactionType = "swap"
	TransactionTypeAddLiquidity    TransactionType = "add_liquidity"
	TransactionTypeRemoveLiquidity TransactionType = "remove_liquidity"
	TransactionTypeCreatePool      TransactionType = "create_pool"
)

// TransactionStatus represents the status of a transaction
type TransactionStatus string

const (
	TransactionStatusPending   TransactionStatus = "pending"
	TransactionStatusConfirmed TransactionStatus = "confirmed"
	TransactionStatusFailed    TransactionStatus = "failed"
)

// Transaction represents a blockchain transaction
type Transaction struct {
	ID          uint              `json:"id" gorm:"primaryKey"`
	TxHash      string            `json:"tx_hash" gorm:"uniqueIndex;not null;size:66"`
	UserAddress string            `json:"user_address" gorm:"not null;size:42;index"`
	PoolID      string            `json:"pool_id" gorm:"size:66;index"`
	Type        TransactionType   `json:"type" gorm:"not null;size:20"`
	Status      TransactionStatus `json:"status" gorm:"not null;size:20;default:'pending'"`
	TokenIn     string            `json:"token_in" gorm:"size:42"`
	TokenOut    string            `json:"token_out" gorm:"size:42"`
	AmountIn    decimal.Decimal   `json:"amount_in" gorm:"type:decimal(36,18)"`
	AmountOut   decimal.Decimal   `json:"amount_out" gorm:"type:decimal(36,18)"`
	GasUsed     uint64            `json:"gas_used"`
	GasPrice    decimal.Decimal   `json:"gas_price" gorm:"type:decimal(36,18)"`
	BlockNumber uint64            `json:"block_number"`
	BlockHash   string            `json:"block_hash" gorm:"size:66"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
	DeletedAt   gorm.DeletedAt    `json:"deleted_at" gorm:"index"`

	// Relationships
	User *User `json:"user,omitempty" gorm:"foreignKey:UserAddress;references:Address"`
	Pool *Pool `json:"pool,omitempty" gorm:"foreignKey:PoolID;references:PoolID"`
}

// TableName returns the table name for Transaction model
func (Transaction) TableName() string {
	return "transactions"
}
