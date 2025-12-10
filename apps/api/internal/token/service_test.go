package token

import (
	"errors"
	"testing"

	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// MockTokenRepository is a mock implementation of TokenRepository
type MockTokenRepository struct {
	mock.Mock
}

func (m *MockTokenRepository) Create(token *models.Token) error {
	args := m.Called(token)
	return args.Error(0)
}

func (m *MockTokenRepository) GetByID(id uint) (*models.Token, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Token), args.Error(1)
}

func (m *MockTokenRepository) GetByAddress(address string) (*models.Token, error) {
	args := m.Called(address)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Token), args.Error(1)
}

func (m *MockTokenRepository) GetBySymbol(symbol string) (*models.Token, error) {
	args := m.Called(symbol)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Token), args.Error(1)
}

func (m *MockTokenRepository) Update(token *models.Token) error {
	args := m.Called(token)
	return args.Error(0)
}

func (m *MockTokenRepository) Delete(id uint) error {
	args := m.Called(id)
	return args.Error(0)
}

func (m *MockTokenRepository) List(limit, offset int) ([]*models.Token, error) {
	args := m.Called(limit, offset)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenRepository) GetVerifiedTokens(limit, offset int) ([]*models.Token, error) {
	args := m.Called(limit, offset)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenRepository) GetActiveTokens(limit, offset int) ([]*models.Token, error) {
	args := m.Called(limit, offset)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenRepository) GetTokensBySymbols(symbols []string) ([]*models.Token, error) {
	args := m.Called(symbols)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenRepository) UpdatePrice(id uint, price decimal.Decimal) error {
	args := m.Called(id, price)
	return args.Error(0)
}

func (m *MockTokenRepository) UpdateMarketData(id uint, marketCap, volume24h decimal.Decimal) error {
	args := m.Called(id, marketCap, volume24h)
	return args.Error(0)
}

func (m *MockTokenRepository) SearchTokens(query string, limit, offset int) ([]*models.Token, error) {
	args := m.Called(query, limit, offset)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenRepository) GetTopTokensByVolume(limit int) ([]*models.Token, error) {
	args := m.Called(limit)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockTokenRepository) GetTopTokensByMarketCap(limit int) ([]*models.Token, error) {
	args := m.Called(limit)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func TestCreateToken(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	token := &models.Token{
		Address: "0x123",
		Symbol:  "TST",
		Name:    "Test Token",
	}

	mockRepo.On("Create", token).Return(nil)

	err := service.CreateToken(token)
	assert.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestCreateToken_ValidationError(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	token := &models.Token{
		Address: "", // Missing address
		Symbol:  "TST",
	}

	err := service.CreateToken(token)
	assert.Error(t, err)
	assert.Equal(t, "address and symbol are required", err.Error())
}

func TestGetTokenByID(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	expectedToken := &models.Token{ID: 1, Symbol: "TST"}
	mockRepo.On("GetByID", uint(1)).Return(expectedToken, nil)

	token, err := service.GetTokenByID(1)
	assert.NoError(t, err)
	assert.Equal(t, expectedToken, token)
	mockRepo.AssertExpectations(t)
}

func TestGetTokenByID_NotFound(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	mockRepo.On("GetByID", uint(1)).Return(nil, errors.New("not found"))

	token, err := service.GetTokenByID(1)
	assert.Error(t, err)
	assert.Nil(t, token)
	mockRepo.AssertExpectations(t)
}

func TestListTokens(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	expectedTokens := []*models.Token{
		{ID: 1, Symbol: "TST1"},
		{ID: 2, Symbol: "TST2"},
	}

	// Default limit 10, offset 0
	mockRepo.On("List", 10, 0).Return(expectedTokens, nil)

	tokens, err := service.ListTokens(0, 0)
	assert.NoError(t, err)
	assert.Equal(t, expectedTokens, tokens)
	mockRepo.AssertExpectations(t)
}

func TestGetTokenByAddress(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	expectedToken := &models.Token{ID: 1, Address: "0x123", Symbol: "TST"}
	mockRepo.On("GetByAddress", "0x123").Return(expectedToken, nil)

	token, err := service.GetTokenByAddress("0x123")
	assert.NoError(t, err)
	assert.Equal(t, expectedToken, token)
	mockRepo.AssertExpectations(t)
}

func TestGetTokenBySymbol(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	expectedToken := &models.Token{ID: 1, Address: "0x123", Symbol: "TST"}
	mockRepo.On("GetBySymbol", "TST").Return(expectedToken, nil)

	token, err := service.GetTokenBySymbol("TST")
	assert.NoError(t, err)
	assert.Equal(t, expectedToken, token)
	mockRepo.AssertExpectations(t)
}

func TestGetVerifiedTokens(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	expectedTokens := []*models.Token{
		{ID: 1, Symbol: "TST1", IsVerified: true},
	}

	mockRepo.On("GetVerifiedTokens", 10, 0).Return(expectedTokens, nil)

	tokens, err := service.GetVerifiedTokens(0, 0)
	assert.NoError(t, err)
	assert.Equal(t, expectedTokens, tokens)
	mockRepo.AssertExpectations(t)
}

func TestSearchTokens(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	expectedTokens := []*models.Token{
		{ID: 1, Symbol: "TST", Name: "Test Token"},
	}

	mockRepo.On("SearchTokens", "Test", 10, 0).Return(expectedTokens, nil)

	tokens, err := service.SearchTokens("Test", 0, 0)
	assert.NoError(t, err)
	assert.Equal(t, expectedTokens, tokens)
	mockRepo.AssertExpectations(t)
}

func TestGetTopTokensByVolume(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	expectedTokens := []*models.Token{
		{ID: 1, Symbol: "TST1", Volume24h: decimal.NewFromInt(1000)},
	}

	mockRepo.On("GetTopTokensByVolume", 10).Return(expectedTokens, nil)

	tokens, err := service.GetTopTokensByVolume(0)
	assert.NoError(t, err)
	assert.Equal(t, expectedTokens, tokens)
	mockRepo.AssertExpectations(t)
}

func TestGetTopTokensByMarketCap(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	expectedTokens := []*models.Token{
		{ID: 1, Symbol: "TST1", MarketCap: decimal.NewFromInt(1000000)},
	}

	mockRepo.On("GetTopTokensByMarketCap", 10).Return(expectedTokens, nil)

	tokens, err := service.GetTopTokensByMarketCap(0)
	assert.NoError(t, err)
	assert.Equal(t, expectedTokens, tokens)
	mockRepo.AssertExpectations(t)
}

func TestUpdateTokenPrice(t *testing.T) {
	mockRepo := new(MockTokenRepository)
	service := NewService(mockRepo)

	price := decimal.NewFromFloat(1.5)
	mockRepo.On("UpdatePrice", uint(1), price).Return(nil)

	err := service.UpdateTokenPrice(1, price)
	assert.NoError(t, err)
	mockRepo.AssertExpectations(t)
}
