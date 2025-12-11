package pool

import (
	"testing"

	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

type MockPoolRepository struct {
	mock.Mock
}

func (m *MockPoolRepository) Create(pool *models.Pool) error {
	args := m.Called(pool)
	return args.Error(0)
}

func (m *MockPoolRepository) GetByID(id uint) (*models.Pool, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Pool), args.Error(1)
}

func (m *MockPoolRepository) GetByPoolID(poolID string) (*models.Pool, error) {
	args := m.Called(poolID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Pool), args.Error(1)
}

func (m *MockPoolRepository) GetByTokens(token0, token1 string) (*models.Pool, error) {
	args := m.Called(token0, token1)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Pool), args.Error(1)
}

func (m *MockPoolRepository) List(limit, offset int) ([]*models.Pool, error) {
	args := m.Called(limit, offset)
	return args.Get(0).([]*models.Pool), args.Error(1)
}

func (m *MockPoolRepository) GetActivePools() ([]*models.Pool, error) {
	args := m.Called()
	return args.Get(0).([]*models.Pool), args.Error(1)
}

func (m *MockPoolRepository) UpdateLiquidity(poolID string, liquidity decimal.Decimal) error {
	args := m.Called(poolID, liquidity)
	return args.Error(0)
}

func (m *MockPoolRepository) Update(pool *models.Pool) error {
	args := m.Called(pool)
	return args.Error(0)
}

func (m *MockPoolRepository) Delete(id uint) error {
	args := m.Called(id)
	return args.Error(0)
}

func (m *MockPoolRepository) UpdateReserves(poolID string, reserve0, reserve1 decimal.Decimal) error {
	args := m.Called(poolID, reserve0, reserve1)
	return args.Error(0)
}

func (m *MockPoolRepository) GetPoolsByToken(tokenAddress string) ([]*models.Pool, error) {
	args := m.Called(tokenAddress)
	return args.Get(0).([]*models.Pool), args.Error(1)
}

func (m *MockPoolRepository) GetTopPoolsByTVL(limit int) ([]*models.Pool, error) {
	args := m.Called(limit)
	return args.Get(0).([]*models.Pool), args.Error(1)
}

func TestCreatePool(t *testing.T) {
	mockRepo := new(MockPoolRepository)
	service := NewService(mockRepo)

	pool := &models.Pool{
		Token0: "0xToken0",
		Token1: "0xToken1",
	}

	mockRepo.On("Create", pool).Return(nil)

	err := service.CreatePool(pool)
	assert.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestCreatePool_ValidationError(t *testing.T) {
	mockRepo := new(MockPoolRepository)
	service := NewService(mockRepo)

	pool := &models.Pool{
		Token0: "",
		Token1: "0xToken1",
	}

	err := service.CreatePool(pool)
	assert.Error(t, err)
	assert.Equal(t, "token addresses required", err.Error())
}

func TestGetPoolByID(t *testing.T) {
	mockRepo := new(MockPoolRepository)
	service := NewService(mockRepo)

	expectedPool := &models.Pool{ID: 1}
	mockRepo.On("GetByID", uint(1)).Return(expectedPool, nil)

	pool, err := service.GetPoolByID(1)
	assert.NoError(t, err)
	assert.Equal(t, expectedPool, pool)
	mockRepo.AssertExpectations(t)
}

func TestGetPoolByPoolID(t *testing.T) {
	mockRepo := new(MockPoolRepository)
	service := NewService(mockRepo)

	expectedPool := &models.Pool{PoolID: "0xPoolID"}
	mockRepo.On("GetByPoolID", "0xPoolID").Return(expectedPool, nil)

	pool, err := service.GetPoolByPoolID("0xPoolID")
	assert.NoError(t, err)
	assert.Equal(t, expectedPool, pool)
	mockRepo.AssertExpectations(t)
}

func TestGetPoolByTokens(t *testing.T) {
	mockRepo := new(MockPoolRepository)
	service := NewService(mockRepo)

	expectedPool := &models.Pool{Token0: "0xToken0", Token1: "0xToken1"}
	mockRepo.On("GetByTokens", "0xToken0", "0xToken1").Return(expectedPool, nil)

	pool, err := service.GetPoolByTokens("0xToken0", "0xToken1")
	assert.NoError(t, err)
	assert.Equal(t, expectedPool, pool)
	mockRepo.AssertExpectations(t)
}

func TestListPools(t *testing.T) {
	mockRepo := new(MockPoolRepository)
	service := NewService(mockRepo)

	expectedPools := []*models.Pool{{ID: 1}, {ID: 2}}
	mockRepo.On("List", 10, 0).Return(expectedPools, nil)

	pools, err := service.ListPools(0, 0)
	assert.NoError(t, err)
	assert.Equal(t, expectedPools, pools)
	mockRepo.AssertExpectations(t)
}

func TestGetActivePools(t *testing.T) {
	mockRepo := new(MockPoolRepository)
	service := NewService(mockRepo)

	expectedPools := []*models.Pool{{ID: 1}}
	mockRepo.On("GetActivePools").Return(expectedPools, nil)

	pools, err := service.GetActivePools()
	assert.NoError(t, err)
	assert.Equal(t, expectedPools, pools)
	mockRepo.AssertExpectations(t)
}

func TestUpdatePoolLiquidity(t *testing.T) {
	mockRepo := new(MockPoolRepository)
	service := NewService(mockRepo)

	liquidity := decimal.NewFromInt(100)
	mockRepo.On("UpdateLiquidity", "0xPoolID", liquidity).Return(nil)

	err := service.UpdatePoolLiquidity("0xPoolID", liquidity)
	assert.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestGetTopPools(t *testing.T) {
	mockRepo := new(MockPoolRepository)
	service := NewService(mockRepo)

	expectedPools := []*models.Pool{{ID: 1}}
	mockRepo.On("GetTopPoolsByTVL", 10).Return(expectedPools, nil)

	pools, err := service.GetTopPools(0)
	assert.NoError(t, err)
	assert.Equal(t, expectedPools, pools)
	mockRepo.AssertExpectations(t)
}
