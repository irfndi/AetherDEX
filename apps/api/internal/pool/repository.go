package pool

import (
	"errors"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// PoolRepository interface defines pool database operations
type PoolRepository interface {
	Create(pool *Pool) error
	GetByID(id uint) (*Pool, error)
	GetByPoolID(poolID string) (*Pool, error)
	GetByTokens(token0, token1 string) (*Pool, error)
	Update(pool *Pool) error
	Delete(id uint) error
	List(limit, offset int) ([]*Pool, error)
	GetActivePools() ([]*Pool, error)
	UpdateLiquidity(poolID string, liquidity decimal.Decimal) error
	UpdateReserves(poolID string, reserve0, reserve1 decimal.Decimal) error
	GetTopPoolsByTVL(limit int) ([]*Pool, error)
	GetPoolsByToken(tokenAddress string) ([]*Pool, error)
}

// poolRepository implements PoolRepository interface
type poolRepository struct {
	db *gorm.DB
}

// NewPoolRepository creates a new pool repository
func NewPoolRepository(db *gorm.DB) PoolRepository {
	return &poolRepository{db: db}
}

// Create creates a new pool
func (r *poolRepository) Create(pool *Pool) error {
	if pool == nil {
		return errors.New("pool cannot be nil")
	}
	return r.db.Create(pool).Error
}

// GetByID retrieves a pool by its ID
func (r *poolRepository) GetByID(id uint) (*Pool, error) {
	if id == 0 {
		return nil, errors.New("id cannot be zero")
	}

	var pool Pool
	err := r.db.First(&pool, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &pool, nil
}

// GetByPoolID retrieves a pool by its pool ID
func (r *poolRepository) GetByPoolID(poolID string) (*Pool, error) {
	if poolID == "" {
		return nil, errors.New("poolID cannot be empty")
	}

	var pool Pool
	err := r.db.Where("pool_id = ?", poolID).First(&pool).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &pool, nil
}

// GetByTokens retrieves a pool by token pair
func (r *poolRepository) GetByTokens(token0, token1 string) (*Pool, error) {
	if token0 == "" || token1 == "" {
		return nil, errors.New("token addresses cannot be empty")
	}

	var pool Pool
	err := r.db.Where(
		"(token0 = ? AND token1 = ?) OR (token0 = ? AND token1 = ?)",
		token0, token1, token1, token0,
	).First(&pool).Error

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &pool, nil
}

// Update updates an existing pool
func (r *poolRepository) Update(pool *Pool) error {
	if pool == nil {
		return errors.New("pool cannot be nil")
	}
	return r.db.Save(pool).Error
}

// Delete soft deletes a pool by ID
func (r *poolRepository) Delete(id uint) error {
	if id == 0 {
		return errors.New("id cannot be zero")
	}
	return r.db.Delete(&Pool{}, id).Error
}

// List retrieves pools with pagination
func (r *poolRepository) List(limit, offset int) ([]*Pool, error) {
	var pools []*Pool
	err := r.db.Limit(limit).Offset(offset).Find(&pools).Error
	return pools, err
}

// GetActivePools retrieves all active pools
func (r *poolRepository) GetActivePools() ([]*Pool, error) {
	var pools []*Pool
	err := r.db.Where("is_active = ?", true).Find(&pools).Error
	return pools, err
}

// UpdateLiquidity updates a pool's liquidity
func (r *poolRepository) UpdateLiquidity(poolID string, liquidity decimal.Decimal) error {
	if poolID == "" {
		return errors.New("poolID cannot be empty")
	}
	return r.db.Model(&Pool{}).Where("pool_id = ?", poolID).Update("liquidity", liquidity).Error
}

// UpdateReserves updates a pool's reserves
func (r *poolRepository) UpdateReserves(poolID string, reserve0, reserve1 decimal.Decimal) error {
	if poolID == "" {
		return errors.New("poolID cannot be empty")
	}
	return r.db.Model(&Pool{}).Where("pool_id = ?", poolID).Updates(map[string]interface{}{
		"reserve0": reserve0,
		"reserve1": reserve1,
	}).Error
}

// GetTopPoolsByTVL retrieves top pools by TVL
func (r *poolRepository) GetTopPoolsByTVL(limit int) ([]*Pool, error) {
	var pools []*Pool
	err := r.db.Where("is_active = ?", true).Order("CAST(tvl AS DECIMAL) DESC").Limit(limit).Find(&pools).Error
	return pools, err
}

// GetPoolsByToken retrieves pools containing a specific token
func (r *poolRepository) GetPoolsByToken(tokenAddress string) ([]*Pool, error) {
	if tokenAddress == "" {
		return nil, errors.New("token address cannot be empty")
	}

	var pools []*Pool
	err := r.db.Where("token0 = ? OR token1 = ?", tokenAddress, tokenAddress).Find(&pools).Error
	return pools, err
}
