package transaction

import (
	"errors"
	"gorm.io/gorm"
	"time"
)

// TransactionRepository interface defines transaction database operations
type TransactionRepository interface {
	Create(transaction *Transaction) error
	GetByID(id uint) (*Transaction, error)
	GetByTxHash(txHash string) (*Transaction, error)
	GetByUserAddress(userAddress string, limit, offset int) ([]*Transaction, error)
	GetByPoolID(poolID string, limit, offset int) ([]*Transaction, error)
	Update(transaction *Transaction) error
	Delete(id uint) error
	List(limit, offset int) ([]*Transaction, error)
	GetByStatus(status TransactionStatus, limit, offset int) ([]*Transaction, error)
	GetByType(txType TransactionType, limit, offset int) ([]*Transaction, error)
	GetRecentTransactions(limit int) ([]*Transaction, error)
	GetTransactionsByDateRange(start, end time.Time) ([]*Transaction, error)
	UpdateStatus(txHash string, status TransactionStatus) error
	GetUserTransactionCount(userAddress string) (int64, error)
	GetPoolTransactionVolume(poolID string, since time.Time) (string, error)
}

// transactionRepository implements TransactionRepository interface
type transactionRepository struct {
	db *gorm.DB
}

// NewTransactionRepository creates a new transaction repository
func NewTransactionRepository(db *gorm.DB) TransactionRepository {
	return &transactionRepository{db: db}
}

// Create creates a new transaction
func (r *transactionRepository) Create(transaction *Transaction) error {
	if transaction == nil {
		return errors.New("transaction cannot be nil")
	}
	return r.db.Create(transaction).Error
}

// GetByID retrieves a transaction by its ID
func (r *transactionRepository) GetByID(id uint) (*Transaction, error) {
	if id == 0 {
		return nil, errors.New("id cannot be zero")
	}

	var transaction Transaction
	err := r.db.Preload("User").Preload("Pool").First(&transaction, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &transaction, nil
}

// GetByTxHash retrieves a transaction by its transaction hash
func (r *transactionRepository) GetByTxHash(txHash string) (*Transaction, error) {
	if txHash == "" {
		return nil, errors.New("txHash cannot be empty")
	}

	var transaction Transaction
	err := r.db.Preload("User").Preload("Pool").Where("tx_hash = ?", txHash).First(&transaction).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &transaction, nil
}

// GetByUserAddress retrieves transactions by user address with pagination
func (r *transactionRepository) GetByUserAddress(userAddress string, limit, offset int) ([]*Transaction, error) {
	if userAddress == "" {
		return nil, errors.New("userAddress cannot be empty")
	}

	var transactions []*Transaction
	err := r.db.Preload("Pool").Where("user_address = ?", userAddress).
		Order("created_at DESC").Limit(limit).Offset(offset).Find(&transactions).Error
	return transactions, err
}

// GetByPoolID retrieves transactions by pool ID with pagination
func (r *transactionRepository) GetByPoolID(poolID string, limit, offset int) ([]*Transaction, error) {
	if poolID == "" {
		return nil, errors.New("poolID cannot be empty")
	}

	var transactions []*Transaction
	err := r.db.Preload("User").Where("pool_id = ?", poolID).
		Order("created_at DESC").Limit(limit).Offset(offset).Find(&transactions).Error
	return transactions, err
}

// Update updates an existing transaction
func (r *transactionRepository) Update(transaction *Transaction) error {
	if transaction == nil {
		return errors.New("transaction cannot be nil")
	}
	return r.db.Save(transaction).Error
}

// Delete soft deletes a transaction by ID
func (r *transactionRepository) Delete(id uint) error {
	if id == 0 {
		return errors.New("id cannot be zero")
	}
	return r.db.Delete(&Transaction{}, id).Error
}

// List retrieves transactions with pagination
func (r *transactionRepository) List(limit, offset int) ([]*Transaction, error) {
	var transactions []*Transaction
	err := r.db.Preload("User").Preload("Pool").Order("created_at DESC").
		Limit(limit).Offset(offset).Find(&transactions).Error
	return transactions, err
}

// GetByStatus retrieves transactions by status with pagination
func (r *transactionRepository) GetByStatus(status TransactionStatus, limit, offset int) ([]*Transaction, error) {
	var transactions []*Transaction
	err := r.db.Preload("User").Preload("Pool").Where("status = ?", status).
		Order("created_at DESC").Limit(limit).Offset(offset).Find(&transactions).Error
	return transactions, err
}

// GetByType retrieves transactions by type with pagination
func (r *transactionRepository) GetByType(txType TransactionType, limit, offset int) ([]*Transaction, error) {
	var transactions []*Transaction
	err := r.db.Preload("User").Preload("Pool").Where("type = ?", txType).
		Order("created_at DESC").Limit(limit).Offset(offset).Find(&transactions).Error
	return transactions, err
}

// GetRecentTransactions retrieves recent transactions
func (r *transactionRepository) GetRecentTransactions(limit int) ([]*Transaction, error) {
	var transactions []*Transaction
	err := r.db.Preload("User").Preload("Pool").Order("created_at DESC").
		Limit(limit).Find(&transactions).Error
	return transactions, err
}

// GetTransactionsByDateRange retrieves transactions within a date range
func (r *transactionRepository) GetTransactionsByDateRange(start, end time.Time) ([]*Transaction, error) {
	var transactions []*Transaction
	err := r.db.Preload("User").Preload("Pool").
		Where("created_at BETWEEN ? AND ?", start, end).
		Order("created_at DESC").Find(&transactions).Error
	return transactions, err
}

// UpdateStatus updates a transaction's status
func (r *transactionRepository) UpdateStatus(txHash string, status TransactionStatus) error {
	if txHash == "" {
		return errors.New("txHash cannot be empty")
	}
	return r.db.Model(&Transaction{}).Where("tx_hash = ?", txHash).Update("status", status).Error
}

// GetUserTransactionCount gets the total number of transactions for a user
func (r *transactionRepository) GetUserTransactionCount(userAddress string) (int64, error) {
	if userAddress == "" {
		return 0, errors.New("userAddress cannot be empty")
	}

	var count int64
	err := r.db.Model(&Transaction{}).Where("user_address = ?", userAddress).Count(&count).Error
	return count, err
}

// GetPoolTransactionVolume calculates total transaction volume for a pool since a given time
func (r *transactionRepository) GetPoolTransactionVolume(poolID string, since time.Time) (string, error) {
	if poolID == "" {
		return "0", errors.New("poolID cannot be empty")
	}

	var result struct {
		TotalVolume string
	}

	err := r.db.Model(&Transaction{}).
		Select("COALESCE(SUM(CAST(amount_in AS DECIMAL)), 0) as total_volume").
		Where("pool_id = ? AND created_at >= ? AND status = ?", poolID, since, TransactionStatusConfirmed).
		Scan(&result).Error

	if err != nil {
		return "0", err
	}

	return result.TotalVolume, nil
}
