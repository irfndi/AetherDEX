package swap

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// MockService is a mock implementation of Service interface
type MockService struct {
	mock.Mock
}

func (m *MockService) GetQuote(req *SwapQuoteRequest) (*SwapQuoteResponse, error) {
	args := m.Called(req)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*SwapQuoteResponse), args.Error(1)
}

func TestGetQuote_Handler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Success", func(t *testing.T) {
		mockService := new(MockService)
		handler := NewHandler(mockService)
		router := gin.New()
		handler.RegisterRoutes(router.Group("/v1"))

		reqBody := SwapQuoteRequest{
			TokenIn:  "0x1",
			TokenOut: "0x2",
			AmountIn: decimal.NewFromInt(10),
		}

		expectedResp := &SwapQuoteResponse{
			AmountOut: decimal.NewFromInt(9),
		}

		mockService.On("GetQuote", mock.MatchedBy(func(req *SwapQuoteRequest) bool {
			return req.TokenIn == reqBody.TokenIn && req.AmountIn.Equal(reqBody.AmountIn)
		})).Return(expectedResp, nil)

		body, _ := json.Marshal(reqBody)
		req, _ := http.NewRequest(http.MethodPost, "/v1/swap/quote", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		resp := httptest.NewRecorder()

		router.ServeHTTP(resp, req)

		assert.Equal(t, http.StatusOK, resp.Code)
		mockService.AssertExpectations(t)
	})

	t.Run("InvalidRequest", func(t *testing.T) {
		mockService := new(MockService)
		handler := NewHandler(mockService)
		router := gin.New()
		handler.RegisterRoutes(router.Group("/v1"))

		req, _ := http.NewRequest(http.MethodPost, "/v1/swap/quote", bytes.NewBufferString("invalid json"))
		req.Header.Set("Content-Type", "application/json")
		resp := httptest.NewRecorder()

		router.ServeHTTP(resp, req)

		assert.Equal(t, http.StatusBadRequest, resp.Code)
	})

	t.Run("PoolNotFound", func(t *testing.T) {
		mockService := new(MockService)
		handler := NewHandler(mockService)
		router := gin.New()
		handler.RegisterRoutes(router.Group("/v1"))

		reqBody := SwapQuoteRequest{
			TokenIn:  "0x1",
			TokenOut: "0x2",
			AmountIn: decimal.NewFromInt(10),
		}

		mockService.On("GetQuote", mock.Anything).Return(nil, errors.New("pool not found for token pair"))

		body, _ := json.Marshal(reqBody)
		req, _ := http.NewRequest(http.MethodPost, "/v1/swap/quote", bytes.NewBuffer(body))
		resp := httptest.NewRecorder()

		router.ServeHTTP(resp, req)

		assert.Equal(t, http.StatusNotFound, resp.Code)
	})

	t.Run("InternalError", func(t *testing.T) {
		mockService := new(MockService)
		handler := NewHandler(mockService)
		router := gin.New()
		handler.RegisterRoutes(router.Group("/v1"))

		reqBody := SwapQuoteRequest{
			TokenIn:  "0x1",
			TokenOut: "0x2",
			AmountIn: decimal.NewFromInt(10),
		}

		mockService.On("GetQuote", mock.Anything).Return(nil, errors.New("unexpected error"))

		body, _ := json.Marshal(reqBody)
		req, _ := http.NewRequest(http.MethodPost, "/v1/swap/quote", bytes.NewBuffer(body))
		resp := httptest.NewRecorder()

		router.ServeHTTP(resp, req)

		assert.Equal(t, http.StatusInternalServerError, resp.Code)
	})
}
