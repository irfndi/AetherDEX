package repository

import (
	"fmt"
	"testing"
	"time"

	"github.com/irfndi/AetherDEX/apps/api/internal/liquidity"
	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/irfndi/AetherDEX/apps/api/internal/pool"
	"github.com/irfndi/AetherDEX/apps/api/internal/token"
	"github.com/irfndi/AetherDEX/apps/api/internal/transaction"
	"github.com/irfndi/AetherDEX/apps/api/internal/user"
	"github.com/lib/pq"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/suite"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

func boolPtr(b bool) *bool {
	return &b
}

// ComprehensiveDatabaseTestSuite provides comprehensive database operation tests
type ComprehensiveDatabaseTestSuite struct {
	suite.Suite
	db              *gorm.DB
	userRepo        user.UserRepository
	transactionRepo transaction.TransactionRepository
	poolRepo        pool.PoolRepository
	tokenRepo       token.TokenRepository
	liquidityRepo   liquidity.LiquidityPositionRepository
}

// SetupSuite initializes the test suite with all repositories
func (suite *ComprehensiveDatabaseTestSuite) SetupSuite() {
	// Use in-memory SQLite for testing with pure Go driver
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared&_pragma=foreign_keys(1)"), &gorm.Config{})
	suite.Require().NoError(err)

	// Auto-migrate all models
	err = db.AutoMigrate(
		&models.User{},
		&models.Transaction{},
		&models.Pool{},
		&models.Token{},
		&models.LiquidityPosition{},
	)
	suite.Require().NoError(err)

	suite.db = db
	suite.userRepo = user.NewUserRepository(db)
	suite.transactionRepo = transaction.NewTransactionRepository(db)
	suite.poolRepo = pool.NewPoolRepository(db)
	suite.tokenRepo = token.NewTokenRepository(db)
	suite.liquidityRepo = liquidity.NewLiquidityPositionRepository(db)
}

// SetupTest runs before each test
func (suite *ComprehensiveDatabaseTestSuite) SetupTest() {
	// Clean up all tables before each test
	suite.db.Exec("DELETE FROM liquidity_positions")
	suite.db.Exec("DELETE FROM transactions")
	suite.db.Exec("DELETE FROM pools")
	suite.db.Exec("DELETE FROM tokens")
	suite.db.Exec("DELETE FROM users")
}

// TearDownSuite cleans up after all tests
func (suite *ComprehensiveDatabaseTestSuite) TearDownSuite() {
	if sqlDB, err := suite.db.DB(); err == nil {
		sqlDB.Close()
	}
}

// TestUserManagementOperations tests comprehensive user management
func (suite *ComprehensiveDatabaseTestSuite) TestUserManagementOperations() {
	// Test user creation
	u := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce-123",
		Roles:    pq.StringArray{"user", "trader"},
		IsActive: boolPtr(true),
	}

	err := suite.userRepo.Create(u)
	suite.NoError(err)
	suite.NotZero(u.ID)
	suite.NotZero(u.CreatedAt)

	// Test user retrieval by address
	retrievedUser, err := suite.userRepo.GetByAddress(u.Address)
	suite.NoError(err)
	suite.NotNil(retrievedUser)
	suite.Equal(u.Address, retrievedUser.Address)
	suite.Equal(u.Nonce, retrievedUser.Nonce)

	// Test user update
	u.Nonce = "updated-nonce-456"
	u.Roles = pq.StringArray{"user", "trader", "admin"}
	err = suite.userRepo.Update(u)
	suite.NoError(err)

	// Verify update
	updatedUser, err := suite.userRepo.GetByID(u.ID)
	suite.NoError(err)
	suite.Equal("updated-nonce-456", updatedUser.Nonce)
	suite.Contains(updatedUser.Roles, "admin")

	// Test user deactivation
	u.IsActive = boolPtr(false)
	err = suite.userRepo.Update(u)
	suite.NoError(err)

	updatedUser, err = suite.userRepo.GetByID(u.ID)
	suite.NoError(err)
	suite.False(*updatedUser.IsActive)
}

// TestTokenManagementOperations tests comprehensive token management
func (suite *ComprehensiveDatabaseTestSuite) TestTokenManagementOperations() {
	// Create test tokens
	token1 := &models.Token{
		Address:  "0x1111111111111111111111111111111111111111",
		Symbol:   "ETH",
		Name:     "Ethereum",
		Decimals: 18,
		IsActive: boolPtr(true),
	}

	token2 := &models.Token{
		Address:  "0x2222222222222222222222222222222222222222",
		Symbol:   "USDC",
		Name:     "USD Coin",
		Decimals: 6,
		IsActive: boolPtr(true),
	}

	err := suite.tokenRepo.Create(token1)
	suite.NoError(err)
	err = suite.tokenRepo.Create(token2)
	suite.NoError(err)

	// Test token retrieval
	retrievedToken, err := suite.tokenRepo.GetByAddress(token1.Address)
	suite.NoError(err)
	suite.NotNil(retrievedToken)
	suite.Equal(token1.Symbol, retrievedToken.Symbol)

	// Test getting all active tokens
	activeTokens, err := suite.tokenRepo.GetActiveTokens(10, 0)
	suite.NoError(err)
	suite.Len(activeTokens, 2)

	// Test token deactivation
	token1.IsActive = boolPtr(false)
	err = suite.tokenRepo.Update(token1)
	suite.NoError(err)

	activeTokens, err = suite.tokenRepo.GetActiveTokens(10, 0)
	suite.NoError(err)
	suite.Len(activeTokens, 1)
	suite.Equal("USDC", activeTokens[0].Symbol)
}

// TestPoolManagementOperations tests comprehensive pool management
func (suite *ComprehensiveDatabaseTestSuite) TestPoolManagementOperations() {
	// Create test tokens first
	token1 := &models.Token{
		Address:  "0x1111111111111111111111111111111111111111",
		Symbol:   "ETH",
		Name:     "Ethereum",
		Decimals: 18,
		IsActive: boolPtr(true),
	}
	token2 := &models.Token{
		Address:  "0x2222222222222222222222222222222222222222",
		Symbol:   "USDC",
		Name:     "USD Coin",
		Decimals: 6,
		IsActive: boolPtr(true),
	}

	err := suite.tokenRepo.Create(token1)
	suite.NoError(err)
	err = suite.tokenRepo.Create(token2)
	suite.NoError(err)

	// Create test pool
	p := &models.Pool{
		PoolID:    "eth-usdc-pool",
		Token0:    token1.Address,
		Token1:    token2.Address,
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromFloat(1000000.0),
		Reserve0:  decimal.NewFromFloat(500.0),
		Reserve1:  decimal.NewFromFloat(1000000.0),
		IsActive:  boolPtr(true),
	}

	err = suite.poolRepo.Create(p)
	suite.NoError(err)
	suite.NotZero(p.ID)

	// Test pool retrieval
	retrievedPool, err := suite.poolRepo.GetByPoolID(p.PoolID)
	suite.NoError(err)
	suite.NotNil(retrievedPool)
	suite.Equal(p.Token0, retrievedPool.Token0)
	suite.Equal(p.Token1, retrievedPool.Token1)

	// Test pool update (liquidity change)
	p.Liquidity = decimal.NewFromFloat(1500000.0)
	p.Reserve0 = decimal.NewFromFloat(750.0)
	p.Reserve1 = decimal.NewFromFloat(1500000.0)
	err = suite.poolRepo.Update(p)
	suite.NoError(err)

	updatedPool, err := suite.poolRepo.GetByPoolID(p.PoolID)
	suite.NoError(err)
	suite.True(updatedPool.Liquidity.Equal(decimal.NewFromFloat(1500000.0)))

	// Test getting active pools
	activePools, err := suite.poolRepo.GetActivePools()
	suite.NoError(err)
	suite.Len(activePools, 1)
}

// TestTransactionLoggingOperations tests comprehensive transaction logging
func (suite *ComprehensiveDatabaseTestSuite) TestTransactionLoggingOperations() {
	// Create test user
	u := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    pq.StringArray{"user", "trader"},
		IsActive: boolPtr(true),
	}
	err := suite.userRepo.Create(u)
	suite.NoError(err)

	// Create test pool
	p := &models.Pool{
		PoolID:    "test-pool",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromFloat(1000000.0),
		Reserve0:  decimal.NewFromFloat(500.0),
		Reserve1:  decimal.NewFromFloat(1000000.0),
		IsActive:  boolPtr(true),
	}
	err = suite.poolRepo.Create(p)
	suite.NoError(err)

	// Create multiple transactions
	transactions := []*models.Transaction{
		{
			TxHash:      "0x1111111111111111111111111111111111111111111111111111111111111111",
			UserAddress: u.Address,
			PoolID:      p.PoolID,
			Type:        models.TransactionTypeSwap,
			Status:      models.TransactionStatusConfirmed,
			TokenIn:     p.Token0,
			TokenOut:    p.Token1,
			AmountIn:    decimal.NewFromFloat(1.0),
			AmountOut:   decimal.NewFromFloat(2000.0),
			GasUsed:     21000,
			GasPrice:    decimal.NewFromInt(20000000000),
			BlockNumber: 12345,
		},
		{
			TxHash:      "0x2222222222222222222222222222222222222222222222222222222222222222",
			UserAddress: u.Address,
			PoolID:      p.PoolID,
			Type:        models.TransactionTypeAddLiquidity,
			Status:      models.TransactionStatusPending,
			TokenIn:     p.Token0,
			TokenOut:    p.Token1,
			AmountIn:    decimal.NewFromFloat(2.0),
			AmountOut:   decimal.NewFromFloat(4000.0),
			GasUsed:     45000,
			GasPrice:    decimal.NewFromInt(25000000000),
			BlockNumber: 12346,
		},
	}

	// Create transactions
	for _, tx := range transactions {
		err := suite.transactionRepo.Create(tx)
		suite.NoError(err)
		suite.NotZero(tx.ID)
	}

	// Test getting transactions by user
	userTransactions, err := suite.transactionRepo.GetByUserAddress(u.Address, 10, 0)
	suite.NoError(err)
	suite.Len(userTransactions, 2)

	// Test getting transactions by pool
	poolTransactions, err := suite.transactionRepo.GetByPoolID(p.PoolID, 10, 0)
	suite.NoError(err)
	suite.Len(poolTransactions, 2)

	// Test transaction status update
	transactions[1].Status = models.TransactionStatusConfirmed
	err = suite.transactionRepo.Update(transactions[1])
	suite.NoError(err)

	updatedTx, err := suite.transactionRepo.GetByTxHash(transactions[1].TxHash)
	suite.NoError(err)
	suite.Equal(models.TransactionStatusConfirmed, updatedTx.Status)
}

// TestLiquidityPositionOperations tests liquidity position management
func (suite *ComprehensiveDatabaseTestSuite) TestLiquidityPositionOperations() {
	// Create test user
	u := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    pq.StringArray{"user", "trader"},
		IsActive: boolPtr(true),
	}
	err := suite.userRepo.Create(u)
	suite.NoError(err)

	// Create test pool
	p := &models.Pool{
		PoolID:    "test-pool",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromFloat(1000000.0),
		Reserve0:  decimal.NewFromFloat(500.0),
		Reserve1:  decimal.NewFromFloat(1000000.0),
		IsActive:  boolPtr(true),
	}
	err = suite.poolRepo.Create(p)
	suite.NoError(err)

	// Create liquidity position
	position := &models.LiquidityPosition{
		UserAddress: u.Address,
		PoolID:      p.PoolID,
		Liquidity:   decimal.NewFromFloat(100.0),
		IsActive:    boolPtr(true),
	}

	err = suite.liquidityRepo.Create(position)
	suite.NoError(err)
	suite.NotZero(position.ID)

	// Test getting positions by user
	userPositions, err := suite.liquidityRepo.GetByUser(u.Address, 10, 0)
	suite.NoError(err)
	suite.Len(userPositions, 1)
	suite.Equal(p.PoolID, userPositions[0].PoolID)

	// Test getting positions by pool
	poolPositions, err := suite.liquidityRepo.GetByPool(p.PoolID, 10, 0)
	suite.NoError(err)
	suite.Len(poolPositions, 1)
	suite.Equal(u.Address, poolPositions[0].UserAddress)
}

// TestCrossRepositoryOperations tests operations across multiple repositories
func (suite *ComprehensiveDatabaseTestSuite) TestCrossRepositoryOperations() {
	// Create a complete trading scenario

	// 1. Create tokens
	eth := &models.Token{
		Address:  "0x1111111111111111111111111111111111111111",
		Symbol:   "ETH",
		Name:     "Ethereum",
		Decimals: 18,
		IsActive: boolPtr(true),
	}
	usdc := &models.Token{
		Address:  "0x2222222222222222222222222222222222222222",
		Symbol:   "USDC",
		Name:     "USD Coin",
		Decimals: 6,
		IsActive: boolPtr(true),
	}

	err := suite.tokenRepo.Create(eth)
	suite.NoError(err)
	err = suite.tokenRepo.Create(usdc)
	suite.NoError(err)

	// 2. Create users
	trader1 := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "trader1-nonce",
		Roles:    pq.StringArray{"user", "trader"},
		IsActive: boolPtr(true),
	}
	trader2 := &models.User{
		Address:  "0x9876543210987654321098765432109876543210",
		Nonce:    "trader2-nonce",
		Roles:    pq.StringArray{"user", "trader"},
		IsActive: boolPtr(true),
	}

	err = suite.userRepo.Create(trader1)
	suite.NoError(err)
	err = suite.userRepo.Create(trader2)
	suite.NoError(err)

	// 3. Create pool
	p := &models.Pool{
		PoolID:    "eth-usdc-pool",
		Token0:    eth.Address,
		Token1:    usdc.Address,
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromFloat(1000000.0),
		Reserve0:  decimal.NewFromFloat(500.0),
		Reserve1:  decimal.NewFromFloat(1000000.0),
		IsActive:  boolPtr(true),
	}

	err = suite.poolRepo.Create(p)
	suite.NoError(err)

	// 4. Create liquidity positions
	position1 := &models.LiquidityPosition{
		UserAddress: trader1.Address,
		PoolID:      p.PoolID,
		Liquidity:   decimal.NewFromFloat(100.0),
		IsActive:    boolPtr(true),
	}
	position2 := &models.LiquidityPosition{
		UserAddress: trader2.Address,
		PoolID:      p.PoolID,
		Liquidity:   decimal.NewFromFloat(100.0),
		IsActive:    boolPtr(true),
	}

	err = suite.liquidityRepo.Create(position1)
	suite.NoError(err)
	err = suite.liquidityRepo.Create(position2)
	suite.NoError(err)

	// 5. Create transactions
	swapTx := &models.Transaction{
		TxHash:      "0x1111111111111111111111111111111111111111111111111111111111111111",
		UserAddress: trader1.Address,
		PoolID:      p.PoolID,
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusConfirmed,
		TokenIn:     eth.Address,
		TokenOut:    usdc.Address,
		AmountIn:    decimal.NewFromFloat(1.0),
		AmountOut:   decimal.NewFromFloat(2000.0),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12345,
	}

	liquidityTx := &models.Transaction{
		TxHash:      "0x2222222222222222222222222222222222222222222222222222222222222222",
		UserAddress: trader2.Address,
		PoolID:      p.PoolID,
		Type:        models.TransactionTypeAddLiquidity,
		Status:      models.TransactionStatusConfirmed,
		TokenIn:     eth.Address,
		TokenOut:    usdc.Address,
		AmountIn:    decimal.NewFromFloat(2.0),
		AmountOut:   decimal.NewFromFloat(4000.0),
		GasUsed:     45000,
		GasPrice:    decimal.NewFromInt(25000000000),
		BlockNumber: 12346,
	}

	err = suite.transactionRepo.Create(swapTx)
	suite.NoError(err)
	err = suite.transactionRepo.Create(liquidityTx)
	suite.NoError(err)

	// 6. Verify cross-repository queries

	// Get all transactions for the pool
	poolTransactions, err := suite.transactionRepo.GetByPoolID(p.PoolID, 10, 0)
	suite.NoError(err)
	suite.Len(poolTransactions, 2)

	// Get all positions for the pool
	poolPositions, err := suite.liquidityRepo.GetByPool(p.PoolID, 10, 0)
	suite.NoError(err)
	suite.Len(poolPositions, 2)

	// Get trader1's transactions
	trader1Transactions, err := suite.transactionRepo.GetByUserAddress(trader1.Address, 10, 0)
	suite.NoError(err)
	suite.Len(trader1Transactions, 1)
	suite.Equal(models.TransactionTypeSwap, trader1Transactions[0].Type)

	// Get trader2's positions
	trader2Positions, err := suite.liquidityRepo.GetByUser(trader2.Address, 10, 0)
	suite.NoError(err)
	suite.Len(trader2Positions, 1)
	suite.Equal(p.PoolID, trader2Positions[0].PoolID)
}

// TestDatabaseErrorHandling tests error handling across repositories
func (suite *ComprehensiveDatabaseTestSuite) TestDatabaseErrorHandling() {
	// Test nil parameter handling
	err := suite.userRepo.Create(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "user cannot be nil")

	err = suite.transactionRepo.Create(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "transaction cannot be nil")

	err = suite.poolRepo.Create(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "pool cannot be nil")

	// Test empty parameter handling
	_, err = suite.userRepo.GetByAddress("")
	suite.Error(err)
	suite.Contains(err.Error(), "address cannot be empty")

	_, err = suite.transactionRepo.GetByTxHash("")
	suite.Error(err)
	suite.Contains(err.Error(), "txHash cannot be empty")

	_, err = suite.poolRepo.GetByPoolID("")
	suite.Error(err)
	suite.Contains(err.Error(), "poolID cannot be empty")

	// Test invalid ID handling
	_, err = suite.userRepo.GetByID(0)
	suite.Error(err)
	suite.Contains(err.Error(), "id cannot be zero")

	_, err = suite.transactionRepo.GetByID(0)
	suite.Error(err)

	_, err = suite.poolRepo.GetByID(0)
	suite.Error(err)
}

// TestDatabasePerformance tests database performance with bulk operations
func (suite *ComprehensiveDatabaseTestSuite) TestDatabasePerformance() {
	start := time.Now()

	// Create multiple users in bulk
	for i := 0; i < 100; i++ {
		u := &models.User{
			Address:  fmt.Sprintf("0x%040d", i),
			Nonce:    fmt.Sprintf("nonce-%d", i),
			Roles:    pq.StringArray{"user"},
			IsActive: boolPtr(true),
		}
		err := suite.userRepo.Create(u)
		suite.NoError(err)
	}

	userCreationTime := time.Since(start)
	suite.T().Logf("Created 100 users in %v", userCreationTime)

	// Test bulk retrieval performance
	start = time.Now()
	for i := 0; i < 100; i++ {
		address := fmt.Sprintf("0x%040d", i)
		retrievedUser, err := suite.userRepo.GetByAddress(address)
		suite.NoError(err)
		suite.NotNil(retrievedUser)
	}
	userRetrievalTime := time.Since(start)
	suite.T().Logf("Retrieved 100 users in %v", userRetrievalTime)

	// Performance should be reasonable (less than 1 second for 100 operations)
	suite.Less(userCreationTime, time.Second)
	suite.Less(userRetrievalTime, time.Second)
}

// TestDatabaseTransactionIntegrity tests database transaction integrity
func (suite *ComprehensiveDatabaseTestSuite) TestDatabaseTransactionIntegrity() {
	// Test that database operations maintain referential integrity

	// Create user and pool
	u := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    pq.StringArray{"user"},
		IsActive: boolPtr(true),
	}
	err := suite.userRepo.Create(u)
	suite.NoError(err)

	p := &models.Pool{
		PoolID:    "test-pool",
		Token0:    "0x1111111111111111111111111111111111111111",
		Token1:    "0x2222222222222222222222222222222222222222",
		FeeRate:   decimal.NewFromFloat(0.003),
		Liquidity: decimal.NewFromFloat(1000000.0),
		Reserve0:  decimal.NewFromFloat(500.0),
		Reserve1:  decimal.NewFromFloat(1000000.0),
		IsActive:  boolPtr(true),
	}
	err = suite.poolRepo.Create(p)
	suite.NoError(err)

	// Create transaction referencing user and pool
	tx := &models.Transaction{
		TxHash:      "0x1111111111111111111111111111111111111111111111111111111111111111",
		UserAddress: u.Address,
		PoolID:      p.PoolID,
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusConfirmed,
		TokenIn:     p.Token0,
		TokenOut:    p.Token1,
		AmountIn:    decimal.NewFromFloat(1.0),
		AmountOut:   decimal.NewFromFloat(2000.0),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12345,
	}

	err = suite.transactionRepo.Create(tx)
	suite.NoError(err)

	// Verify that transaction references are maintained
	retrievedTx, err := suite.transactionRepo.GetByTxHash(tx.TxHash)
	suite.NoError(err)
	suite.Equal(u.Address, retrievedTx.UserAddress)
	suite.Equal(p.PoolID, retrievedTx.PoolID)

	// Verify that related data can be queried
	userTransactions, err := suite.transactionRepo.GetByUserAddress(u.Address, 10, 0)
	suite.NoError(err)
	suite.Len(userTransactions, 1)

	poolTransactions, err := suite.transactionRepo.GetByPoolID(p.PoolID, 10, 0)
	suite.NoError(err)
	suite.Len(poolTransactions, 1)
}

// TestComprehensiveDatabaseOperations runs the comprehensive database test suite
func TestComprehensiveDatabaseOperations(t *testing.T) {
	suite.Run(t, new(ComprehensiveDatabaseTestSuite))
}
