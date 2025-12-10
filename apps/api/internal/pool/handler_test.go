package pool

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

type MockService struct {
	mock.Mock
}

func (m *MockService) CreatePool(pool *models.Pool) error {
	args := m.Called(pool)
	return args.Error(0)
}

func (m *MockService) GetPoolByID(id uint) (*models.Pool, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Pool), args.Error(1)
}

func (m *MockService) GetPoolByPoolID(poolID string) (*models.Pool, error) {
	args := m.Called(poolID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Pool), args.Error(1)
}

func (m *MockService) GetPoolByTokens(token0, token1 string) (*models.Pool, error) {
	args := m.Called(token0, token1)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.Pool), args.Error(1)
}

func (m *MockService) ListPools(limit, offset int) ([]*models.Pool, error) {
	args := m.Called(limit, offset)
	return args.Get(0).([]*models.Pool), args.Error(1)
}

func (m *MockService) GetActivePools() ([]*models.Pool, error) {
	args := m.Called()
	return args.Get(0).([]*models.Pool), args.Error(1)
}

func (m *MockService) UpdatePoolLiquidity(poolID string, liquidity decimal.Decimal) error {
	args := m.Called(poolID, liquidity)
	return args.Error(0)
}

func (m *MockService) GetTopPools(limit int) ([]*models.Pool, error) {
	args := m.Called(limit)
	return args.Get(0).([]*models.Pool), args.Error(1)
}

func TestCreatePoolHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockService := new(MockService)
	handler := NewHandler(mockService)
	router := gin.New()
	handler.RegisterRoutes(router.Group("/"))

	mockService.On("CreatePool", mock.AnythingOfType("*models.Pool")).Return(nil)

	jsonBody := `{"token0": "0xToken0", "token1": "0xToken1"}`
	req, _ := http.NewRequest(http.MethodPost, "/pools", strings.NewReader(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusCreated, resp.Code)
	mockService.AssertExpectations(t)
}

func TestCreatePoolHandler_BadRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockService := new(MockService)
	handler := NewHandler(mockService)
	router := gin.New()
	handler.RegisterRoutes(router.Group("/"))

	req, _ := http.NewRequest(http.MethodPost, "/pools", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestGetPoolHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockService := new(MockService)
	handler := NewHandler(mockService)
	router := gin.New()
	handler.RegisterRoutes(router.Group("/"))

	expectedPool := &models.Pool{ID: 1, Token0: "0xToken0"}
	mockService.On("GetPoolByID", uint(1)).Return(expectedPool, nil)

	req, _ := http.NewRequest(http.MethodGet, "/pools/1", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var pool models.Pool
	err := json.Unmarshal(resp.Body.Bytes(), &pool)
	assert.NoError(t, err)
	assert.Equal(t, expectedPool.Token0, pool.Token0)
	mockService.AssertExpectations(t)
}

func TestGetPoolHandler_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockService := new(MockService)
	handler := NewHandler(mockService)
	router := gin.New()
	handler.RegisterRoutes(router.Group("/"))

	mockService.On("GetPoolByID", uint(999)).Return(nil, nil)

	req, _ := http.NewRequest(http.MethodGet, "/pools/999", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestListPoolsHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockService := new(MockService)
	handler := NewHandler(mockService)
	router := gin.New()
	handler.RegisterRoutes(router.Group("/"))

	expectedPools := []*models.Pool{{ID: 1}}
	mockService.On("ListPools", 10, 0).Return(expectedPools, nil)

	req, _ := http.NewRequest(http.MethodGet, "/pools", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	mockService.AssertExpectations(t)
}
