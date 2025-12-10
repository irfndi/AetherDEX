package token

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// MockService is a mock implementation of Service
type MockService struct {
	mock.Mock
}

func (m *MockService) CreateToken(token *models.Token) error {
	args := m.Called(token)
	return args.Error(0)
}

func (m *MockService) GetTokenByID(id uint) (*models.Token, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Token), args.Error(1)
}

func (m *MockService) GetTokenByAddress(address string) (*models.Token, error) {
	args := m.Called(address)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Token), args.Error(1)
}

func (m *MockService) GetTokenBySymbol(symbol string) (*models.Token, error) {
	args := m.Called(symbol)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Token), args.Error(1)
}

func (m *MockService) ListTokens(limit, offset int) ([]*models.Token, error) {
	args := m.Called(limit, offset)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockService) GetVerifiedTokens(limit, offset int) ([]*models.Token, error) {
	args := m.Called(limit, offset)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockService) SearchTokens(query string, limit, offset int) ([]*models.Token, error) {
	args := m.Called(query, limit, offset)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockService) GetTopTokensByVolume(limit int) ([]*models.Token, error) {
	args := m.Called(limit)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockService) GetTopTokensByMarketCap(limit int) ([]*models.Token, error) {
	args := m.Called(limit)
	return args.Get(0).([]*models.Token), args.Error(1)
}

func (m *MockService) UpdateTokenPrice(id uint, price decimal.Decimal) error {
	args := m.Called(id, price)
	return args.Error(0)
}

func TestCreateTokenHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mockService := new(MockService)
	handler := NewHandler(mockService)

	router := gin.New()
	handler.RegisterRoutes(router.Group("/"))

	mockService.On("CreateToken", mock.AnythingOfType("*models.Token")).Return(nil)

	jsonBody := `{"address": "0x123", "symbol": "TST"}`
	req, _ := http.NewRequest(http.MethodPost, "/tokens", strings.NewReader(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusCreated, resp.Code)
	mockService.AssertExpectations(t)
}

func TestCreateTokenHandler_BadRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mockService := new(MockService)
	handler := NewHandler(mockService)

	router := gin.New()
	handler.RegisterRoutes(router.Group("/"))

	// Invalid JSON
	jsonBody := `{"address": "0x123", "symbol":`
	req, _ := http.NewRequest(http.MethodPost, "/tokens", strings.NewReader(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestGetTokenHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mockService := new(MockService)
	handler := NewHandler(mockService)

	router := gin.New()
	handler.RegisterRoutes(router.Group("/"))

	expectedToken := &models.Token{ID: 1, Symbol: "TST"}
	mockService.On("GetTokenByID", uint(1)).Return(expectedToken, nil)

	req, _ := http.NewRequest(http.MethodGet, "/tokens/1", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var responseToken models.Token
	err := json.Unmarshal(resp.Body.Bytes(), &responseToken)
	assert.NoError(t, err)
	assert.Equal(t, expectedToken.Symbol, responseToken.Symbol)
	mockService.AssertExpectations(t)
}

func TestGetTokenHandler_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mockService := new(MockService)
	handler := NewHandler(mockService)

	router := gin.New()
	handler.RegisterRoutes(router.Group("/"))

	mockService.On("GetTokenByID", uint(999)).Return(nil, nil)

	req, _ := http.NewRequest(http.MethodGet, "/tokens/999", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
	mockService.AssertExpectations(t)
}

func TestListTokensHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mockService := new(MockService)
	handler := NewHandler(mockService)

	router := gin.New()
	handler.RegisterRoutes(router.Group("/"))

	expectedTokens := []*models.Token{
		{ID: 1, Symbol: "TST1"},
		{ID: 2, Symbol: "TST2"},
	}

	mockService.On("ListTokens", 10, 0).Return(expectedTokens, nil)

	req, _ := http.NewRequest(http.MethodGet, "/tokens", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	mockService.AssertExpectations(t)
}
