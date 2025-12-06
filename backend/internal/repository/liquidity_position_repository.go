package repository

import (
	"errors"

	"github.com/irfndi/AetherDEX/backend/internal/models"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// LiquidityPositionRepository defines the interface for liquidity position operations
type LiquidityPositionRepository interface {
	// CRUD operations
	Create(position *models.LiquidityPosition) error
	GetByID(id uint) (*models.LiquidityPosition, error)
	GetByUserAndPool(userAddress, poolID string) (*models.LiquidityPosition, error)
	Update(position *models.LiquidityPosition) error
	Delete(id uint) error
	List(limit, offset int) ([]*models.LiquidityPosition, error)

	// Specific operations
	GetByUser(userAddress string, limit, offset int) ([]*models.LiquidityPosition, error)
	GetByPool(poolID string, limit, offset int) ([]*models.LiquidityPosition, error)
	GetActivePositions(limit, offset int) ([]*models.LiquidityPosition, error)
	GetUserActivePositions(userAddress string, limit, offset int) ([]*models.LiquidityPosition, error)
	UpdateLiquidity(id uint, liquidity decimal.Decimal) error
	UpdateAmounts(id uint, token0Amount, token1Amount decimal.Decimal) error
	GetTotalLiquidityByPool(poolID string) (decimal.Decimal, error)
	GetUserTotalLiquidity(userAddress string) (decimal.Decimal, error)
}

// liquidityPositionRepository implements LiquidityPositionRepository
type liquidityPositionRepository struct {
	db *gorm.DB
}

// NewLiquidityPositionRepository creates a new liquidity position repository
func NewLiquidityPositionRepository(db *gorm.DB) LiquidityPositionRepository {
	return &liquidityPositionRepository{db: db}
}

// Create creates a new liquidity position
func (r *liquidityPositionRepository) Create(position *models.LiquidityPosition) error {
	if position == nil {
		return errors.New("liquidity position cannot be nil")
	}
	return r.db.Create(position).Error
}

// GetByID retrieves a liquidity position by ID
func (r *liquidityPositionRepository) GetByID(id uint) (*models.LiquidityPosition, error) {
	if id == 0 {
		return nil, errors.New("id cannot be zero")
	}

	var position models.LiquidityPosition
	err := r.db.Preload("User").Preload("Pool").First(&position, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &position, nil
}

// GetByUserAndPool retrieves a liquidity position by user address and pool ID
func (r *liquidityPositionRepository) GetByUserAndPool(userAddress, poolID string) (*models.LiquidityPosition, error) {
	if userAddress == "" {
		return nil, errors.New("user address cannot be empty")
	}
	if poolID == "" {
		return nil, errors.New("pool ID cannot be empty")
	}

	var position models.LiquidityPosition
	err := r.db.Preload("User").Preload("Pool").
		Where("user_address = ? AND pool_id = ?", userAddress, poolID).
		First(&position).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &position, nil
}

// Update updates a liquidity position
func (r *liquidityPositionRepository) Update(position *models.LiquidityPosition) error {
	if position == nil {
		return errors.New("liquidity position cannot be nil")
	}
	return r.db.Save(position).Error
}

// Delete soft deletes a liquidity position
func (r *liquidityPositionRepository) Delete(id uint) error {
	if id == 0 {
		return errors.New("id cannot be zero")
	}
	return r.db.Delete(&models.LiquidityPosition{}, id).Error
}

// List retrieves liquidity positions with pagination
func (r *liquidityPositionRepository) List(limit, offset int) ([]*models.LiquidityPosition, error) {
	var positions []*models.LiquidityPosition
	err := r.db.Preload("User").Preload("Pool").
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&positions).Error
	return positions, err
}

// GetByUser retrieves liquidity positions by user address
func (r *liquidityPositionRepository) GetByUser(userAddress string, limit, offset int) ([]*models.LiquidityPosition, error) {
	if userAddress == "" {
		return nil, errors.New("user address cannot be empty")
	}

	var positions []*models.LiquidityPosition
	err := r.db.Preload("User").Preload("Pool").
		Where("user_address = ?", userAddress).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&positions).Error
	return positions, err
}

// GetByPool retrieves liquidity positions by pool ID
func (r *liquidityPositionRepository) GetByPool(poolID string, limit, offset int) ([]*models.LiquidityPosition, error) {
	if poolID == "" {
		return nil, errors.New("pool ID cannot be empty")
	}

	var positions []*models.LiquidityPosition
	err := r.db.Preload("User").Preload("Pool").
		Where("pool_id = ?", poolID).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&positions).Error
	return positions, err
}

// GetActivePositions retrieves active liquidity positions
func (r *liquidityPositionRepository) GetActivePositions(limit, offset int) ([]*models.LiquidityPosition, error) {
	var positions []*models.LiquidityPosition
	err := r.db.Preload("User").Preload("Pool").
		Where("is_active = ?", true).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&positions).Error
	return positions, err
}

// GetUserActivePositions retrieves active liquidity positions for a user
func (r *liquidityPositionRepository) GetUserActivePositions(userAddress string, limit, offset int) ([]*models.LiquidityPosition, error) {
	if userAddress == "" {
		return nil, errors.New("user address cannot be empty")
	}

	var positions []*models.LiquidityPosition
	err := r.db.Preload("User").Preload("Pool").
		Where("user_address = ? AND is_active = ?", userAddress, true).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&positions).Error
	return positions, err
}

// UpdateLiquidity updates the liquidity amount for a position
func (r *liquidityPositionRepository) UpdateLiquidity(id uint, liquidity decimal.Decimal) error {
	if id == 0 {
		return errors.New("id cannot be zero")
	}

	return r.db.Model(&models.LiquidityPosition{}).
		Where("id = ?", id).
		Update("liquidity", liquidity).Error
}

// UpdateAmounts updates the token amounts for a position
func (r *liquidityPositionRepository) UpdateAmounts(id uint, token0Amount, token1Amount decimal.Decimal) error {
	if id == 0 {
		return errors.New("id cannot be zero")
	}

	return r.db.Model(&models.LiquidityPosition{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"token0_amount": token0Amount,
			"token1_amount": token1Amount,
		}).Error
}

// GetTotalLiquidityByPool calculates total liquidity for a pool
func (r *liquidityPositionRepository) GetTotalLiquidityByPool(poolID string) (decimal.Decimal, error) {
	if poolID == "" {
		return decimal.Zero, errors.New("pool ID cannot be empty")
	}

	var result struct {
		TotalLiquidity decimal.Decimal
	}

	err := r.db.Model(&models.LiquidityPosition{}).
		Select("COALESCE(SUM(liquidity), 0) as total_liquidity").
		Where("pool_id = ? AND is_active = ?", poolID, true).
		Scan(&result).Error

	if err != nil {
		return decimal.Zero, err
	}

	return result.TotalLiquidity, nil
}

// GetUserTotalLiquidity calculates total liquidity for a user across all pools
func (r *liquidityPositionRepository) GetUserTotalLiquidity(userAddress string) (decimal.Decimal, error) {
	if userAddress == "" {
		return decimal.Zero, errors.New("user address cannot be empty")
	}

	var result struct {
		TotalLiquidity decimal.Decimal
	}

	err := r.db.Model(&models.LiquidityPosition{}).
		Select("COALESCE(SUM(liquidity), 0) as total_liquidity").
		Where("user_address = ? AND is_active = ?", userAddress, true).
		Scan(&result).Error

	if err != nil {
		return decimal.Zero, err
	}

	return result.TotalLiquidity, nil
}
