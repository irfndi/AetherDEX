package models_test

import (
	"testing"

	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
)

func TestUser_BeforeCreate(t *testing.T) {
	user := &models.User{
		Address: "0x123",
	}
	err := user.BeforeCreate(nil)
	assert.NoError(t, err)
	assert.Contains(t, user.Roles, "user")
}

func TestPool_BeforeCreate(t *testing.T) {
	t.Run("Success", func(t *testing.T) {
		pool := &models.Pool{
			Token0: "0x1",
			Token1: "0x2",
		}
		err := pool.BeforeCreate(nil)
		assert.NoError(t, err)
	})

	t.Run("SameToken", func(t *testing.T) {
		pool := &models.Pool{
			Token0: "0x1",
			Token1: "0x1",
		}
		err := pool.BeforeCreate(nil)
		assert.ErrorIs(t, err, gorm.ErrInvalidData)
	})
}

func TestToken_BeforeCreate(t *testing.T) {
	t.Run("Success", func(t *testing.T) {
		token := &models.Token{
			Address: "0x0000000000000000000000000000000000000042",
			Symbol:  "TKN",
			Name:    "Token",
		}
		err := token.BeforeCreate(nil)
		assert.NoError(t, err)
	})

	t.Run("InvalidAddressLength", func(t *testing.T) {
		token := &models.Token{
			Address: "0x123",
			Symbol:  "TKN",
			Name:    "Token",
		}
		err := token.BeforeCreate(nil)
		assert.ErrorIs(t, err, gorm.ErrInvalidData)
	})

	t.Run("MissingSymbol", func(t *testing.T) {
		token := &models.Token{
			Address: "0x0000000000000000000000000000000000000042",
			Symbol:  "",
			Name:    "Token",
		}
		err := token.BeforeCreate(nil)
		assert.ErrorIs(t, err, gorm.ErrInvalidData)
	})
}

func TestLiquidityPosition_BeforeCreate(t *testing.T) {
	t.Run("Success", func(t *testing.T) {
		lp := &models.LiquidityPosition{
			Liquidity: decimal.NewFromInt(100),
		}
		err := lp.BeforeCreate(nil)
		assert.NoError(t, err)
	})

	t.Run("ZeroLiquidity", func(t *testing.T) {
		lp := &models.LiquidityPosition{
			Liquidity: decimal.Zero,
		}
		err := lp.BeforeCreate(nil)
		assert.ErrorIs(t, err, gorm.ErrInvalidData)
	})
}
