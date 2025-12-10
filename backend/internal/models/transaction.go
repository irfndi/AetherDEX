package models

import (
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"time"
)

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
