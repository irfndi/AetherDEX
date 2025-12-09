package pool

import (
	"errors"
	"github.com/shopspring/decimal"
)

// Service defines pool service operations
type Service interface {
	CreatePool(pool *Pool) error
	GetPoolByID(id uint) (*Pool, error)
	GetPoolByPoolID(poolID string) (*Pool, error)
	GetPoolByTokens(token0, token1 string) (*Pool, error)
	ListPools(limit, offset int) ([]*Pool, error)
	GetActivePools() ([]*Pool, error)
	UpdatePoolLiquidity(poolID string, liquidity decimal.Decimal) error
	GetTopPools(limit int) ([]*Pool, error)
}

type service struct {
	repo PoolRepository
}

// NewService creates a new pool service
func NewService(repo PoolRepository) Service {
	return &service{repo: repo}
}

func (s *service) CreatePool(pool *Pool) error {
	// Add business logic validation here if needed
	if pool.Token0 == "" || pool.Token1 == "" {
		return errors.New("token addresses required")
	}
	return s.repo.Create(pool)
}

func (s *service) GetPoolByID(id uint) (*Pool, error) {
	return s.repo.GetByID(id)
}

func (s *service) GetPoolByPoolID(poolID string) (*Pool, error) {
	return s.repo.GetByPoolID(poolID)
}

func (s *service) GetPoolByTokens(token0, token1 string) (*Pool, error) {
	return s.repo.GetByTokens(token0, token1)
}

func (s *service) ListPools(limit, offset int) ([]*Pool, error) {
	if limit <= 0 {
		limit = 10
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.List(limit, offset)
}

func (s *service) GetActivePools() ([]*Pool, error) {
	return s.repo.GetActivePools()
}

func (s *service) UpdatePoolLiquidity(poolID string, liquidity decimal.Decimal) error {
	return s.repo.UpdateLiquidity(poolID, liquidity)
}

func (s *service) GetTopPools(limit int) ([]*Pool, error) {
	if limit <= 0 {
		limit = 10
	}
	return s.repo.GetTopPoolsByTVL(limit)
}
