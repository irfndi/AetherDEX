package liquidity

import (
	"fmt"
	"testing"

	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/suite"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

// LiquidityPositionRepositoryTestSuite provides comprehensive tests for liquidity position repository
type LiquidityPositionRepositoryTestSuite struct {
	suite.Suite
	db   *gorm.DB
	repo LiquidityPositionRepository
}

// SetupSuite initializes the test suite
func (suite *LiquidityPositionRepositoryTestSuite) SetupSuite() {
	// Use in-memory SQLite for testing with pure Go driver
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared&_pragma=foreign_keys(1)"), &gorm.Config{})
	suite.Require().NoError(err)

	// Auto-migrate the schema
	err = db.AutoMigrate(&models.LiquidityPosition{}, &models.User{}, &models.Pool{})
	suite.Require().NoError(err)

	suite.db = db
	suite.repo = NewLiquidityPositionRepository(db)
}

// SetupTest runs before each test
func (suite *LiquidityPositionRepositoryTestSuite) SetupTest() {
	// Clean up database before each test
	suite.db.Exec("DELETE FROM liquidity_positions")
}

// TearDownSuite cleans up after all tests
func (suite *LiquidityPositionRepositoryTestSuite) TearDownSuite() {
	if sqlDB, err := suite.db.DB(); err == nil {
		sqlDB.Close()
	}
}

// TestCreateLiquidityPosition tests liquidity position creation
func (suite *LiquidityPositionRepositoryTestSuite) TestCreateLiquidityPosition() {
	position := &models.LiquidityPosition{
		UserAddress:  "0x1111111111111111111111111111111111111111",
		PoolID:       "pool-1",
		Liquidity:    decimal.NewFromInt(1000),
		Token0Amount: decimal.NewFromInt(500),
		Token1Amount: decimal.NewFromInt(500),
		Shares:       decimal.NewFromInt(1000),
		IsActive:     true,
	}

	err := suite.repo.Create(position)
	suite.NoError(err)
	suite.NotZero(position.ID)
	suite.NotZero(position.CreatedAt)
}

// TestCreateLiquidityPositionNil tests creating nil liquidity position
func (suite *LiquidityPositionRepositoryTestSuite) TestCreateLiquidityPositionNil() {
	err := suite.repo.Create(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "liquidity position cannot be nil")
}

// TestGetLiquidityPositionByID tests retrieving liquidity position by ID
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionByID() {
	// Create test position
	originalPosition := &models.LiquidityPosition{
		UserAddress:  "0x1111111111111111111111111111111111111111",
		PoolID:       "pool-1",
		Liquidity:    decimal.NewFromInt(1000),
		Token0Amount: decimal.NewFromInt(500),
		Token1Amount: decimal.NewFromInt(500),
		Shares:       decimal.NewFromInt(1000),
		IsActive:     true,
	}
	err := suite.repo.Create(originalPosition)
	suite.NoError(err)

	// Retrieve position
	position, err := suite.repo.GetByID(originalPosition.ID)
	suite.NoError(err)
	suite.NotNil(position)
	suite.Equal(originalPosition.UserAddress, position.UserAddress)
	suite.Equal(originalPosition.PoolID, position.PoolID)
	suite.True(originalPosition.Liquidity.Equal(position.Liquidity))
}

// TestGetLiquidityPositionByIDNotFound tests retrieving non-existent position
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionByIDNotFound() {
	position, err := suite.repo.GetByID(999)
	suite.NoError(err)
	suite.Nil(position)
}

// TestGetLiquidityPositionByIDZero tests retrieving position with zero ID
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionByIDZero() {
	position, err := suite.repo.GetByID(0)
	suite.Error(err)
	suite.Nil(position)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestGetLiquidityPositionByUserAndPool tests retrieving position by user and pool
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionByUserAndPool() {
	// Create test position
	originalPosition := &models.LiquidityPosition{
		UserAddress:  "0x1111111111111111111111111111111111111111",
		PoolID:       "pool-1",
		Liquidity:    decimal.NewFromInt(1000),
		Token0Amount: decimal.NewFromInt(500),
		Token1Amount: decimal.NewFromInt(500),
		Shares:       decimal.NewFromInt(1000),
		IsActive:     true,
	}
	err := suite.repo.Create(originalPosition)
	suite.NoError(err)

	// Retrieve position
	position, err := suite.repo.GetByUserAndPool("0x1111111111111111111111111111111111111111", "pool-1")
	suite.NoError(err)
	suite.NotNil(position)
	suite.Equal(originalPosition.UserAddress, position.UserAddress)
	suite.Equal(originalPosition.PoolID, position.PoolID)
}

// TestGetLiquidityPositionByUserAndPoolNotFound tests retrieving non-existent position
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionByUserAndPoolNotFound() {
	position, err := suite.repo.GetByUserAndPool("0x0000000000000000000000000000000000000000", "pool-nonexistent")
	suite.NoError(err)
	suite.Nil(position)
}

// TestGetLiquidityPositionByUserAndPoolEmptyUser tests retrieving position with empty user
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionByUserAndPoolEmptyUser() {
	position, err := suite.repo.GetByUserAndPool("", "pool-1")
	suite.Error(err)
	suite.Nil(position)
	suite.Contains(err.Error(), "user address cannot be empty")
}

// TestGetLiquidityPositionByUserAndPoolEmptyPool tests retrieving position with empty pool
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionByUserAndPoolEmptyPool() {
	position, err := suite.repo.GetByUserAndPool("0x1111111111111111111111111111111111111111", "")
	suite.Error(err)
	suite.Nil(position)
	suite.Contains(err.Error(), "pool ID cannot be empty")
}

// TestGetLiquidityPositionsByUser tests retrieving positions by user address
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionsByUser() {
	userAddress := "0x1111111111111111111111111111111111111111"

	// Create multiple positions for the user
	for i := 0; i < 3; i++ {
		position := &models.LiquidityPosition{
			UserAddress:  userAddress,
			PoolID:       fmt.Sprintf("pool-%d", i),
			Liquidity:    decimal.NewFromInt(1000 + int64(i*100)),
			Token0Amount: decimal.NewFromInt(500 + int64(i*50)),
			Token1Amount: decimal.NewFromInt(500 + int64(i*50)),
			Shares:       decimal.NewFromInt(1000 + int64(i*100)),
			IsActive:     true,
		}
		err := suite.repo.Create(position)
		suite.NoError(err)
	}

	// Create position for different user
	differentUserPosition := &models.LiquidityPosition{
		UserAddress:  "0x2222222222222222222222222222222222222222",
		PoolID:       "pool-different",
		Liquidity:    decimal.NewFromInt(2000),
		Token0Amount: decimal.NewFromInt(1000),
		Token1Amount: decimal.NewFromInt(1000),
		Shares:       decimal.NewFromInt(2000),
		IsActive:     true,
	}
	err := suite.repo.Create(differentUserPosition)
	suite.NoError(err)

	// Get positions by user
	userPositions, err := suite.repo.GetByUser(userAddress, 10, 0)
	suite.NoError(err)
	suite.Len(userPositions, 3)

	// Verify all positions belong to the user
	for _, position := range userPositions {
		suite.Equal(userAddress, position.UserAddress)
	}
}

// TestGetLiquidityPositionsByUserEmpty tests retrieving positions with empty user address
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionsByUserEmpty() {
	positions, err := suite.repo.GetByUser("", 10, 0)
	suite.Error(err)
	suite.Nil(positions)
	suite.Contains(err.Error(), "user address cannot be empty")
}

// TestGetLiquidityPositionsByPool tests retrieving positions by pool ID
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionsByPool() {
	poolID := "pool-1"

	// Create multiple positions for the pool
	for i := 0; i < 3; i++ {
		position := &models.LiquidityPosition{
			UserAddress:  fmt.Sprintf("0x%040d", i),
			PoolID:       poolID,
			Liquidity:    decimal.NewFromInt(1000 + int64(i*100)),
			Token0Amount: decimal.NewFromInt(500 + int64(i*50)),
			Token1Amount: decimal.NewFromInt(500 + int64(i*50)),
			Shares:       decimal.NewFromInt(1000 + int64(i*100)),
			IsActive:     true,
		}
		err := suite.repo.Create(position)
		suite.NoError(err)
	}

	// Get positions by pool
	poolPositions, err := suite.repo.GetByPool(poolID, 10, 0)
	suite.NoError(err)
	suite.Len(poolPositions, 3)

	// Verify all positions belong to the pool
	for _, position := range poolPositions {
		suite.Equal(poolID, position.PoolID)
	}
}

// TestGetLiquidityPositionsByPoolEmpty tests retrieving positions with empty pool ID
func (suite *LiquidityPositionRepositoryTestSuite) TestGetLiquidityPositionsByPoolEmpty() {
	positions, err := suite.repo.GetByPool("", 10, 0)
	suite.Error(err)
	suite.Nil(positions)
	suite.Contains(err.Error(), "pool ID cannot be empty")
}

// TestGetActivePositions tests retrieving active positions
func (suite *LiquidityPositionRepositoryTestSuite) TestGetActivePositions() {
	// Create active and inactive positions
	for i := 0; i < 5; i++ {
		position := &models.LiquidityPosition{
			UserAddress:  fmt.Sprintf("0x%040d", i),
			PoolID:       fmt.Sprintf("pool-%d", i),
			Liquidity:    decimal.NewFromInt(1000 + int64(i*100)),
			Token0Amount: decimal.NewFromInt(500 + int64(i*50)),
			Token1Amount: decimal.NewFromInt(500 + int64(i*50)),
			Shares:       decimal.NewFromInt(1000 + int64(i*100)),
			IsActive:     i < 3, // First 3 are active, last 2 are inactive
		}
		err := suite.repo.Create(position)
		suite.NoError(err)
	}

	// Get active positions
	activePositions, err := suite.repo.GetActivePositions(10, 0)
	suite.NoError(err)
	suite.Len(activePositions, 3)

	// Verify all positions are active
	for _, position := range activePositions {
		suite.True(position.IsActive)
	}
}

// TestGetUserActivePositions tests retrieving active positions for a user
func (suite *LiquidityPositionRepositoryTestSuite) TestGetUserActivePositions() {
	userAddress := "0x1111111111111111111111111111111111111111"

	// Create active and inactive positions for the user
	for i := 0; i < 4; i++ {
		position := &models.LiquidityPosition{
			UserAddress:  userAddress,
			PoolID:       fmt.Sprintf("pool-%d", i),
			Liquidity:    decimal.NewFromInt(1000 + int64(i*100)),
			Token0Amount: decimal.NewFromInt(500 + int64(i*50)),
			Token1Amount: decimal.NewFromInt(500 + int64(i*50)),
			Shares:       decimal.NewFromInt(1000 + int64(i*100)),
			IsActive:     i < 2, // First 2 are active, last 2 are inactive
		}
		err := suite.repo.Create(position)
		suite.NoError(err)
	}

	// Create active position for different user
	differentUserPosition := &models.LiquidityPosition{
		UserAddress:  "0x2222222222222222222222222222222222222222",
		PoolID:       "pool-different",
		Liquidity:    decimal.NewFromInt(2000),
		Token0Amount: decimal.NewFromInt(1000),
		Token1Amount: decimal.NewFromInt(1000),
		Shares:       decimal.NewFromInt(2000),
		IsActive:     true,
	}
	err := suite.repo.Create(differentUserPosition)
	suite.NoError(err)

	// Get user active positions
	userActivePositions, err := suite.repo.GetUserActivePositions(userAddress, 10, 0)
	suite.NoError(err)
	suite.Len(userActivePositions, 2)

	// Verify all positions belong to the user and are active
	for _, position := range userActivePositions {
		suite.Equal(userAddress, position.UserAddress)
		suite.True(position.IsActive)
	}
}

// TestGetUserActivePositionsEmpty tests retrieving active positions with empty user address
func (suite *LiquidityPositionRepositoryTestSuite) TestGetUserActivePositionsEmpty() {
	positions, err := suite.repo.GetUserActivePositions("", 10, 0)
	suite.Error(err)
	suite.Nil(positions)
	suite.Contains(err.Error(), "user address cannot be empty")
}

// TestUpdateLiquidityPosition tests updating liquidity position
func (suite *LiquidityPositionRepositoryTestSuite) TestUpdateLiquidityPosition() {
	// Create test position
	position := &models.LiquidityPosition{
		UserAddress:  "0x1111111111111111111111111111111111111111",
		PoolID:       "pool-1",
		Liquidity:    decimal.NewFromInt(1000),
		Token0Amount: decimal.NewFromInt(500),
		Token1Amount: decimal.NewFromInt(500),
		Shares:       decimal.NewFromInt(1000),
		IsActive:     true,
	}
	err := suite.repo.Create(position)
	suite.NoError(err)

	// Update position
	position.Liquidity = decimal.NewFromInt(2000)
	position.Token0Amount = decimal.NewFromInt(1000)
	position.Token1Amount = decimal.NewFromInt(1000)
	position.Shares = decimal.NewFromInt(2000)
	err = suite.repo.Update(position)
	suite.NoError(err)

	// Verify update
	updatedPosition, err := suite.repo.GetByID(position.ID)
	suite.NoError(err)
	suite.True(decimal.NewFromInt(2000).Equal(updatedPosition.Liquidity))
	suite.True(decimal.NewFromInt(1000).Equal(updatedPosition.Token0Amount))
	suite.True(decimal.NewFromInt(1000).Equal(updatedPosition.Token1Amount))
	suite.True(decimal.NewFromInt(2000).Equal(updatedPosition.Shares))
}

// TestUpdateLiquidityPositionNil tests updating nil position
func (suite *LiquidityPositionRepositoryTestSuite) TestUpdateLiquidityPositionNil() {
	err := suite.repo.Update(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "liquidity position cannot be nil")
}

// TestUpdateLiquidity tests updating liquidity amount
func (suite *LiquidityPositionRepositoryTestSuite) TestUpdateLiquidity() {
	// Create test position
	position := &models.LiquidityPosition{
		UserAddress:  "0x1111111111111111111111111111111111111111",
		PoolID:       "pool-1",
		Liquidity:    decimal.NewFromInt(1000),
		Token0Amount: decimal.NewFromInt(500),
		Token1Amount: decimal.NewFromInt(500),
		Shares:       decimal.NewFromInt(1000),
		IsActive:     true,
	}
	err := suite.repo.Create(position)
	suite.NoError(err)

	// Update liquidity
	newLiquidity := decimal.NewFromInt(2000)
	err = suite.repo.UpdateLiquidity(position.ID, newLiquidity)
	suite.NoError(err)

	// Verify update
	updatedPosition, err := suite.repo.GetByID(position.ID)
	suite.NoError(err)
	suite.True(newLiquidity.Equal(updatedPosition.Liquidity))
}

// TestUpdateLiquidityZeroID tests updating liquidity with zero ID
func (suite *LiquidityPositionRepositoryTestSuite) TestUpdateLiquidityZeroID() {
	err := suite.repo.UpdateLiquidity(0, decimal.NewFromInt(1000))
	suite.Error(err)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestUpdateAmounts tests updating token amounts
func (suite *LiquidityPositionRepositoryTestSuite) TestUpdateAmounts() {
	// Create test position
	position := &models.LiquidityPosition{
		UserAddress:  "0x1111111111111111111111111111111111111111",
		PoolID:       "pool-1",
		Liquidity:    decimal.NewFromInt(1000),
		Token0Amount: decimal.NewFromInt(500),
		Token1Amount: decimal.NewFromInt(500),
		Shares:       decimal.NewFromInt(1000),
		IsActive:     true,
	}
	err := suite.repo.Create(position)
	suite.NoError(err)

	// Update amounts
	newToken0Amount := decimal.NewFromInt(1000)
	newToken1Amount := decimal.NewFromInt(1500)
	err = suite.repo.UpdateAmounts(position.ID, newToken0Amount, newToken1Amount)
	suite.NoError(err)

	// Verify update
	updatedPosition, err := suite.repo.GetByID(position.ID)
	suite.NoError(err)
	suite.True(newToken0Amount.Equal(updatedPosition.Token0Amount))
	suite.True(newToken1Amount.Equal(updatedPosition.Token1Amount))
}

// TestUpdateAmountsZeroID tests updating amounts with zero ID
func (suite *LiquidityPositionRepositoryTestSuite) TestUpdateAmountsZeroID() {
	err := suite.repo.UpdateAmounts(0, decimal.NewFromInt(1000), decimal.NewFromInt(1000))
	suite.Error(err)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestDeleteLiquidityPosition tests deleting position
func (suite *LiquidityPositionRepositoryTestSuite) TestDeleteLiquidityPosition() {
	// Create test position
	position := &models.LiquidityPosition{
		UserAddress:  "0x1111111111111111111111111111111111111111",
		PoolID:       "pool-1",
		Liquidity:    decimal.NewFromInt(1000),
		Token0Amount: decimal.NewFromInt(500),
		Token1Amount: decimal.NewFromInt(500),
		Shares:       decimal.NewFromInt(1000),
		IsActive:     true,
	}
	err := suite.repo.Create(position)
	suite.NoError(err)

	// Delete position
	err = suite.repo.Delete(position.ID)
	suite.NoError(err)

	// Verify deletion (soft delete)
	deletedPosition, err := suite.repo.GetByID(position.ID)
	suite.NoError(err)
	suite.Nil(deletedPosition) // Should be nil due to soft delete
}

// TestDeleteLiquidityPositionZeroID tests deleting position with zero ID
func (suite *LiquidityPositionRepositoryTestSuite) TestDeleteLiquidityPositionZeroID() {
	err := suite.repo.Delete(0)
	suite.Error(err)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestListLiquidityPositions tests listing positions with pagination
func (suite *LiquidityPositionRepositoryTestSuite) TestListLiquidityPositions() {
	// Create multiple test positions
	for i := 0; i < 5; i++ {
		position := &models.LiquidityPosition{
			UserAddress:  fmt.Sprintf("0x%040d", i),
			PoolID:       fmt.Sprintf("pool-%d", i),
			Liquidity:    decimal.NewFromInt(1000 + int64(i*100)),
			Token0Amount: decimal.NewFromInt(500 + int64(i*50)),
			Token1Amount: decimal.NewFromInt(500 + int64(i*50)),
			Shares:       decimal.NewFromInt(1000 + int64(i*100)),
			IsActive:     true,
		}
		err := suite.repo.Create(position)
		suite.NoError(err)
	}

	// Test pagination
	positions, err := suite.repo.List(3, 0)
	suite.NoError(err)
	suite.Len(positions, 3)

	// Test offset
	positions, err = suite.repo.List(3, 2)
	suite.NoError(err)
	suite.Len(positions, 3)
}

// TestGetTotalLiquidityByPool tests getting total liquidity by pool
func (suite *LiquidityPositionRepositoryTestSuite) TestGetTotalLiquidityByPool() {
	poolID := "pool-1"

	// Create positions with different liquidity amounts
	liquidityAmounts := []int64{1000, 2000, 3000}
	for i, amount := range liquidityAmounts {
		position := &models.LiquidityPosition{
			UserAddress:  fmt.Sprintf("0x%040d", i),
			PoolID:       poolID,
			Liquidity:    decimal.NewFromInt(amount),
			Token0Amount: decimal.NewFromInt(amount / 2),
			Token1Amount: decimal.NewFromInt(amount / 2),
			Shares:       decimal.NewFromInt(amount),
			IsActive:     true,
		}
		err := suite.repo.Create(position)
		suite.NoError(err)
	}

	// Create inactive position (should not be counted)
	inactivePosition := &models.LiquidityPosition{
		UserAddress:  "0x9999999999999999999999999999999999999999",
		PoolID:       poolID,
		Liquidity:    decimal.NewFromInt(5000),
		Token0Amount: decimal.NewFromInt(2500),
		Token1Amount: decimal.NewFromInt(2500),
		Shares:       decimal.NewFromInt(5000),
		IsActive:     false,
	}
	err := suite.repo.Create(inactivePosition)
	suite.NoError(err)

	// Get total liquidity by pool
	totalLiquidity, err := suite.repo.GetTotalLiquidityByPool(poolID)
	suite.NoError(err)

	// Total should be sum of active positions: 1000 + 2000 + 3000 = 6000
	expectedTotal := decimal.NewFromInt(6000)
	suite.True(totalLiquidity.Equal(expectedTotal))
}

// TestGetTotalLiquidityByPoolEmpty tests getting total liquidity with empty pool ID
func (suite *LiquidityPositionRepositoryTestSuite) TestGetTotalLiquidityByPoolEmpty() {
	totalLiquidity, err := suite.repo.GetTotalLiquidityByPool("")
	suite.Error(err)
	suite.True(totalLiquidity.IsZero())
	suite.Contains(err.Error(), "pool ID cannot be empty")
}

// TestGetUserTotalLiquidity tests getting total liquidity for a user
func (suite *LiquidityPositionRepositoryTestSuite) TestGetUserTotalLiquidity() {
	userAddress := "0x1111111111111111111111111111111111111111"

	// Create positions with different liquidity amounts for the user
	liquidityAmounts := []int64{1000, 2000, 3000}
	for i, amount := range liquidityAmounts {
		position := &models.LiquidityPosition{
			UserAddress:  userAddress,
			PoolID:       fmt.Sprintf("pool-%d", i),
			Liquidity:    decimal.NewFromInt(amount),
			Token0Amount: decimal.NewFromInt(amount / 2),
			Token1Amount: decimal.NewFromInt(amount / 2),
			Shares:       decimal.NewFromInt(1000 + int64(i*100)),
			IsActive:     true,
		}
		err := suite.repo.Create(position)
		suite.NoError(err)
	}

	// Create inactive position for the user (should not be counted)
	inactivePosition := &models.LiquidityPosition{
		UserAddress:  userAddress,
		PoolID:       "pool-inactive",
		Liquidity:    decimal.NewFromInt(5000),
		Token0Amount: decimal.NewFromInt(2500),
		Token1Amount: decimal.NewFromInt(2500),
		Shares:       decimal.NewFromInt(5000),
		IsActive:     false,
	}
	err := suite.repo.Create(inactivePosition)
	suite.NoError(err)

	// Create position for different user (should not be counted)
	differentUserPosition := &models.LiquidityPosition{
		UserAddress:  "0x2222222222222222222222222222222222222222",
		PoolID:       "pool-different",
		Liquidity:    decimal.NewFromInt(10000),
		Token0Amount: decimal.NewFromInt(5000),
		Token1Amount: decimal.NewFromInt(5000),
		Shares:       decimal.NewFromInt(10000),
		IsActive:     true,
	}
	err = suite.repo.Create(differentUserPosition)
	suite.NoError(err)

	// Get user total liquidity
	userTotalLiquidity, err := suite.repo.GetUserTotalLiquidity(userAddress)
	suite.NoError(err)

	// Total should be sum of user's active positions: 1000 + 2000 + 3000 = 6000
	expectedTotal := decimal.NewFromInt(6000)
	suite.True(userTotalLiquidity.Equal(expectedTotal))
}

// TestGetUserTotalLiquidityEmpty tests getting total liquidity with empty user address
func (suite *LiquidityPositionRepositoryTestSuite) TestGetUserTotalLiquidityEmpty() {
	totalLiquidity, err := suite.repo.GetUserTotalLiquidity("")
	suite.Error(err)
	suite.True(totalLiquidity.IsZero())
	suite.Contains(err.Error(), "user address cannot be empty")
}

// TestLiquidityPositionRepositoryTestSuite runs the test suite
func TestLiquidityPositionRepositoryTestSuite(t *testing.T) {
	suite.Run(t, new(LiquidityPositionRepositoryTestSuite))
}
