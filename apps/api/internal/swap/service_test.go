package swap

import (
	"testing"

	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// MockPoolService is a mock implementation of pool.Service
type MockPoolService struct {
	mock.Mock
}

func (m *MockPoolService) CreatePool(pool *models.Pool) error {
	args := m.Called(pool)
	return args.Error(0)
}

func (m *MockPoolService) GetPoolByID(id uint) (*models.Pool, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Pool), args.Error(1)
}

func (m *MockPoolService) GetPoolByPoolID(poolID string) (*models.Pool, error) {
	args := m.Called(poolID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Pool), args.Error(1)
}

func (m *MockPoolService) GetPoolByTokens(token0, token1 string) (*models.Pool, error) {
	args := m.Called(token0, token1)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Pool), args.Error(1)
}

func (m *MockPoolService) ListPools(limit, offset int) ([]*models.Pool, error) {
	args := m.Called(limit, offset)
	return args.Get(0).([]*models.Pool), args.Error(1)
}

func (m *MockPoolService) GetActivePools() ([]*models.Pool, error) {
	args := m.Called()
	return args.Get(0).([]*models.Pool), args.Error(1)
}

func (m *MockPoolService) UpdatePoolLiquidity(poolID string, liquidity decimal.Decimal) error {
	args := m.Called(poolID, liquidity)
	return args.Error(0)
}

func (m *MockPoolService) GetTopPools(limit int) ([]*models.Pool, error) {
	args := m.Called(limit)
	return args.Get(0).([]*models.Pool), args.Error(1)
}

// MockTokenService is a mock implementation of token.Service
type MockTokenService struct {
	mock.Mock
}

func (m *MockTokenService) CreateToken(token *models.Token) error {
	args := m.Called(token)
	return args.Error(0)
}

func (m *MockTokenService) GetTokenByID(id uint) (*models.Token, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Token), args.Error(1)
}

func (m *MockTokenService) GetTokenByAddress(address string) (*models.Token, error) {
	args := m.Called(address)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Token), args.Error(1)
}

func (m *MockTokenService) GetTokenBySymbol(symbol string) (*models.Token, error) {
	args := m.Called(symbol)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Token), args.Error(1)
}

func (m *MockTokenService) ListTokens(limit, offset int) ([]*models.Token, error) {
	args := m.Called(limit, offset)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenService) GetVerifiedTokens(limit, offset int) ([]*models.Token, error) {
	args := m.Called(limit, offset)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenService) SearchTokens(query string, limit, offset int) ([]*models.Token, error) {
	args := m.Called(query, limit, offset)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenService) GetTopTokensByVolume(limit int) ([]*models.Token, error) {
	args := m.Called(limit)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenService) GetTopTokensByMarketCap(limit int) ([]*models.Token, error) {
	args := m.Called(limit)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenService) UpdateTokenPrice(id uint, price decimal.Decimal) error {
	args := m.Called(id, price)
	return args.Error(0)
}

func TestGetQuote_Success(t *testing.T) {
	mockPoolService := new(MockPoolService)
	mockTokenService := new(MockTokenService)
	svc := NewService(mockPoolService, mockTokenService)

	tokenIn := "0x0000000000000000000000000000000000000001"
	tokenOut := "0x0000000000000000000000000000000000000002"

	isActive := true
	mockPool := &models.Pool{
		ID:       1,
		PoolID:   "pool-1",
		Token0:   tokenIn,
		Token1:   tokenOut,
		FeeRate:  decimal.NewFromFloat(0.003), // 0.3%
		Reserve0: decimal.NewFromInt(1000),
		Reserve1: decimal.NewFromInt(2000),
		IsActive: &isActive,
	}

	mockTokenIn := &models.Token{
		ID:       1,
		Address:  tokenIn,
		Symbol:   "TKN1",
		Name:     "Token One",
		Decimals: 18,
	}

	mockTokenOut := &models.Token{
		ID:       2,
		Address:  tokenOut,
		Symbol:   "TKN2",
		Name:     "Token Two",
		Decimals: 18,
	}

	mockPoolService.On("GetPoolByTokens", tokenIn, tokenOut).Return(mockPool, nil)
	mockTokenService.On("GetTokenByAddress", tokenIn).Return(mockTokenIn, nil)
	mockTokenService.On("GetTokenByAddress", tokenOut).Return(mockTokenOut, nil)

	req := &SwapQuoteRequest{
		TokenIn:  tokenIn,
		TokenOut: tokenOut,
		AmountIn: decimal.NewFromInt(10),
	}

	quote, err := svc.GetQuote(req)

	assert.NoError(t, err)
	assert.NotNil(t, quote)
	assert.True(t, quote.AmountOut.GreaterThan(decimal.Zero))
	assert.Equal(t, "TKN1", quote.TokenIn.Symbol)
	assert.Equal(t, "TKN2", quote.TokenOut.Symbol)
	assert.Len(t, quote.Route, 1)
	assert.Equal(t, "pool-1", quote.Route[0].PoolID)

	mockPoolService.AssertExpectations(t)
	mockTokenService.AssertExpectations(t)
}

func TestGetQuote_SameToken(t *testing.T) {
	mockPoolService := new(MockPoolService)
	mockTokenService := new(MockTokenService)
	svc := NewService(mockPoolService, mockTokenService)

	req := &SwapQuoteRequest{
		TokenIn:  "0x0000000000000000000000000000000000000001",
		TokenOut: "0x0000000000000000000000000000000000000001",
		AmountIn: decimal.NewFromInt(10),
	}

	quote, err := svc.GetQuote(req)

	assert.Error(t, err)
	assert.Nil(t, quote)
	assert.Equal(t, "cannot swap same token", err.Error())
}

func TestGetQuote_ZeroAmount(t *testing.T) {
	mockPoolService := new(MockPoolService)
	mockTokenService := new(MockTokenService)
	svc := NewService(mockPoolService, mockTokenService)

	req := &SwapQuoteRequest{
		TokenIn:  "0x0000000000000000000000000000000000000001",
		TokenOut: "0x0000000000000000000000000000000000000002",
		AmountIn: decimal.Zero,
	}

	quote, err := svc.GetQuote(req)

	assert.Error(t, err)
	assert.Nil(t, quote)
	assert.Equal(t, "amount must be positive", err.Error())
}

func TestGetQuote_PoolNotFound(t *testing.T) {
	mockPoolService := new(MockPoolService)
	mockTokenService := new(MockTokenService)
	svc := NewService(mockPoolService, mockTokenService)

	mockPoolService.On("GetPoolByTokens", mock.Anything, mock.Anything).Return(nil, nil)

	req := &SwapQuoteRequest{
		TokenIn:  "0x0000000000000000000000000000000000000001",
		TokenOut: "0x0000000000000000000000000000000000000002",
		AmountIn: decimal.NewFromInt(10),
	}

	quote, err := svc.GetQuote(req)

	assert.Error(t, err)
	assert.Nil(t, quote)
	assert.Equal(t, "pool not found for token pair", err.Error())
}

func TestGetQuote_MathAccuracy(t *testing.T) {
	mockPoolService := new(MockPoolService)
	mockTokenService := new(MockTokenService)
	svc := NewService(mockPoolService, mockTokenService)

	tokenIn := "0x0000000000000000000000000000000000000001"
	tokenOut := "0x0000000000000000000000000000000000000002"

	isActive := true
	// Pool with equal reserves and 0.3% fee (3000 bps in a 1M denominator = 0.003)
	mockPool := &models.Pool{
		ID:       1,
		PoolID:   "pool-1",
		Token0:   tokenIn,
		Token1:   tokenOut,
		FeeRate:  decimal.NewFromFloat(0.003),
		Reserve0: decimal.NewFromInt(100000),
		Reserve1: decimal.NewFromInt(100000),
		IsActive: &isActive,
	}

	mockTokenIn := &models.Token{
		ID:       1,
		Address:  tokenIn,
		Symbol:   "TKN1",
		Name:     "Token One",
		Decimals: 18,
	}

	mockTokenOut := &models.Token{
		ID:       2,
		Address:  tokenOut,
		Symbol:   "TKN2",
		Name:     "Token Two",
		Decimals: 18,
	}

	mockPoolService.On("GetPoolByTokens", tokenIn, tokenOut).Return(mockPool, nil)
	mockTokenService.On("GetTokenByAddress", tokenIn).Return(mockTokenIn, nil)
	mockTokenService.On("GetTokenByAddress", tokenOut).Return(mockTokenOut, nil)

	req := &SwapQuoteRequest{
		TokenIn:  tokenIn,
		TokenOut: tokenOut,
		AmountIn: decimal.NewFromInt(1000),
	}

	quote, err := svc.GetQuote(req)

	assert.NoError(t, err)
	assert.NotNil(t, quote)

	// With 0.3% fee and constant product, swapping 1000 tokens should give slightly less than 1000 out
	// The formula should produce a value close to but less than 1000
	assert.True(t, quote.AmountOut.LessThan(decimal.NewFromInt(1000)))
	assert.True(t, quote.AmountOut.GreaterThan(decimal.NewFromInt(900)))
}
