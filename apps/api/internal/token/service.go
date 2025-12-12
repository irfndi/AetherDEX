package token

import (
	"errors"

	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/shopspring/decimal"
)

// Service defines token service operations
type Service interface {
	CreateToken(token *models.Token) error
	GetTokenByID(id uint) (*models.Token, error)
	GetTokenByAddress(address string) (*models.Token, error)
	GetTokenBySymbol(symbol string) (*models.Token, error)
	ListTokens(limit, offset int) ([]*models.Token, error)
	GetVerifiedTokens(limit, offset int) ([]*models.Token, error)
	SearchTokens(query string, limit, offset int) ([]*models.Token, error)
	GetTopTokensByVolume(limit int) ([]*models.Token, error)
	GetTopTokensByMarketCap(limit int) ([]*models.Token, error)
	UpdateTokenPrice(id uint, price decimal.Decimal) error
}

type service struct {
	repo TokenRepository
}

// NewService creates a new token service
func NewService(repo TokenRepository) Service {
	return &service{repo: repo}
}

func (s *service) CreateToken(token *models.Token) error {
	if token.Address == "" || token.Symbol == "" {
		return errors.New("address and symbol are required")
	}
	return s.repo.Create(token)
}

func (s *service) GetTokenByID(id uint) (*models.Token, error) {
	return s.repo.GetByID(id)
}

func (s *service) GetTokenByAddress(address string) (*models.Token, error) {
	return s.repo.GetByAddress(address)
}

func (s *service) GetTokenBySymbol(symbol string) (*models.Token, error) {
	return s.repo.GetBySymbol(symbol)
}

func (s *service) ListTokens(limit, offset int) ([]*models.Token, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.List(limit, offset)
}

func (s *service) GetVerifiedTokens(limit, offset int) ([]*models.Token, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.GetVerifiedTokens(limit, offset)
}

func (s *service) SearchTokens(query string, limit, offset int) ([]*models.Token, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.SearchTokens(query, limit, offset)
}

func (s *service) GetTopTokensByVolume(limit int) ([]*models.Token, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	return s.repo.GetTopTokensByVolume(limit)
}

func (s *service) GetTopTokensByMarketCap(limit int) ([]*models.Token, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	return s.repo.GetTopTokensByMarketCap(limit)
}

func (s *service) UpdateTokenPrice(id uint, price decimal.Decimal) error {
	return s.repo.UpdatePrice(id, price)
}
