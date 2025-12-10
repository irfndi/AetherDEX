package repository

import (
	"fmt"
	"testing"
	"time"

	"github.com/irfndi/AetherDEX/backend/internal/models"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/suite"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

// TransactionRepositoryTestSuite provides comprehensive tests for transaction repository
type TransactionRepositoryTestSuite struct {
	suite.Suite
	db   *gorm.DB
	repo TransactionRepository
}

// SetupSuite initializes the test suite
func (suite *TransactionRepositoryTestSuite) SetupSuite() {
	// Use in-memory SQLite for testing with pure Go driver
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared&_pragma=foreign_keys(1)"), &gorm.Config{})
	suite.Require().NoError(err)

	// Auto-migrate the schema
	err = db.AutoMigrate(&models.Transaction{}, &models.User{}, &models.Pool{})
	suite.Require().NoError(err)

	suite.db = db
	suite.repo = NewTransactionRepository(db)
}

// SetupTest runs before each test
func (suite *TransactionRepositoryTestSuite) SetupTest() {
	// Clean up database before each test
	suite.db.Exec("DELETE FROM transactions")
}

// TearDownSuite cleans up after all tests
func (suite *TransactionRepositoryTestSuite) TearDownSuite() {
	if sqlDB, err := suite.db.DB(); err == nil {
		sqlDB.Close()
	}
}

// TestCreateTransaction tests transaction creation
func (suite *TransactionRepositoryTestSuite) TestCreateTransaction() {
	tx := &models.Transaction{
		TxHash:      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		UserAddress: "0x1111111111111111111111111111111111111111",
		PoolID:      "pool-1",
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusPending,
		TokenIn:     "0x2222222222222222222222222222222222222222",
		TokenOut:    "0x3333333333333333333333333333333333333333",
		AmountIn:    decimal.NewFromInt(1000),
		AmountOut:   decimal.NewFromInt(2000),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12345,
	}

	err := suite.repo.Create(tx)
	suite.NoError(err)
	suite.NotZero(tx.ID)
	suite.NotZero(tx.CreatedAt)
}

// TestCreateTransactionNil tests creating nil transaction
func (suite *TransactionRepositoryTestSuite) TestCreateTransactionNil() {
	err := suite.repo.Create(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "transaction cannot be nil")
}

// TestGetTransactionByID tests retrieving transaction by ID
func (suite *TransactionRepositoryTestSuite) TestGetTransactionByID() {
	// Create test transaction
	originalTx := &models.Transaction{
		TxHash:      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		UserAddress: "0x1111111111111111111111111111111111111111",
		PoolID:      "pool-1",
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusPending,
		TokenIn:     "0x2222222222222222222222222222222222222222",
		TokenOut:    "0x3333333333333333333333333333333333333333",
		AmountIn:    decimal.NewFromInt(1000),
		AmountOut:   decimal.NewFromInt(2000),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12345,
	}
	err := suite.repo.Create(originalTx)
	suite.NoError(err)

	// Retrieve transaction
	tx, err := suite.repo.GetByID(originalTx.ID)
	suite.NoError(err)
	suite.NotNil(tx)
	suite.Equal(originalTx.TxHash, tx.TxHash)
	suite.Equal(originalTx.UserAddress, tx.UserAddress)
	suite.Equal(originalTx.Type, tx.Type)
}

// TestGetTransactionByIDNotFound tests retrieving non-existent transaction
func (suite *TransactionRepositoryTestSuite) TestGetTransactionByIDNotFound() {
	tx, err := suite.repo.GetByID(999)
	suite.NoError(err)
	suite.Nil(tx)
}

// TestGetTransactionByIDZero tests retrieving transaction with zero ID
func (suite *TransactionRepositoryTestSuite) TestGetTransactionByIDZero() {
	tx, err := suite.repo.GetByID(0)
	suite.Error(err)
	suite.Nil(tx)
	suite.Contains(err.Error(), "txHash cannot be empty")
}

// TestGetTransactionByHash tests retrieving transaction by hash
func (suite *TransactionRepositoryTestSuite) TestGetTransactionByHash() {
	// Create test transaction
	originalTx := &models.Transaction{
		TxHash:      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		UserAddress: "0x1111111111111111111111111111111111111111",
		PoolID:      "pool-1",
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusPending,
		TokenIn:     "0x2222222222222222222222222222222222222222",
		TokenOut:    "0x3333333333333333333333333333333333333333",
		AmountIn:    decimal.NewFromInt(1000),
		AmountOut:   decimal.NewFromInt(2000),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12345,
	}
	err := suite.repo.Create(originalTx)
	suite.NoError(err)

	// Retrieve transaction
	tx, err := suite.repo.GetByTxHash("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef")
	suite.NoError(err)
	suite.NotNil(tx)
	suite.Equal(originalTx.TxHash, tx.TxHash)
}

// TestGetTransactionByHashNotFound tests retrieving non-existent transaction by hash
func (suite *TransactionRepositoryTestSuite) TestGetTransactionByHashNotFound() {
	tx, err := suite.repo.GetByTxHash("0x0000000000000000000000000000000000000000000000000000000000000000")
	suite.NoError(err)
	suite.Nil(tx)
}

// TestGetTransactionByHashEmpty tests retrieving transaction with empty hash
func (suite *TransactionRepositoryTestSuite) TestGetTransactionByHashEmpty() {
	tx, err := suite.repo.GetByTxHash("")
	suite.Error(err)
	suite.Nil(tx)
	suite.Contains(err.Error(), "txHash cannot be empty")
}

// TestGetTransactionsByUser tests retrieving transactions by user address
func (suite *TransactionRepositoryTestSuite) TestGetTransactionsByUser() {
	userAddress := "0x1111111111111111111111111111111111111111"

	// Create multiple transactions for the user
	for i := 0; i < 3; i++ {
		tx := &models.Transaction{
			TxHash:      fmt.Sprintf("0x%064d", i),
			UserAddress: userAddress,
			PoolID:      fmt.Sprintf("pool-%d", i),
			Type:        models.TransactionTypeSwap,
			Status:      models.TransactionStatusConfirmed,
			TokenIn:     "0x2222222222222222222222222222222222222222",
			TokenOut:    "0x3333333333333333333333333333333333333333",
			AmountIn:    decimal.NewFromInt(1000),
			AmountOut:   decimal.NewFromInt(2000),
			GasUsed:     21000,
			GasPrice:    decimal.NewFromInt(20000000000),
			BlockNumber: 12345 + uint64(i),
		}
		err := suite.repo.Create(tx)
		suite.NoError(err)
	}

	// Create transaction for different user
	differentUserTx := &models.Transaction{
		TxHash:      "0x9999999999999999999999999999999999999999999999999999999999999999",
		UserAddress: "0x4444444444444444444444444444444444444444",
		PoolID:      "pool-different",
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusConfirmed,
		TokenIn:     "0x2222222222222222222222222222222222222222",
		TokenOut:    "0x3333333333333333333333333333333333333333",
		AmountIn:    decimal.NewFromInt(1000),
		AmountOut:   decimal.NewFromInt(2000),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12348,
	}
	err := suite.repo.Create(differentUserTx)
	suite.NoError(err)

	// Get transactions by user
	userTxs, err := suite.repo.GetByUserAddress(userAddress, 10, 0)
	suite.NoError(err)
	suite.Len(userTxs, 3)

	// Verify all transactions belong to the user
	for _, tx := range userTxs {
		suite.Equal(userAddress, tx.UserAddress)
	}
}

// TestGetTransactionsByUserEmpty tests retrieving transactions with empty user address
func (suite *TransactionRepositoryTestSuite) TestGetTransactionsByUserEmpty() {
	txs, err := suite.repo.GetByUserAddress("", 10, 0)
	suite.Error(err)
	suite.Nil(txs)
	suite.Contains(err.Error(), "userAddress cannot be empty")
}

// TestGetTransactionsByPool tests retrieving transactions by pool ID
func (suite *TransactionRepositoryTestSuite) TestGetTransactionsByPool() {
	poolID := "pool-1"

	// Create multiple transactions for the pool
	for i := 0; i < 3; i++ {
		tx := &models.Transaction{
			TxHash:      fmt.Sprintf("0x%064d", i),
			UserAddress: fmt.Sprintf("0x%040d", i),
			PoolID:      poolID,
			Type:        models.TransactionTypeSwap,
			Status:      models.TransactionStatusConfirmed,
			TokenIn:     "0x2222222222222222222222222222222222222222",
			TokenOut:    "0x3333333333333333333333333333333333333333",
			AmountIn:    decimal.NewFromInt(1000),
			AmountOut:   decimal.NewFromInt(2000),
			GasUsed:     21000,
			GasPrice:    decimal.NewFromInt(20000000000),
			BlockNumber: 12345 + uint64(i),
		}
		err := suite.repo.Create(tx)
		suite.NoError(err)
	}

	// Get transactions by pool
	poolTxs, err := suite.repo.GetByPoolID(poolID, 10, 0)
	suite.NoError(err)
	suite.Len(poolTxs, 3)

	// Verify all transactions belong to the pool
	for _, tx := range poolTxs {
		suite.Equal(poolID, tx.PoolID)
	}
}

// TestGetTransactionsByPoolEmpty tests retrieving transactions with empty pool ID
func (suite *TransactionRepositoryTestSuite) TestGetTransactionsByPoolEmpty() {
	txs, err := suite.repo.GetByPoolID("", 10, 0)
	suite.Error(err)
	suite.Nil(txs)
	suite.Contains(err.Error(), "poolID cannot be empty")
}

// TestGetTransactionsByStatus tests retrieving transactions by status
func (suite *TransactionRepositoryTestSuite) TestGetTransactionsByStatus() {
	// Create transactions with different statuses
	statuses := []string{"pending", "confirmed", "failed"}
	for i, status := range statuses {
		for j := 0; j < 2; j++ {
			tx := &models.Transaction{
				TxHash:      fmt.Sprintf("0x%s%062d", status, j),
				UserAddress: fmt.Sprintf("0x%040d", i*10+j),
				PoolID:      fmt.Sprintf("pool-%d", i),
				Type:        models.TransactionTypeSwap,
				Status:      models.TransactionStatus(status),
				TokenIn:     "0x2222222222222222222222222222222222222222",
				TokenOut:    "0x3333333333333333333333333333333333333333",
				AmountIn:    decimal.NewFromInt(1000),
				AmountOut:   decimal.NewFromInt(2000),
				GasUsed:     21000,
				GasPrice:    decimal.NewFromInt(20000000000),
				BlockNumber: 12345 + uint64(i*10+j),
			}
			err := suite.repo.Create(tx)
			suite.NoError(err)
		}
	}

	// Get transactions by status
	confirmedTxs, err := suite.repo.GetByStatus("confirmed", 10, 0)
	suite.NoError(err)
	suite.Len(confirmedTxs, 2)

	// Verify all transactions have the correct status
	for _, tx := range confirmedTxs {
		suite.Equal("confirmed", tx.Status)
	}
}

// TestGetTransactionsByStatusEmpty tests retrieving transactions with empty status
func (suite *TransactionRepositoryTestSuite) TestGetTransactionsByStatusEmpty() {
	txs, err := suite.repo.GetByStatus("", 10, 0)
	suite.Error(err)
	suite.Nil(txs)
	suite.Contains(err.Error(), "status cannot be empty")
}

// TestGetTransactionsByType tests retrieving transactions by type
func (suite *TransactionRepositoryTestSuite) TestGetTransactionsByType() {
	// Create transactions with different types
	txTypes := []models.TransactionType{models.TransactionTypeSwap, models.TransactionTypeAddLiquidity}
	for i, txType := range txTypes {
		for j := 0; j < 2; j++ {
			tx := &models.Transaction{
				TxHash:      fmt.Sprintf("0x%s%062d", string(txType), j),
				UserAddress: fmt.Sprintf("0x%040d", i*10+j),
				PoolID:      fmt.Sprintf("pool-%d", i),
				Type:        txType,
				Status:      models.TransactionStatusConfirmed,
				TokenIn:     "0x2222222222222222222222222222222222222222",
				TokenOut:    "0x3333333333333333333333333333333333333333",
				AmountIn:    decimal.NewFromInt(1000),
				AmountOut:   decimal.NewFromInt(2000),
				GasUsed:     21000,
				GasPrice:    decimal.NewFromInt(20000000000),
				BlockNumber: 12345 + uint64(i*10+j),
			}
			err := suite.repo.Create(tx)
			suite.NoError(err)
		}
	}

	// Get transactions by type
	swapTxs, err := suite.repo.GetByType(models.TransactionTypeSwap, 10, 0)
	suite.NoError(err)
	suite.Len(swapTxs, 2)

	// Verify all transactions have the correct type
	for _, tx := range swapTxs {
		suite.Equal(models.TransactionTypeSwap, tx.Type)
	}
}

// TestGetTransactionsByTypeEmpty tests retrieving transactions with empty type
func (suite *TransactionRepositoryTestSuite) TestGetTransactionsByTypeEmpty() {
	txs, err := suite.repo.GetByType(models.TransactionType(""), 10, 0)
	suite.Error(err)
	suite.Nil(txs)
	suite.Contains(err.Error(), "type cannot be empty")
}

// TestGetTransactionsByDateRange tests retrieving transactions by date range
func (suite *TransactionRepositoryTestSuite) TestGetTransactionsByDateRange() {
	now := time.Now()
	yesterday := now.Add(-24 * time.Hour)
	tomorrow := now.Add(24 * time.Hour)

	// Create transactions with different timestamps
	txInRange := &models.Transaction{
		TxHash:      "0x1111111111111111111111111111111111111111111111111111111111111111",
		UserAddress: "0x1111111111111111111111111111111111111111",
		PoolID:      "pool-1",
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusConfirmed,
		TokenIn:     "0x2222222222222222222222222222222222222222",
		TokenOut:    "0x3333333333333333333333333333333333333333",
		AmountIn:    decimal.NewFromInt(1000),
		AmountOut:   decimal.NewFromInt(2000),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12345,
		CreatedAt:   now,
	}

	txOutOfRange := &models.Transaction{
		TxHash:      "0x2222222222222222222222222222222222222222222222222222222222222222",
		UserAddress: "0x2222222222222222222222222222222222222222",
		PoolID:      "pool-2",
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusConfirmed,
		TokenIn:     "0x2222222222222222222222222222222222222222",
		TokenOut:    "0x3333333333333333333333333333333333333333",
		AmountIn:    decimal.NewFromInt(1000),
		AmountOut:   decimal.NewFromInt(2000),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12346,
		CreatedAt:   yesterday.Add(-1 * time.Hour), // Outside range
	}

	err := suite.repo.Create(txInRange)
	suite.NoError(err)
	err = suite.repo.Create(txOutOfRange)
	suite.NoError(err)

	// Get transactions by date range
	txs, err := suite.repo.GetTransactionsByDateRange(yesterday, tomorrow)
	suite.NoError(err)
	suite.Len(txs, 1)
	suite.Equal(txInRange.TxHash, txs[0].TxHash)
}

// TestUpdateTransactionStatus tests updating transaction status
func (suite *TransactionRepositoryTestSuite) TestUpdateTransactionStatus() {
	// Create test transaction
	tx := &models.Transaction{
		TxHash:      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		UserAddress: "0x1111111111111111111111111111111111111111",
		PoolID:      "pool-1",
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusPending,
		TokenIn:     "0x2222222222222222222222222222222222222222",
		TokenOut:    "0x3333333333333333333333333333333333333333",
		AmountIn:    decimal.NewFromInt(1000),
		AmountOut:   decimal.NewFromInt(2000),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12345,
	}
	err := suite.repo.Create(tx)
	suite.NoError(err)

	// Update status
	err = suite.repo.UpdateStatus(tx.TxHash, models.TransactionStatusConfirmed)
	suite.NoError(err)

	// Verify update
	updatedTx, err := suite.repo.GetByID(tx.ID)
	suite.NoError(err)
	suite.Equal(models.TransactionStatusConfirmed, updatedTx.Status)
}

// TestUpdateTransactionStatusZeroID tests updating status with zero ID
func (suite *TransactionRepositoryTestSuite) TestUpdateTransactionStatusZeroID() {
	err := suite.repo.UpdateStatus("", models.TransactionStatusConfirmed)
	suite.Error(err)
	suite.Contains(err.Error(), "txHash cannot be empty")
}

// TestUpdateTransactionStatusEmptyStatus tests updating with empty status
func (suite *TransactionRepositoryTestSuite) TestUpdateTransactionStatusEmptyStatus() {
	err := suite.repo.UpdateStatus("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", models.TransactionStatus(""))
	suite.Error(err)
	suite.Contains(err.Error(), "status cannot be empty")
}

// TestUpdateTransaction tests updating transaction
func (suite *TransactionRepositoryTestSuite) TestUpdateTransaction() {
	// Create test transaction
	tx := &models.Transaction{
		TxHash:      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		UserAddress: "0x1111111111111111111111111111111111111111",
		PoolID:      "pool-1",
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusPending,
		TokenIn:     "0x2222222222222222222222222222222222222222",
		TokenOut:    "0x3333333333333333333333333333333333333333",
		AmountIn:    decimal.NewFromInt(1000),
		AmountOut:   decimal.NewFromInt(2000),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12345,
	}
	err := suite.repo.Create(tx)
	suite.NoError(err)

	// Update transaction
	tx.Status = models.TransactionStatusConfirmed
	tx.GasUsed = 25000
	tx.BlockNumber = 12346
	err = suite.repo.Update(tx)
	suite.NoError(err)

	// Verify update
	updatedTx, err := suite.repo.GetByID(tx.ID)
	suite.NoError(err)
	suite.Equal(models.TransactionStatusConfirmed, updatedTx.Status)
	suite.Equal(uint64(25000), updatedTx.GasUsed)
	suite.Equal(uint64(12346), updatedTx.BlockNumber)
}

// TestUpdateTransactionNil tests updating nil transaction
func (suite *TransactionRepositoryTestSuite) TestUpdateTransactionNil() {
	err := suite.repo.Update(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "transaction cannot be nil")
}

// TestDeleteTransaction tests deleting transaction
func (suite *TransactionRepositoryTestSuite) TestDeleteTransaction() {
	// Create test transaction
	tx := &models.Transaction{
		TxHash:      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		UserAddress: "0x1111111111111111111111111111111111111111",
		PoolID:      "pool-1",
		Type:        models.TransactionTypeSwap,
		Status:      models.TransactionStatusPending,
		TokenIn:     "0x2222222222222222222222222222222222222222",
		TokenOut:    "0x3333333333333333333333333333333333333333",
		AmountIn:    decimal.NewFromInt(1000),
		AmountOut:   decimal.NewFromInt(2000),
		GasUsed:     21000,
		GasPrice:    decimal.NewFromInt(20000000000),
		BlockNumber: 12345,
	}
	err := suite.repo.Create(tx)
	suite.NoError(err)

	// Delete transaction
	err = suite.repo.Delete(tx.ID)
	suite.NoError(err)

	// Verify deletion (soft delete)
	deletedTx, err := suite.repo.GetByID(tx.ID)
	suite.NoError(err)
	suite.Nil(deletedTx) // Should be nil due to soft delete
}

// TestDeleteTransactionZeroID tests deleting transaction with zero ID
func (suite *TransactionRepositoryTestSuite) TestDeleteTransactionZeroID() {
	err := suite.repo.Delete(0)
	suite.Error(err)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestListTransactions tests listing transactions with pagination
func (suite *TransactionRepositoryTestSuite) TestListTransactions() {
	// Create multiple test transactions
	for i := 0; i < 5; i++ {
		tx := &models.Transaction{
			TxHash:      fmt.Sprintf("0x%064d", i),
			UserAddress: fmt.Sprintf("0x%040d", i),
			PoolID:      fmt.Sprintf("pool-%d", i),
			Type:        models.TransactionTypeSwap,
			Status:      models.TransactionStatusConfirmed,
			TokenIn:     "0x2222222222222222222222222222222222222222",
			TokenOut:    "0x3333333333333333333333333333333333333333",
			AmountIn:    decimal.NewFromInt(1000),
			AmountOut:   decimal.NewFromInt(2000),
			GasUsed:     21000,
			GasPrice:    decimal.NewFromInt(20000000000),
			BlockNumber: 12345 + uint64(i),
		}
		err := suite.repo.Create(tx)
		suite.NoError(err)
	}

	// Test pagination
	txs, err := suite.repo.List(3, 0)
	suite.NoError(err)
	suite.Len(txs, 3)

	// Test offset
	txs, err = suite.repo.List(3, 2)
	suite.NoError(err)
	suite.Len(txs, 3)
}

// TestGetUserTransactionCount tests getting transaction count for a user
func (suite *TransactionRepositoryTestSuite) TestGetUserTransactionCount() {
	userAddress := "0x1111111111111111111111111111111111111111"
	// Create test transactions
	for i := 0; i < 3; i++ {
		tx := &models.Transaction{
			TxHash:      fmt.Sprintf("0x%064d", i),
			UserAddress: userAddress,
			PoolID:      "pool-1",
			Type:        models.TransactionTypeSwap,
			Status:      models.TransactionStatusConfirmed,
			TokenIn:     "0x2222222222222222222222222222222222222222",
			TokenOut:    "0x3333333333333333333333333333333333333333",
			AmountIn:    decimal.NewFromInt(1000),
			AmountOut:   decimal.NewFromInt(2000),
			GasUsed:     21000,
			GasPrice:    decimal.NewFromInt(20000000000),
			BlockNumber: 12345 + uint64(i),
		}
		err := suite.repo.Create(tx)
		suite.NoError(err)
	}

	// Get transaction count for user
	count, err := suite.repo.GetUserTransactionCount(userAddress)
	suite.NoError(err)
	suite.Equal(int64(3), count)
}

// TestGetVolumeByPool tests getting volume by pool
func (suite *TransactionRepositoryTestSuite) TestGetVolumeByPool() {
	poolID := "pool-1"

	// Create transactions with different amounts
	amounts := []int64{1000, 2000, 3000}
	for i, amount := range amounts {
		tx := &models.Transaction{
			TxHash:      fmt.Sprintf("0x%064d", i),
			UserAddress: fmt.Sprintf("0x%040d", i),
			PoolID:      poolID,
			Type:        models.TransactionTypeSwap,
			Status:      models.TransactionStatusConfirmed,
			TokenIn:     "0x2222222222222222222222222222222222222222",
			TokenOut:    "0x3333333333333333333333333333333333333333",
			AmountIn:    decimal.NewFromInt(amount),
			AmountOut:   decimal.NewFromInt(amount * 2),
			GasUsed:     21000,
			GasPrice:    decimal.NewFromInt(20000000000),
			BlockNumber: 12345 + uint64(i),
		}
		err := suite.repo.Create(tx)
		suite.NoError(err)
	}

	// Get volume by pool
	volume, err := suite.repo.GetPoolTransactionVolume(poolID, time.Now().Add(-24*time.Hour))
	suite.NoError(err)

	// Volume should be sum of AmountIn values: 1000 + 2000 + 3000 = 6000
	suite.Equal("6000", volume)
}

// TestGetVolumeByPoolEmpty tests getting volume with empty pool ID
func (suite *TransactionRepositoryTestSuite) TestGetVolumeByPoolEmpty() {
	volume, err := suite.repo.GetPoolTransactionVolume("", time.Now())
	suite.Error(err)
	suite.Equal("0", volume)
	suite.Contains(err.Error(), "poolID cannot be empty")
}

// TestTransactionRepositoryTestSuite runs the test suite
func TestTransactionRepositoryTestSuite(t *testing.T) {
	suite.Run(t, new(TransactionRepositoryTestSuite))
}
