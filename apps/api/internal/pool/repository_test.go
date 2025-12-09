package pool

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

// PoolRepositoryTestSuite provides comprehensive tests for pool repository
type PoolRepositoryTestSuite struct {
	suite.Suite
	db   *gorm.DB
	repo PoolRepository
}

// SetupSuite initializes the test suite
func (suite *PoolRepositoryTestSuite) SetupSuite() {
	// Use in-memory SQLite for testing with pure Go driver
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared&_pragma=foreign_keys(1)"), &gorm.Config{})
	suite.Require().NoError(err)

	// Auto-migrate the schema
	err = db.AutoMigrate(&models.Pool{}, &models.Transaction{}, &models.LiquidityPosition{})
	suite.Require().NoError(err)

	suite.db = db
	suite.repo = NewPoolRepository(db)
}

// SetupTest runs before each test
func (suite *PoolRepositoryTestSuite) SetupTest() {
	// Clean up database before each test
	suite.db.Exec("DELETE FROM pools")
}

// TearDownSuite cleans up after all tests
func (suite *PoolRepositoryTestSuite) TearDownSuite() {
	if sqlDB, err := suite.db.DB(); err == nil {
		sqlDB.Close()
	}
}

// TestCreatePool tests pool creation
func (suite *PoolRepositoryTestSuite) TestCreatePool() {
	pool := &models.Pool{
		PoolID:    "pool-1",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  true,
	}

	err := suite.repo.Create(pool)
	suite.NoError(err)
	suite.NotZero(pool.ID)
	suite.NotZero(pool.CreatedAt)
}

// TestCreatePoolNil tests creating nil pool
func (suite *PoolRepositoryTestSuite) TestCreatePoolNil() {
	err := suite.repo.Create(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "pool cannot be nil")
}

// TestCreatePoolSameTokens tests creating pool with same tokens
func (suite *PoolRepositoryTestSuite) TestCreatePoolSameTokens() {
	pool := &models.Pool{
		PoolID:    "pool-1",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x1111111111111111111111111111111111111111", // Same as Token0
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  true,
	}

	err := suite.repo.Create(pool)
	suite.Error(err)
	suite.Contains(err.Error(), "Token0 and Token1 cannot be the same")
}

// TestGetPoolByID tests retrieving pool by ID
func (suite *PoolRepositoryTestSuite) TestGetPoolByID() {
	// Create test pool
	originalPool := &models.Pool{
		PoolID:    "pool-1",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  true,
	}
	err := suite.repo.Create(originalPool)
	suite.NoError(err)

	// Retrieve pool
	pool, err := suite.repo.GetByID(originalPool.ID)
	suite.NoError(err)
	suite.NotNil(pool)
	suite.Equal(originalPool.PoolID, pool.PoolID)
	suite.Equal(originalPool.Token0, pool.Token0)
	suite.Equal(originalPool.Token1, pool.Token1)
}

// TestGetPoolByIDNotFound tests retrieving non-existent pool
func (suite *PoolRepositoryTestSuite) TestGetPoolByIDNotFound() {
	pool, err := suite.repo.GetByID(999)
	suite.NoError(err)
	suite.Nil(pool)
}

// TestGetPoolByIDZero tests retrieving pool with zero ID
func (suite *PoolRepositoryTestSuite) TestGetPoolByIDZero() {
	pool, err := suite.repo.GetByID(0)
	suite.Error(err)
	suite.Nil(pool)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestGetPoolByPoolID tests retrieving pool by pool ID
func (suite *PoolRepositoryTestSuite) TestGetPoolByPoolID() {
	// Create test pool
	originalPool := &models.Pool{
		PoolID:    "pool-1",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  true,
	}
	err := suite.repo.Create(originalPool)
	suite.NoError(err)

	// Retrieve pool
	pool, err := suite.repo.GetByPoolID("pool-1")
	suite.NoError(err)
	suite.NotNil(pool)
	suite.Equal(originalPool.PoolID, pool.PoolID)
}

// TestGetPoolByPoolIDNotFound tests retrieving non-existent pool by pool ID
func (suite *PoolRepositoryTestSuite) TestGetPoolByPoolIDNotFound() {
	pool, err := suite.repo.GetByPoolID("non-existent")
	suite.NoError(err)
	suite.Nil(pool)
}

// TestGetPoolByPoolIDEmpty tests retrieving pool with empty pool ID
func (suite *PoolRepositoryTestSuite) TestGetPoolByPoolIDEmpty() {
	pool, err := suite.repo.GetByPoolID("")
	suite.Error(err)
	suite.Nil(pool)
	suite.Contains(err.Error(), "poolID cannot be empty")
}

// TestGetPoolByTokens tests retrieving pool by token addresses
func (suite *PoolRepositoryTestSuite) TestGetPoolByTokens() {
	// Create test pool
	originalPool := &models.Pool{
		PoolID:    "pool-1",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  true,
	}
	err := suite.repo.Create(originalPool)
	suite.NoError(err)

	// Retrieve pool by tokens (order 1)
	pool, err := suite.repo.GetByTokens(
		"0x1111111111111111111111111111111111111111",
		"0x2222222222222222222222222222222222222222",
	)
	suite.NoError(err)
	suite.NotNil(pool)
	suite.Equal(originalPool.PoolID, pool.PoolID)

	// Retrieve pool by tokens (order 2 - reversed)
	pool, err = suite.repo.GetByTokens(
		"0x2222222222222222222222222222222222222222",
		"0x1111111111111111111111111111111111111111",
	)
	suite.NoError(err)
	suite.NotNil(pool)
	suite.Equal(originalPool.PoolID, pool.PoolID)
}

// TestGetPoolByTokensNotFound tests retrieving non-existent pool by tokens
func (suite *PoolRepositoryTestSuite) TestGetPoolByTokensNotFound() {
	pool, err := suite.repo.GetByTokens(
		"0x1111111111111111111111111111111111111111",
		"0x3333333333333333333333333333333333333333",
	)
	suite.NoError(err)
	suite.Nil(pool)
}

// TestGetPoolByTokensEmptyParams tests retrieving pool with empty token addresses
func (suite *PoolRepositoryTestSuite) TestGetPoolByTokensEmptyParams() {
	pool, err := suite.repo.GetByTokens("", "0x2222222222222222222222222222222222222222")
	suite.Error(err)
	suite.Nil(pool)
	suite.Contains(err.Error(), "token addresses cannot be empty")

	pool, err = suite.repo.GetByTokens("0x1111111111111111111111111111111111111111", "")
	suite.Error(err)
	suite.Nil(pool)
	suite.Contains(err.Error(), "token addresses cannot be empty")
}

// TestUpdatePool tests updating pool
func (suite *PoolRepositoryTestSuite) TestUpdatePool() {
	// Create test pool
	pool := &models.Pool{
		PoolID:    "pool-1",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  true,
	}
	err := suite.repo.Create(pool)
	suite.NoError(err)

	// Update pool
	pool.Liquidity = decimal.NewFromInt(2000000)
	pool.TVL = decimal.NewFromInt(2000000)
	pool.IsActive = false
	err = suite.repo.Update(pool)
	suite.NoError(err)

	// Verify update
	updatedPool, err := suite.repo.GetByID(pool.ID)
	suite.NoError(err)
	suite.True(updatedPool.Liquidity.Equal(decimal.NewFromInt(2000000)))
	suite.True(updatedPool.TVL.Equal(decimal.NewFromInt(2000000)))
	suite.False(updatedPool.IsActive)
}

// TestUpdatePoolNil tests updating nil pool
func (suite *PoolRepositoryTestSuite) TestUpdatePoolNil() {
	err := suite.repo.Update(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "pool cannot be nil")
}

// TestDeletePool tests deleting pool
func (suite *PoolRepositoryTestSuite) TestDeletePool() {
	// Create test pool
	pool := &models.Pool{
		PoolID:    "pool-1",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  true,
	}
	err := suite.repo.Create(pool)
	suite.NoError(err)

	// Delete pool
	err = suite.repo.Delete(pool.ID)
	suite.NoError(err)

	// Verify deletion (soft delete)
	deletedPool, err := suite.repo.GetByID(pool.ID)
	suite.NoError(err)
	suite.Nil(deletedPool) // Should be nil due to soft delete
}

// TestDeletePoolZeroID tests deleting pool with zero ID
func (suite *PoolRepositoryTestSuite) TestDeletePoolZeroID() {
	err := suite.repo.Delete(0)
	suite.Error(err)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestListPools tests listing pools with pagination
func (suite *PoolRepositoryTestSuite) TestListPools() {
	// Create multiple test pools
	for i := 0; i < 5; i++ {
		pool := &models.Pool{
			PoolID:    fmt.Sprintf("pool-%d", i),
			Token0:    fmt.Sprintf("0x%040d", i),
			Token1:    fmt.Sprintf("0x%040d", i+1000),
			FeeRate:   decimal.NewFromFloat(0.003),
			Liquidity: decimal.NewFromInt(1000000),
			Reserve0:  decimal.NewFromInt(500000),
			Reserve1:  decimal.NewFromInt(500000),
			Volume24h: decimal.NewFromInt(100000),
			TVL:       decimal.NewFromInt(1000000),
			IsActive:  true,
		}
		err := suite.repo.Create(pool)
		suite.NoError(err)
	}

	// Test pagination
	pools, err := suite.repo.List(3, 0)
	suite.NoError(err)
	suite.Len(pools, 3)

	// Test offset
	pools, err = suite.repo.List(3, 2)
	suite.NoError(err)
	suite.Len(pools, 3)
}

// TestGetActivePools tests retrieving active pools
func (suite *PoolRepositoryTestSuite) TestGetActivePools() {
	// Create active and inactive pools
	activePool := &models.Pool{
		PoolID:    "active-pool",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  true,
	}
	inactivePool := &models.Pool{
		PoolID:    "inactive-pool",
		Token0:    "0x3333333333333333333333333333333333333333",
		Token1:    "0x4444444444444444444444444444444444444444",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  false,
	}

	err := suite.repo.Create(activePool)
	suite.NoError(err)
	err = suite.repo.Create(inactivePool)
	suite.NoError(err)

	// Get active pools
	activePools, err := suite.repo.GetActivePools()
	suite.NoError(err)
	suite.Len(activePools, 1)
	suite.Equal(activePool.PoolID, activePools[0].PoolID)
}

// TestUpdateLiquidity tests updating pool liquidity
func (suite *PoolRepositoryTestSuite) TestUpdateLiquidity() {
	// Create test pool
	pool := &models.Pool{
		PoolID:    "pool-1",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  true,
	}
	err := suite.repo.Create(pool)
	suite.NoError(err)

	// Update liquidity
	newLiquidity := decimal.NewFromInt(2000000)
	err = suite.repo.UpdateLiquidity(pool.PoolID, newLiquidity)
	suite.NoError(err)

	// Verify update
	updatedPool, err := suite.repo.GetByID(pool.ID)
	suite.NoError(err)
	suite.True(updatedPool.Liquidity.Equal(newLiquidity))
}

// TestUpdateLiquidityEmptyPoolID tests updating liquidity with empty pool ID
func (suite *PoolRepositoryTestSuite) TestUpdateLiquidityEmptyPoolID() {
	err := suite.repo.UpdateLiquidity("", decimal.NewFromInt(1000000))
	suite.Error(err)
	suite.Contains(err.Error(), "poolID cannot be empty")
}

// TestUpdateReserves tests updating pool reserves
func (suite *PoolRepositoryTestSuite) TestUpdateReserves() {
	// Create test pool
	pool := &models.Pool{
		PoolID:    "pool-1",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromInt(1000000),
		Reserve0:  decimal.NewFromInt(500000),
		Reserve1:  decimal.NewFromInt(500000),
		Volume24h: decimal.NewFromInt(100000),
		TVL:       decimal.NewFromInt(1000000),
		IsActive:  true,
	}
	err := suite.repo.Create(pool)
	suite.NoError(err)

	// Update reserves
	newReserve0 := decimal.NewFromInt(750000)
	newReserve1 := decimal.NewFromInt(250000)
	err = suite.repo.UpdateReserves(pool.PoolID, newReserve0, newReserve1)
	suite.NoError(err)

	// Verify update
	updatedPool, err := suite.repo.GetByID(pool.ID)
	suite.NoError(err)
	suite.True(updatedPool.Reserve0.Equal(newReserve0))
	suite.True(updatedPool.Reserve1.Equal(newReserve1))
}

// TestUpdateReservesEmptyPoolID tests updating reserves with empty pool ID
func (suite *PoolRepositoryTestSuite) TestUpdateReservesEmptyPoolID() {
	err := suite.repo.UpdateReserves("", decimal.NewFromInt(500000), decimal.NewFromInt(500000))
	suite.Error(err)
	suite.Contains(err.Error(), "poolID cannot be empty")
}

// TestGetTopPoolsByTVL tests retrieving top pools by TVL
func (suite *PoolRepositoryTestSuite) TestGetTopPoolsByTVL() {
	// Create pools with different TVL values
	pools := []*models.Pool{
		{
			PoolID:    "pool-1",
			Token0:    "0x1111111111111111111111111111111111111111",
			Token1:    "0x2222222222222222222222222222222222222222",
			FeeRate:   decimal.NewFromFloat(0.003),
			Liquidity: decimal.NewFromInt(1000000),
			Reserve0:  decimal.NewFromInt(500000),
			Reserve1:  decimal.NewFromInt(500000),
			Volume24h: decimal.NewFromInt(100000),
			TVL:       decimal.NewFromInt(3000000), // Highest TVL
			IsActive:  true,
		},
		{
			PoolID:    "pool-2",
			Token0:    "0x3333333333333333333333333333333333333333",
			Token1:    "0x4444444444444444444444444444444444444444",
			FeeRate:   decimal.NewFromFloat(0.003),
			Liquidity: decimal.NewFromInt(1000000),
			Reserve0:  decimal.NewFromInt(500000),
			Reserve1:  decimal.NewFromInt(500000),
			Volume24h: decimal.NewFromInt(100000),
			TVL:       decimal.NewFromInt(1000000), // Lowest TVL
			IsActive:  true,
		},
		{
			PoolID:    "pool-3",
			Token0:    "0x5555555555555555555555555555555555555555",
			Token1:    "0x6666666666666666666666666666666666666666",
			FeeRate:   decimal.NewFromFloat(0.003),
			Liquidity: decimal.NewFromInt(1000000),
			Reserve0:  decimal.NewFromInt(500000),
			Reserve1:  decimal.NewFromInt(500000),
			Volume24h: decimal.NewFromInt(100000),
			TVL:       decimal.NewFromInt(2000000), // Middle TVL
			IsActive:  true,
		},
	}

	for _, pool := range pools {
		err := suite.repo.Create(pool)
		suite.NoError(err)
	}

	// Get top pools by TVL
	topPools, err := suite.repo.GetTopPoolsByTVL(2)
	suite.NoError(err)
	suite.Len(topPools, 2)

	// Verify order (highest TVL first)
	suite.Equal("pool-1", topPools[0].PoolID)
	suite.Equal("pool-3", topPools[1].PoolID)
}

// TestGetPoolsByToken tests retrieving pools by token address
func (suite *PoolRepositoryTestSuite) TestGetPoolsByToken() {
	// Create pools with shared token
	sharedToken := "0x1111111111111111111111111111111111111111"
	pools := []*models.Pool{
		{
			PoolID:    "pool-1",
			Token0:    sharedToken,
			Token1:    "0x2222222222222222222222222222222222222222",
			FeeRate:   decimal.NewFromFloat(0.003),
			Liquidity: decimal.NewFromInt(1000000),
			Reserve0:  decimal.NewFromInt(500000),
			Reserve1:  decimal.NewFromInt(500000),
			Volume24h: decimal.NewFromInt(100000),
			TVL:       decimal.NewFromInt(1000000),
			IsActive:  true,
		},
		{
			PoolID:    "pool-2",
			Token0:    "0x3333333333333333333333333333333333333333",
			Token1:    sharedToken,
			FeeRate:   decimal.NewFromFloat(0.003),
			Liquidity: decimal.NewFromInt(1000000),
			Reserve0:  decimal.NewFromInt(500000),
			Reserve1:  decimal.NewFromInt(500000),
			Volume24h: decimal.NewFromInt(100000),
			TVL:       decimal.NewFromInt(1000000),
			IsActive:  true,
		},
		{
			PoolID:    "pool-3",
			Token0:    "0x4444444444444444444444444444444444444444",
			Token1:    "0x5555555555555555555555555555555555555555",
			FeeRate:   decimal.NewFromFloat(0.003),
			Liquidity: decimal.NewFromInt(1000000),
			Reserve0:  decimal.NewFromInt(500000),
			Reserve1:  decimal.NewFromInt(500000),
			Volume24h: decimal.NewFromInt(100000),
			TVL:       decimal.NewFromInt(1000000),
			IsActive:  true,
		},
	}

	for _, pool := range pools {
		err := suite.repo.Create(pool)
		suite.NoError(err)
	}

	// Get pools by token
	tokenPools, err := suite.repo.GetPoolsByToken(sharedToken)
	suite.NoError(err)
	suite.Len(tokenPools, 2)

	// Verify pools contain the shared token
	for _, pool := range tokenPools {
		suite.True(pool.Token0 == sharedToken || pool.Token1 == sharedToken)
	}
}

// TestGetPoolsByTokenEmpty tests retrieving pools with empty token address
func (suite *PoolRepositoryTestSuite) TestGetPoolsByTokenEmpty() {
	pools, err := suite.repo.GetPoolsByToken("")
	suite.Error(err)
	suite.Nil(pools)
	suite.Contains(err.Error(), "token address cannot be empty")
}

// TestPoolRepositoryTestSuite runs the test suite
func TestPoolRepositoryTestSuite(t *testing.T) {
	suite.Run(t, new(PoolRepositoryTestSuite))
}
