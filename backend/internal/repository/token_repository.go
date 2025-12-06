package repository

import (
	"errors"
	"strings"

	"github.com/irfndi/AetherDEX/backend/internal/models"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// TokenRepository defines the interface for token data operations
type TokenRepository interface {
	// Basic CRUD operations
	Create(token *models.Token) error
	GetByID(id uint) (*models.Token, error)
	GetByAddress(address string) (*models.Token, error)
	GetBySymbol(symbol string) (*models.Token, error)
	Update(token *models.Token) error
	Delete(id uint) error
	List(limit, offset int) ([]*models.Token, error)

	// Token-specific operations
	GetVerifiedTokens(limit, offset int) ([]*models.Token, error)
	GetActiveTokens(limit, offset int) ([]*models.Token, error)
	GetTokensBySymbols(symbols []string) ([]*models.Token, error)
	UpdatePrice(id uint, price decimal.Decimal) error
	UpdateMarketData(id uint, marketCap, volume24h decimal.Decimal) error
	SearchTokens(query string, limit, offset int) ([]*models.Token, error)
	GetTopTokensByVolume(limit int) ([]*models.Token, error)
	GetTopTokensByMarketCap(limit int) ([]*models.Token, error)
}

// tokenRepository implements TokenRepository interface
type tokenRepository struct {
	db *gorm.DB
}

// NewTokenRepository creates a new token repository instance
func NewTokenRepository(db *gorm.DB) TokenRepository {
	return &tokenRepository{db: db}
}

// Create creates a new token
func (r *tokenRepository) Create(token *models.Token) error {
	if token == nil {
		return errors.New("token cannot be nil")
	}
	return r.db.Create(token).Error
}

// GetByID retrieves a token by ID
func (r *tokenRepository) GetByID(id uint) (*models.Token, error) {
	if id == 0 {
		return nil, errors.New("id cannot be zero")
	}

	var token models.Token
	err := r.db.First(&token, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &token, nil
}

// GetByAddress retrieves a token by address
func (r *tokenRepository) GetByAddress(address string) (*models.Token, error) {
	if strings.TrimSpace(address) == "" {
		return nil, errors.New("address cannot be empty")
	}

	var token models.Token
	err := r.db.Where("address = ?", address).First(&token).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &token, nil
}

// GetBySymbol retrieves a token by symbol
func (r *tokenRepository) GetBySymbol(symbol string) (*models.Token, error) {
	if strings.TrimSpace(symbol) == "" {
		return nil, errors.New("symbol cannot be empty")
	}

	var token models.Token
	err := r.db.Where("symbol = ?", symbol).First(&token).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &token, nil
}

// Update updates an existing token
func (r *tokenRepository) Update(token *models.Token) error {
	if token == nil {
		return errors.New("token cannot be nil")
	}
	return r.db.Save(token).Error
}

// Delete soft deletes a token
func (r *tokenRepository) Delete(id uint) error {
	if id == 0 {
		return errors.New("id cannot be zero")
	}
	return r.db.Delete(&models.Token{}, id).Error
}

// List retrieves tokens with pagination
func (r *tokenRepository) List(limit, offset int) ([]*models.Token, error) {
	var tokens []*models.Token
	err := r.db.Limit(limit).Offset(offset).Find(&tokens).Error
	return tokens, err
}

// GetVerifiedTokens retrieves verified tokens
func (r *tokenRepository) GetVerifiedTokens(limit, offset int) ([]*models.Token, error) {
	var tokens []*models.Token
	err := r.db.Where("is_verified = ? AND is_active = ?", true, true).
		Limit(limit).Offset(offset).Find(&tokens).Error
	return tokens, err
}

// GetActiveTokens retrieves active tokens
func (r *tokenRepository) GetActiveTokens(limit, offset int) ([]*models.Token, error) {
	var tokens []*models.Token
	err := r.db.Where("is_active = ?", true).
		Limit(limit).Offset(offset).Find(&tokens).Error
	return tokens, err
}

// GetTokensBySymbols retrieves tokens by multiple symbols
func (r *tokenRepository) GetTokensBySymbols(symbols []string) ([]*models.Token, error) {
	if len(symbols) == 0 {
		return []*models.Token{}, nil
	}

	var tokens []*models.Token
	err := r.db.Where("symbol IN ? AND is_active = ?", symbols, true).Find(&tokens).Error
	return tokens, err
}

// UpdatePrice updates token price
func (r *tokenRepository) UpdatePrice(id uint, price decimal.Decimal) error {
	if id == 0 {
		return errors.New("id cannot be zero")
	}

	return r.db.Model(&models.Token{}).Where("id = ?", id).
		Update("price", price).Error
}

// UpdateMarketData updates token market data
func (r *tokenRepository) UpdateMarketData(id uint, marketCap, volume24h decimal.Decimal) error {
	if id == 0 {
		return errors.New("id cannot be zero")
	}

	return r.db.Model(&models.Token{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"market_cap": marketCap,
			"volume_24h": volume24h,
		}).Error
}

// SearchTokens searches tokens by name or symbol
func (r *tokenRepository) SearchTokens(query string, limit, offset int) ([]*models.Token, error) {
	if strings.TrimSpace(query) == "" {
		return []*models.Token{}, nil
	}

	var tokens []*models.Token
	searchPattern := "%" + strings.ToLower(query) + "%"
	err := r.db.Where("(LOWER(name) LIKE ? OR LOWER(symbol) LIKE ?) AND is_active = ?",
		searchPattern, searchPattern, true).
		Limit(limit).Offset(offset).Find(&tokens).Error
	return tokens, err
}

// GetTopTokensByVolume retrieves top tokens by 24h volume
func (r *tokenRepository) GetTopTokensByVolume(limit int) ([]*models.Token, error) {
	var tokens []*models.Token
	err := r.db.Where("is_active = ?", true).
		Order("volume_24h DESC").
		Limit(limit).Find(&tokens).Error
	return tokens, err
}

// GetTopTokensByMarketCap retrieves top tokens by market cap
func (r *tokenRepository) GetTopTokensByMarketCap(limit int) ([]*models.Token, error) {
	var tokens []*models.Token
	err := r.db.Where("is_active = ?", true).
		Order("market_cap DESC").
		Limit(limit).Find(&tokens).Error
	return tokens, err
}
