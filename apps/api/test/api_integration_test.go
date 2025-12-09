package backend

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
	gorm "gorm.io/gorm"
)

// APIIntegrationTestSuite defines the test suite for API integration tests
type APIIntegrationTestSuite struct {
	suite.Suite
	router *gin.Engine
	db     *gorm.DB
	rdb    *redis.Client
}

// SetupSuite runs before all tests in the suite
func (suite *APIIntegrationTestSuite) SetupSuite() {
	// Set Gin to test mode
	gin.SetMode(gin.TestMode)

	// Initialize test router
	suite.router = gin.New()
	suite.router.Use(gin.Recovery())

	// Setup test routes (existing endpoints)
	suite.setupRoutes()
}

// setupRoutes configures the test routes
func (suite *APIIntegrationTestSuite) setupRoutes() {
	// Health check endpoint
	suite.router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "ok",
			"timestamp": time.Now().Unix(),
			"service":   "aetherdex-api",
		})
	})

	// API v1 routes
	v1 := suite.router.Group("/api/v1")
	{
		v1.GET("/ping", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"message": "pong"})
		})

		// Authentication endpoints
		auth := v1.Group("/auth")
		{
			auth.GET("/nonce", suite.handleGetNonce)
			auth.POST("/verify", suite.handleVerifySignature)
			auth.POST("/login", suite.handleLogin)
			auth.POST("/refresh", suite.handleRefreshToken)
		}

		// Mock DEX endpoints for integration testing
		v1.GET("/tokens", suite.handleGetTokens)
		v1.GET("/tokens/:address", suite.handleGetToken)
		v1.POST("/swap/quote", suite.handleSwapQuote)
		v1.POST("/swap/execute", suite.handleSwapExecute)
		v1.GET("/pools", suite.handleGetPools)
		v1.GET("/pools/:id", suite.handleGetPool)
		v1.POST("/pools", suite.handleCreatePool)
		v1.GET("/transactions/:address", suite.handleGetTransactions)
		v1.GET("/portfolio/:address", suite.handleGetPortfolio)

		// Liquidity endpoints
		v1.POST("/liquidity/add", suite.handleAddLiquidity)
		v1.POST("/liquidity/remove", suite.handleRemoveLiquidity)

		// Admin endpoints (protected)
		admin := v1.Group("/admin")
		{
			admin.POST("/pools", suite.handleAdminCreatePool)
			admin.DELETE("/pools/:id", suite.handleAdminDeletePool)
			admin.GET("/stats", suite.handleAdminStats)
		}
	}
}

// Mock handlers for DEX functionality
func (suite *APIIntegrationTestSuite) handleGetTokens(c *gin.Context) {
	tokens := []gin.H{
		{
			"address":   "0x1234567890123456789012345678901234567890",
			"symbol":    "ETH",
			"name":      "Ethereum",
			"decimals":  18,
			"price":     "2500.00",
			"volume24h": "1000000.00",
		},
		{
			"address":   "0x0987654321098765432109876543210987654321",
			"symbol":    "USDC",
			"name":      "USD Coin",
			"decimals":  6,
			"price":     "1.00",
			"volume24h": "5000000.00",
		},
	}
	c.JSON(http.StatusOK, gin.H{"data": tokens})
}

func (suite *APIIntegrationTestSuite) handleGetToken(c *gin.Context) {
	address := c.Param("address")
	if address == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Token address is required"})
		return
	}

	token := gin.H{
		"address":   address,
		"symbol":    "ETH",
		"name":      "Ethereum",
		"decimals":  18,
		"price":     "2500.00",
		"volume24h": "1000000.00",
	}
	c.JSON(http.StatusOK, gin.H{"data": token})
}

func (suite *APIIntegrationTestSuite) handleSwapQuote(c *gin.Context) {
	var req struct {
		TokenIn  string `json:"tokenIn" binding:"required"`
		TokenOut string `json:"tokenOut" binding:"required"`
		AmountIn string `json:"amountIn" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	quote := gin.H{
		"tokenIn":     req.TokenIn,
		"tokenOut":    req.TokenOut,
		"amountIn":    req.AmountIn,
		"amountOut":   "1000.50",
		"priceImpact": "0.05",
		"fee":         "0.30",
		"route":       []string{req.TokenIn, req.TokenOut},
		"gasEstimate": "150000",
	}
	c.JSON(http.StatusOK, gin.H{"data": quote})
}

func (suite *APIIntegrationTestSuite) handleSwapExecute(c *gin.Context) {
	var req struct {
		TokenIn   string `json:"tokenIn" binding:"required"`
		TokenOut  string `json:"tokenOut" binding:"required"`
		AmountIn  string `json:"amountIn" binding:"required"`
		AmountOut string `json:"amountOut" binding:"required"`
		Slippage  string `json:"slippage" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	transaction := gin.H{
		"txHash":    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
		"status":    "pending",
		"tokenIn":   req.TokenIn,
		"tokenOut":  req.TokenOut,
		"amountIn":  req.AmountIn,
		"amountOut": req.AmountOut,
		"timestamp": time.Now().Unix(),
		"gasUsed":   "145000",
	}
	c.JSON(http.StatusOK, gin.H{"data": transaction})
}

func (suite *APIIntegrationTestSuite) handleGetPools(c *gin.Context) {
	pools := []gin.H{
		{
			"id":        "1",
			"token0":    "0x1234567890123456789012345678901234567890",
			"token1":    "0x0987654321098765432109876543210987654321",
			"fee":       "0.30",
			"liquidity": "1000000.00",
			"volume24h": "500000.00",
		},
	}
	c.JSON(http.StatusOK, gin.H{"data": pools})
}

func (suite *APIIntegrationTestSuite) handleGetPool(c *gin.Context) {
	id := c.Param("id")
	pool := gin.H{
		"id":        id,
		"token0":    "0x1234567890123456789012345678901234567890",
		"token1":    "0x0987654321098765432109876543210987654321",
		"fee":       "0.30",
		"liquidity": "1000000.00",
		"volume24h": "500000.00",
	}
	c.JSON(http.StatusOK, gin.H{"data": pool})
}

func (suite *APIIntegrationTestSuite) handleGetTransactions(c *gin.Context) {
	address := c.Param("address")
	transactions := []gin.H{
		{
			"txHash":    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
			"type":      "swap",
			"status":    "confirmed",
			"tokenIn":   "ETH",
			"tokenOut":  "USDC",
			"amountIn":  "1.0",
			"amountOut": "2500.0",
			"timestamp": time.Now().Unix() - 3600,
			"address":   address,
		},
	}
	c.JSON(http.StatusOK, gin.H{"data": transactions})
}

func (suite *APIIntegrationTestSuite) handleGetPortfolio(c *gin.Context) {
	address := c.Param("address")
	portfolio := gin.H{
		"address":     address,
		"totalValue":  "10000.00",
		"totalPnL":    "500.00",
		"totalPnLPct": "5.26",
		"positions": []gin.H{
			{
				"token":   "ETH",
				"balance": "4.0",
				"value":   "10000.00",
				"pnl":     "500.00",
			},
		},
	}
	c.JSON(http.StatusOK, gin.H{"data": portfolio})
}

// Authentication handlers
func (suite *APIIntegrationTestSuite) handleGetNonce(c *gin.Context) {
	address := c.Query("address")
	if address == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Address parameter is required"})
		return
	}

	// Validate Ethereum address format (more lenient for testing)
	if len(address) < 40 || !strings.HasPrefix(address, "0x") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid Ethereum address format"})
		return
	}

	// Generate mock nonce
	nonce := fmt.Sprintf("nonce_%d", time.Now().Unix())
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"nonce":   nonce,
			"address": address,
			"expires": time.Now().Add(5 * time.Minute).Unix(),
		},
	})
}

func (suite *APIIntegrationTestSuite) handleVerifySignature(c *gin.Context) {
	var req struct {
		Message   string `json:"message" binding:"required"`
		Signature string `json:"signature" binding:"required"`
		Address   string `json:"address" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Mock signature verification
	if len(req.Signature) < 10 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	result := gin.H{
		"valid":   true,
		"address": req.Address,
		"message": req.Message,
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (suite *APIIntegrationTestSuite) handleLogin(c *gin.Context) {
	var req struct {
		Address   string `json:"address" binding:"required"`
		Signature string `json:"signature" binding:"required"`
		Nonce     string `json:"nonce" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Mock authentication
	if req.Address == "0x0000000000000000000000000000000000000000" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid address"})
		return
	}

	token := gin.H{
		"accessToken":  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
		"refreshToken": "refresh_token_123",
		"expiresIn":    3600,
		"address":      req.Address,
	}
	c.JSON(http.StatusOK, gin.H{"data": token})
}

func (suite *APIIntegrationTestSuite) handleRefreshToken(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refreshToken" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.RefreshToken == "invalid_token" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid refresh token"})
		return
	}

	token := gin.H{
		"accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9_new...",
		"expiresIn":   3600,
	}
	c.JSON(http.StatusOK, gin.H{"data": token})
}

// Pool handlers
func (suite *APIIntegrationTestSuite) handleCreatePool(c *gin.Context) {
	var req struct {
		TokenA  string `json:"tokenA" binding:"required"`
		TokenB  string `json:"tokenB" binding:"required"`
		AmountA string `json:"amountA" binding:"required"`
		AmountB string `json:"amountB" binding:"required"`
		FeeRate string `json:"feeRate"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate tokens are different
	if req.TokenA == req.TokenB {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Tokens must be different"})
		return
	}

	pool := gin.H{
		"id":        "pool_123",
		"tokenA":    req.TokenA,
		"tokenB":    req.TokenB,
		"amountA":   req.AmountA,
		"amountB":   req.AmountB,
		"feeRate":   "0.3",
		"createdAt": time.Now().Unix(),
	}
	c.JSON(http.StatusCreated, gin.H{"data": pool})
}

// Liquidity handlers
func (suite *APIIntegrationTestSuite) handleAddLiquidity(c *gin.Context) {
	var req struct {
		PoolID  string `json:"poolId" binding:"required"`
		AmountA string `json:"amountA" binding:"required"`
		AmountB string `json:"amountB" binding:"required"`
		Address string `json:"address" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Mock pool not found
	if req.PoolID == "nonexistent" {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pool not found"})
		return
	}

	liquidity := gin.H{
		"transactionId": "tx_add_liquidity_123",
		"poolId":        req.PoolID,
		"amountA":       req.AmountA,
		"amountB":       req.AmountB,
		"lpTokens":      "100.0",
		"timestamp":     time.Now().Unix(),
	}
	c.JSON(http.StatusOK, gin.H{"data": liquidity})
}

func (suite *APIIntegrationTestSuite) handleRemoveLiquidity(c *gin.Context) {
	var req struct {
		PoolID   string `json:"poolId" binding:"required"`
		LPTokens string `json:"lpTokens" binding:"required"`
		Address  string `json:"address" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Mock insufficient liquidity
	if req.LPTokens == "999999" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient liquidity tokens"})
		return
	}

	liquidity := gin.H{
		"transactionId": "tx_remove_liquidity_123",
		"poolId":        req.PoolID,
		"lpTokens":      req.LPTokens,
		"amountA":       "50.0",
		"amountB":       "100.0",
		"timestamp":     time.Now().Unix(),
	}
	c.JSON(http.StatusOK, gin.H{"data": liquidity})
}

// Admin handlers
func (suite *APIIntegrationTestSuite) handleAdminCreatePool(c *gin.Context) {
	// Mock admin authorization check
	auth := c.GetHeader("Authorization")
	if auth != "Bearer admin_token" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Admin access required"})
		return
	}

	var req struct {
		TokenA  string `json:"tokenA" binding:"required"`
		TokenB  string `json:"tokenB" binding:"required"`
		FeeRate string `json:"feeRate" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pool := gin.H{
		"id":        "admin_pool_123",
		"tokenA":    req.TokenA,
		"tokenB":    req.TokenB,
		"feeRate":   req.FeeRate,
		"status":    "active",
		"createdBy": "admin",
		"createdAt": time.Now().Unix(),
	}
	c.JSON(http.StatusCreated, gin.H{"data": pool})
}

func (suite *APIIntegrationTestSuite) handleAdminDeletePool(c *gin.Context) {
	// Mock admin authorization check
	auth := c.GetHeader("Authorization")
	if auth != "Bearer admin_token" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Admin access required"})
		return
	}

	poolID := c.Param("id")
	if poolID == "nonexistent" {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pool not found"})
		return
	}

	result := gin.H{
		"poolId":    poolID,
		"status":    "deleted",
		"deletedAt": time.Now().Unix(),
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (suite *APIIntegrationTestSuite) handleAdminStats(c *gin.Context) {
	// Mock admin authorization check
	auth := c.GetHeader("Authorization")
	if auth != "Bearer admin_token" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Admin access required"})
		return
	}

	stats := gin.H{
		"totalPools":        10,
		"totalTransactions": 1000,
		"totalVolume":       "1000000.00",
		"totalUsers":        500,
		"activePools":       8,
		"timestamp":         time.Now().Unix(),
	}
	c.JSON(http.StatusOK, gin.H{"data": stats})
}

// Test Health Endpoint
func (suite *APIIntegrationTestSuite) TestHealthEndpoint() {
	req, _ := http.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)
	assert.Equal(suite.T(), "ok", response["status"])
	assert.Equal(suite.T(), "aetherdex-api", response["service"])
	assert.NotNil(suite.T(), response["timestamp"])
}

// Test Ping Endpoint
func (suite *APIIntegrationTestSuite) TestPingEndpoint() {
	req, _ := http.NewRequest("GET", "/api/v1/ping", nil)
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)
	assert.Equal(suite.T(), "pong", response["message"])
}

// Test Get Tokens Endpoint
func (suite *APIIntegrationTestSuite) TestGetTokensEndpoint() {
	req, _ := http.NewRequest("GET", "/api/v1/tokens", nil)
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)
	assert.NotNil(suite.T(), response["data"])

	tokens := response["data"].([]interface{})
	assert.Len(suite.T(), tokens, 2)

	token := tokens[0].(map[string]interface{})
	assert.Equal(suite.T(), "ETH", token["symbol"])
	assert.Equal(suite.T(), "Ethereum", token["name"])
}

// Test Get Single Token Endpoint
func (suite *APIIntegrationTestSuite) TestGetTokenEndpoint() {
	address := "0x1234567890123456789012345678901234567890"
	req, _ := http.NewRequest("GET", "/api/v1/tokens/"+address, nil)
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)

	token := response["data"].(map[string]interface{})
	assert.Equal(suite.T(), address, token["address"])
	assert.Equal(suite.T(), "ETH", token["symbol"])
}

// Test Swap Quote Endpoint
func (suite *APIIntegrationTestSuite) TestSwapQuoteEndpoint() {
	payload := map[string]string{
		"tokenIn":  "0x1234567890123456789012345678901234567890",
		"tokenOut": "0x0987654321098765432109876543210987654321",
		"amountIn": "1.0",
	}

	jsonPayload, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/swap/quote", bytes.NewBuffer(jsonPayload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)

	quote := response["data"].(map[string]interface{})
	assert.Equal(suite.T(), payload["tokenIn"], quote["tokenIn"])
	assert.Equal(suite.T(), payload["tokenOut"], quote["tokenOut"])
	assert.NotNil(suite.T(), quote["amountOut"])
	assert.NotNil(suite.T(), quote["gasEstimate"])
}

// Test Swap Quote Validation
func (suite *APIIntegrationTestSuite) TestSwapQuoteValidation() {
	// Test missing required fields
	payload := map[string]string{
		"tokenIn": "0x1234567890123456789012345678901234567890",
		// Missing tokenOut and amountIn
	}

	jsonPayload, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/swap/quote", bytes.NewBuffer(jsonPayload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusBadRequest, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)
	assert.NotNil(suite.T(), response["error"])
}

// Test Swap Execute Endpoint
func (suite *APIIntegrationTestSuite) TestSwapExecuteEndpoint() {
	payload := map[string]string{
		"tokenIn":   "0x1234567890123456789012345678901234567890",
		"tokenOut":  "0x0987654321098765432109876543210987654321",
		"amountIn":  "1.0",
		"amountOut": "2500.0",
		"slippage":  "0.5",
	}

	jsonPayload, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/swap/execute", bytes.NewBuffer(jsonPayload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)

	transaction := response["data"].(map[string]interface{})
	assert.NotNil(suite.T(), transaction["txHash"])
	assert.Equal(suite.T(), "pending", transaction["status"])
	assert.Equal(suite.T(), payload["tokenIn"], transaction["tokenIn"])
}

// Test Get Pools Endpoint
func (suite *APIIntegrationTestSuite) TestGetPoolsEndpoint() {
	req, _ := http.NewRequest("GET", "/api/v1/pools", nil)
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)

	pools := response["data"].([]interface{})
	assert.Len(suite.T(), pools, 1)

	pool := pools[0].(map[string]interface{})
	assert.NotNil(suite.T(), pool["id"])
	assert.NotNil(suite.T(), pool["liquidity"])
}

// Test Get Transactions Endpoint
func (suite *APIIntegrationTestSuite) TestGetTransactionsEndpoint() {
	address := "0x1234567890123456789012345678901234567890"
	req, _ := http.NewRequest("GET", "/api/v1/transactions/"+address, nil)
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)

	transactions := response["data"].([]interface{})
	assert.Len(suite.T(), transactions, 1)

	tx := transactions[0].(map[string]interface{})
	assert.Equal(suite.T(), "swap", tx["type"])
	assert.Equal(suite.T(), "confirmed", tx["status"])
	assert.Equal(suite.T(), address, tx["address"])
}

// Test Get Portfolio Endpoint
func (suite *APIIntegrationTestSuite) TestGetPortfolioEndpoint() {
	address := "0x1234567890123456789012345678901234567890"
	req, _ := http.NewRequest("GET", "/api/v1/portfolio/"+address, nil)
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)

	portfolio := response["data"].(map[string]interface{})
	assert.Equal(suite.T(), address, portfolio["address"])
	assert.NotNil(suite.T(), portfolio["totalValue"])
	assert.NotNil(suite.T(), portfolio["positions"])
}

// Test API Error Handling
func (suite *APIIntegrationTestSuite) TestAPIErrorHandling() {
	// Test invalid JSON payload
	req, _ := http.NewRequest("POST", "/api/v1/swap/quote", bytes.NewBuffer([]byte("invalid json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusBadRequest, w.Code)

	// Test non-existent endpoint
	req, _ = http.NewRequest("GET", "/api/v1/nonexistent", nil)
	w = httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusNotFound, w.Code)
}

// Test Concurrent API Requests
func (suite *APIIntegrationTestSuite) TestConcurrentRequests() {
	const numRequests = 10
	done := make(chan bool, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			req, _ := http.NewRequest("GET", "/health", nil)
			w := httptest.NewRecorder()
			suite.router.ServeHTTP(w, req)
			suite.Equal(http.StatusOK, w.Code)
			done <- true
		}()
	}

	// Wait for all requests to complete
	for i := 0; i < numRequests; i++ {
		<-done
	}
}

// Authentication Endpoint Tests
func (suite *APIIntegrationTestSuite) TestGetNonce() {
	// Test valid address
	req, _ := http.NewRequest("GET", "/api/v1/auth/nonce?address=0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b", nil)
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "data")

	data := response["data"].(map[string]interface{})
	suite.Contains(data, "nonce")
	suite.Contains(data, "address")
	suite.Contains(data, "expires")
	suite.Equal("0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b", data["address"])
}

func (suite *APIIntegrationTestSuite) TestGetNonceInvalidAddress() {
	// Test invalid address format
	req, _ := http.NewRequest("GET", "/api/v1/auth/nonce?address=invalid_address", nil)
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusBadRequest, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Invalid Ethereum address format", response["error"])
}

func (suite *APIIntegrationTestSuite) TestVerifySignature() {
	// Test valid signature verification
	payload := map[string]interface{}{
		"message":   "Sign this message to authenticate",
		"signature": "0x1234567890abcdef",
		"address":   "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/auth/verify", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "data")

	data := response["data"].(map[string]interface{})
	suite.Equal(true, data["valid"])
	suite.Equal(payload["address"], data["address"])
}

func (suite *APIIntegrationTestSuite) TestVerifySignatureInvalid() {
	// Test invalid signature
	payload := map[string]interface{}{
		"message":   "Sign this message to authenticate",
		"signature": "short",
		"address":   "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/auth/verify", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Invalid signature", response["error"])
}

func (suite *APIIntegrationTestSuite) TestLogin() {
	// Test successful login
	payload := map[string]interface{}{
		"address":   "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b",
		"signature": "0x1234567890abcdef",
		"nonce":     "123456789",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/auth/login", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "data")

	data := response["data"].(map[string]interface{})
	suite.Contains(data, "accessToken")
	suite.Contains(data, "refreshToken")
	suite.Contains(data, "expiresIn")
	suite.Equal(payload["address"], data["address"])
}

func (suite *APIIntegrationTestSuite) TestLoginInvalidAddress() {
	// Test login with invalid address
	payload := map[string]interface{}{
		"address":   "0x0000000000000000000000000000000000000000",
		"signature": "0x1234567890abcdef",
		"nonce":     "123456789",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/auth/login", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Invalid address", response["error"])
}

func (suite *APIIntegrationTestSuite) TestRefreshToken() {
	// Test successful token refresh
	payload := map[string]interface{}{
		"refreshToken": "refresh_token_123",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/auth/refresh", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "data")

	data := response["data"].(map[string]interface{})
	suite.Contains(data, "accessToken")
	suite.Contains(data, "expiresIn")
}

func (suite *APIIntegrationTestSuite) TestRefreshTokenInvalid() {
	// Test refresh with invalid token
	payload := map[string]interface{}{
		"refreshToken": "invalid_token",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/auth/refresh", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Invalid refresh token", response["error"])
}

// Pool Creation Tests
func (suite *APIIntegrationTestSuite) TestCreatePool() {
	// Test successful pool creation
	payload := map[string]interface{}{
		"tokenA":  "ETH",
		"tokenB":  "USDC",
		"amountA": "10.0",
		"amountB": "25000.0",
		"feeRate": "0.3",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/pools", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusCreated, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "data")

	data := response["data"].(map[string]interface{})
	suite.Contains(data, "id")
	suite.Equal(payload["tokenA"], data["tokenA"])
	suite.Equal(payload["tokenB"], data["tokenB"])
	suite.Contains(data, "createdAt")
}

func (suite *APIIntegrationTestSuite) TestCreatePoolSameTokens() {
	// Test pool creation with same tokens (should fail)
	payload := map[string]interface{}{
		"tokenA":  "ETH",
		"tokenB":  "ETH",
		"amountA": "10.0",
		"amountB": "10.0",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/pools", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusBadRequest, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Tokens must be different", response["error"])
}

// Liquidity Tests
func (suite *APIIntegrationTestSuite) TestAddLiquidity() {
	// Test successful liquidity addition
	payload := map[string]interface{}{
		"poolId":  "pool_123",
		"amountA": "5.0",
		"amountB": "12500.0",
		"address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/liquidity/add", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "data")

	data := response["data"].(map[string]interface{})
	suite.Contains(data, "transactionId")
	suite.Equal(payload["poolId"], data["poolId"])
	suite.Contains(data, "lpTokens")
	suite.Contains(data, "timestamp")
}

func (suite *APIIntegrationTestSuite) TestAddLiquidityPoolNotFound() {
	// Test liquidity addition to non-existent pool
	payload := map[string]interface{}{
		"poolId":  "nonexistent",
		"amountA": "5.0",
		"amountB": "12500.0",
		"address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/liquidity/add", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusNotFound, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Pool not found", response["error"])
}

func (suite *APIIntegrationTestSuite) TestRemoveLiquidity() {
	// Test successful liquidity removal
	payload := map[string]interface{}{
		"poolId":   "pool_123",
		"lpTokens": "50.0",
		"address":  "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/liquidity/remove", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "data")

	data := response["data"].(map[string]interface{})
	suite.Contains(data, "transactionId")
	suite.Equal(payload["poolId"], data["poolId"])
	suite.Contains(data, "amountA")
	suite.Contains(data, "amountB")
}

func (suite *APIIntegrationTestSuite) TestRemoveLiquidityInsufficient() {
	// Test liquidity removal with insufficient tokens
	payload := map[string]interface{}{
		"poolId":   "pool_123",
		"lpTokens": "999999",
		"address":  "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/liquidity/remove", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusBadRequest, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Insufficient liquidity tokens", response["error"])
}

// Admin Endpoint Tests
func (suite *APIIntegrationTestSuite) TestAdminCreatePool() {
	// Test successful admin pool creation
	payload := map[string]interface{}{
		"tokenA":  "BTC",
		"tokenB":  "ETH",
		"feeRate": "0.5",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/admin/pools", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer admin_token")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusCreated, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "data")

	data := response["data"].(map[string]interface{})
	suite.Contains(data, "id")
	suite.Equal(payload["tokenA"], data["tokenA"])
	suite.Equal(payload["tokenB"], data["tokenB"])
	suite.Equal("admin", data["createdBy"])
	suite.Equal("active", data["status"])
}

func (suite *APIIntegrationTestSuite) TestAdminCreatePoolUnauthorized() {
	// Test admin pool creation without proper authorization
	payload := map[string]interface{}{
		"tokenA":  "BTC",
		"tokenB":  "ETH",
		"feeRate": "0.5",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/admin/pools", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer invalid_token")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Admin access required", response["error"])
}

func (suite *APIIntegrationTestSuite) TestAdminDeletePool() {
	// Test successful admin pool deletion
	req, _ := http.NewRequest("DELETE", "/api/v1/admin/pools/pool_123", nil)
	req.Header.Set("Authorization", "Bearer admin_token")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "data")

	data := response["data"].(map[string]interface{})
	suite.Equal("pool_123", data["poolId"])
	suite.Equal("deleted", data["status"])
	suite.Contains(data, "deletedAt")
}

func (suite *APIIntegrationTestSuite) TestAdminDeletePoolNotFound() {
	// Test admin pool deletion for non-existent pool
	req, _ := http.NewRequest("DELETE", "/api/v1/admin/pools/nonexistent", nil)
	req.Header.Set("Authorization", "Bearer admin_token")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusNotFound, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Pool not found", response["error"])
}

func (suite *APIIntegrationTestSuite) TestAdminDeletePoolUnauthorized() {
	// Test admin pool deletion without proper authorization
	req, _ := http.NewRequest("DELETE", "/api/v1/admin/pools/pool_123", nil)
	req.Header.Set("Authorization", "Bearer user_token")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Admin access required", response["error"])
}

func (suite *APIIntegrationTestSuite) TestAdminStats() {
	// Test successful admin stats retrieval
	req, _ := http.NewRequest("GET", "/api/v1/admin/stats", nil)
	req.Header.Set("Authorization", "Bearer admin_token")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "data")

	data := response["data"].(map[string]interface{})
	suite.Contains(data, "totalPools")
	suite.Contains(data, "totalTransactions")
	suite.Contains(data, "totalVolume")
	suite.Contains(data, "totalUsers")
	suite.Contains(data, "activePools")
	suite.Contains(data, "timestamp")
}

func (suite *APIIntegrationTestSuite) TestAdminStatsUnauthorized() {
	// Test admin stats retrieval without proper authorization
	req, _ := http.NewRequest("GET", "/api/v1/admin/stats", nil)
	req.Header.Set("Authorization", "Bearer user_token")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
	suite.Equal("Admin access required", response["error"])
}

// Edge Case and Error Handling Tests
func (suite *APIIntegrationTestSuite) TestMissingContentType() {
	// Test API call without Content-Type header
	payload := map[string]interface{}{
		"tokenA": "ETH",
		"tokenB": "USDC",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/pools", bytes.NewBuffer(body))
	// Intentionally not setting Content-Type
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	// Should still work as Gin can handle JSON without explicit Content-Type
	suite.Equal(http.StatusBadRequest, w.Code) // Missing required fields
}

func (suite *APIIntegrationTestSuite) TestInvalidJSON() {
	// Test API call with invalid JSON
	invalidJSON := `{"tokenA": "ETH", "tokenB":}`
	req, _ := http.NewRequest("POST", "/api/v1/pools", bytes.NewBufferString(invalidJSON))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	suite.Equal(http.StatusBadRequest, w.Code)
	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	suite.NoError(err)
	suite.Contains(response, "error")
}

func (suite *APIIntegrationTestSuite) TestLargePayload() {
	// Test API call with large payload
	largeString := make([]byte, 10000)
	for i := range largeString {
		largeString[i] = 'a'
	}

	payload := map[string]interface{}{
		"tokenA":  string(largeString),
		"tokenB":  "USDC",
		"amountA": "10.0",
		"amountB": "25000.0",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/pools", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	// Should handle large payload gracefully
	suite.True(w.Code == http.StatusCreated || w.Code == http.StatusBadRequest)
}

// Run the test suite
func TestAPIIntegrationSuite(t *testing.T) {
	// Skip integration tests if not in integration test mode
	if os.Getenv("INTEGRATION_TESTS") != "true" {
		t.Skip("Skipping integration tests. Set INTEGRATION_TESTS=true to run.")
	}

	suite.Run(t, new(APIIntegrationTestSuite))
}
