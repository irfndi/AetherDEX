package auth

import (
	"crypto/ecdsa"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
)

// MockAuthMiddleware extends AuthMiddleware for testing
type MockAuthMiddleware struct {
	*AuthMiddleware
	mockGetUserRoles func(address string) []string
}

// Override getUserRoles for testing
func (m *MockAuthMiddleware) getUserRoles(address string) []string {
	if m.mockGetUserRoles != nil {
		return m.mockGetUserRoles(address)
	}
	return []string{"user"}
}

// RequireRole override to use the mock getUserRoles
func (m *MockAuthMiddleware) RequireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userAddress, exists := c.Get("user_address")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "User not authenticated",
				"code":  "USER_NOT_AUTHENTICATED",
			})
			c.Abort()
			return
		}

		// Check user roles using the mock function
		userRoles := m.getUserRoles(userAddress.(string))
		hasRole := false
		for _, requiredRole := range roles {
			for _, userRole := range userRoles {
				if userRole == requiredRole {
					hasRole = true
					break
				}
			}
			if hasRole {
				break
			}
		}

		if !hasRole {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "Insufficient permissions",
				"code":  "INSUFFICIENT_PERMISSIONS",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// AuthMiddlewareTestSuite provides comprehensive tests for authentication middleware
type AuthMiddlewareTestSuite struct {
	suite.Suite
	middleware *MockAuthMiddleware
	router     *gin.Engine
	privateKey *ecdsa.PrivateKey
	address    string
}

// SetupSuite initializes the test suite
func (suite *AuthMiddlewareTestSuite) SetupSuite() {
	gin.SetMode(gin.TestMode)

	// Generate test private key
	privateKey, err := crypto.GenerateKey()
	suite.Require().NoError(err)
	suite.privateKey = privateKey
	suite.address = crypto.PubkeyToAddress(privateKey.PublicKey).Hex()

	// Initialize middleware with mock
	baseMiddleware := NewAuthMiddleware()
	suite.middleware = &MockAuthMiddleware{
		AuthMiddleware: baseMiddleware,
		mockGetUserRoles: func(address string) []string {
			return []string{"user"}
		},
	}

	// Setup router
	suite.router = gin.New()
	suite.setupRoutes()
}

// SetupTest runs before each test
func (suite *AuthMiddlewareTestSuite) SetupTest() {
	// Clear nonce store for each test (with proper locking)
	suite.middleware.nonceMu.Lock()
	suite.middleware.nonceStore = make(map[string]time.Time)
	suite.middleware.nonceMu.Unlock()
}

// setupRoutes configures test routes
func (suite *AuthMiddlewareTestSuite) setupRoutes() {
	// Public routes
	suite.router.GET("/public", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "public"})
	})

	// Protected routes
	protected := suite.router.Group("/protected")
	protected.Use(suite.middleware.RequireAuth())
	{
		protected.GET("/user", func(c *gin.Context) {
			address := c.GetString("user_address")
			c.JSON(http.StatusOK, gin.H{"address": address})
		})
	}

	// Role-based routes
	admin := suite.router.Group("/admin")
	admin.Use(suite.middleware.RequireAuth())
	admin.Use(suite.middleware.RequireRole("admin"))
	{
		admin.GET("/dashboard", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"message": "admin dashboard"})
		})
	}

	// Rate limited routes
	limited := suite.router.Group("/limited")
	limited.Use(suite.middleware.RequireAuth())
	limited.Use(suite.middleware.RateLimitByAddress(10))
	{
		limited.GET("/api", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"message": "rate limited"})
		})
	}

	// Security headers test route
	suite.router.Use(SecurityHeaders())
	suite.router.GET("/secure", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "secure"})
	})

	// CORS test route
	suite.router.Use(SecureCORS())
	suite.router.OPTIONS("/cors", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
}

// generateValidToken creates a valid authentication token
func (suite *AuthMiddlewareTestSuite) generateValidToken() string {
	nonce := fmt.Sprintf("test-nonce-%d", time.Now().UnixNano())
	timestamp := time.Now().Unix()
	message := fmt.Sprintf("AetherDEX Auth:%s:%d", nonce, timestamp)

	// Sign message
	prefixedMessage := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)
	hash := crypto.Keccak256Hash([]byte(prefixedMessage))
	signature, err := crypto.Sign(hash.Bytes(), suite.privateKey)
	suite.Require().NoError(err)

	// Format token
	signatureHex := hex.EncodeToString(signature)
	token := fmt.Sprintf("%s:%s:%d:%s", signatureHex, nonce, timestamp, suite.address)
	return token
}

// generateInvalidToken creates an invalid authentication token
func (suite *AuthMiddlewareTestSuite) generateInvalidToken(invalidType string) string {
	nonce := fmt.Sprintf("test-nonce-%d", time.Now().UnixNano())
	timestamp := time.Now().Unix()

	switch invalidType {
	case "expired":
		timestamp = time.Now().Unix() - 400 // 400 seconds ago (expired)
	case "future":
		timestamp = time.Now().Unix() + 120 // 120 seconds in future
	case "invalid_signature":
		return fmt.Sprintf("invalid_signature:%s:%d:%s", nonce, timestamp, suite.address)
	case "invalid_address":
		return fmt.Sprintf("signature:%s:%d:invalid_address", nonce, timestamp)
	case "malformed":
		return "malformed:token"
	default:
		return suite.generateValidToken()
	}

	message := fmt.Sprintf("AetherDEX Auth:%s:%d", nonce, timestamp)
	prefixedMessage := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)
	hash := crypto.Keccak256Hash([]byte(prefixedMessage))
	signature, _ := crypto.Sign(hash.Bytes(), suite.privateKey)
	signatureHex := hex.EncodeToString(signature)

	return fmt.Sprintf("%s:%s:%d:%s", signatureHex, nonce, timestamp, suite.address)
}

// TestRequireAuth_ValidToken tests authentication with valid token
func (suite *AuthMiddlewareTestSuite) TestRequireAuth_ValidToken() {
	token := suite.generateValidToken()

	req := httptest.NewRequest("GET", "/protected/user", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)
	assert.Equal(suite.T(), strings.ToLower(suite.address), strings.ToLower(response["address"].(string)))
}

// TestRequireAuth_MissingHeader tests authentication without header
func (suite *AuthMiddlewareTestSuite) TestRequireAuth_MissingHeader() {
	req := httptest.NewRequest("GET", "/protected/user", nil)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusUnauthorized, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)
	assert.Equal(suite.T(), "AUTH_HEADER_MISSING", response["code"])
}

// TestRequireAuth_InvalidFormat tests authentication with invalid format
func (suite *AuthMiddlewareTestSuite) TestRequireAuth_InvalidFormat() {
	req := httptest.NewRequest("GET", "/protected/user", nil)
	req.Header.Set("Authorization", "Invalid token")
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusUnauthorized, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)
	assert.Equal(suite.T(), "INVALID_AUTH_FORMAT", response["code"])
}

// TestRequireAuth_ExpiredToken tests authentication with expired token
func (suite *AuthMiddlewareTestSuite) TestRequireAuth_ExpiredToken() {
	token := suite.generateInvalidToken("expired")

	req := httptest.NewRequest("GET", "/protected/user", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusUnauthorized, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)
	assert.Equal(suite.T(), "AUTH_FAILED", response["code"])
}

// TestRequireAuth_FutureToken tests authentication with future timestamp
func (suite *AuthMiddlewareTestSuite) TestRequireAuth_FutureToken() {
	token := suite.generateInvalidToken("future")

	req := httptest.NewRequest("GET", "/protected/user", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusUnauthorized, w.Code)
}

// TestRequireAuth_InvalidSignature tests authentication with invalid signature
func (suite *AuthMiddlewareTestSuite) TestRequireAuth_InvalidSignature() {
	token := suite.generateInvalidToken("invalid_signature")

	req := httptest.NewRequest("GET", "/protected/user", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusUnauthorized, w.Code)
}

// TestRequireAuth_InvalidAddress tests authentication with invalid address
func (suite *AuthMiddlewareTestSuite) TestRequireAuth_InvalidAddress() {
	token := suite.generateInvalidToken("invalid_address")

	req := httptest.NewRequest("GET", "/protected/user", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusUnauthorized, w.Code)
}

// TestRequireAuth_MalformedToken tests authentication with malformed token
func (suite *AuthMiddlewareTestSuite) TestRequireAuth_MalformedToken() {
	token := suite.generateInvalidToken("malformed")

	req := httptest.NewRequest("GET", "/protected/user", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusUnauthorized, w.Code)
}

// TestNonceReplay tests nonce replay attack prevention
func (suite *AuthMiddlewareTestSuite) TestNonceReplay() {
	token := suite.generateValidToken()

	// First request should succeed
	req1 := httptest.NewRequest("GET", "/protected/user", nil)
	req1.Header.Set("Authorization", "Bearer "+token)
	w1 := httptest.NewRecorder()
	suite.router.ServeHTTP(w1, req1)
	assert.Equal(suite.T(), http.StatusOK, w1.Code)

	// Second request with same token should fail
	req2 := httptest.NewRequest("GET", "/protected/user", nil)
	req2.Header.Set("Authorization", "Bearer "+token)
	w2 := httptest.NewRecorder()
	suite.router.ServeHTTP(w2, req2)
	assert.Equal(suite.T(), http.StatusUnauthorized, w2.Code)
}

// TestRequireRole_ValidRole tests role-based access control with valid role
func (suite *AuthMiddlewareTestSuite) TestRequireRole_ValidRole() {
	// Set up mock to return admin role
	suite.middleware.mockGetUserRoles = func(address string) []string {
		return []string{"admin", "user"}
	}

	token := suite.generateValidToken()

	req := httptest.NewRequest("GET", "/admin/dashboard", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)
}

// TestRequireRole_InsufficientRole tests role-based access control with insufficient role
func (suite *AuthMiddlewareTestSuite) TestRequireRole_InsufficientRole() {
	// Set up mock to return user role (not admin)
	suite.middleware.mockGetUserRoles = func(address string) []string {
		return []string{"user"}
	}

	token := suite.generateValidToken()

	req := httptest.NewRequest("GET", "/admin/dashboard", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusForbidden, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(suite.T(), err)
	assert.Equal(suite.T(), "INSUFFICIENT_PERMISSIONS", response["code"])
}

// TestRequireRole_UnauthenticatedUser tests role check without authentication
func (suite *AuthMiddlewareTestSuite) TestRequireRole_UnauthenticatedUser() {
	req := httptest.NewRequest("GET", "/admin/dashboard", nil)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusUnauthorized, w.Code)
}

// TestRateLimitByAddress tests rate limiting functionality
func (suite *AuthMiddlewareTestSuite) TestRateLimitByAddress() {
	token := suite.generateValidToken()

	req := httptest.NewRequest("GET", "/limited/api", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	// Rate limiting is placeholder, so request should succeed
	assert.Equal(suite.T(), http.StatusOK, w.Code)
}

// TestSecurityHeaders tests security headers middleware
func (suite *AuthMiddlewareTestSuite) TestSecurityHeaders() {
	req := httptest.NewRequest("GET", "/secure", nil)
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusOK, w.Code)
	assert.Equal(suite.T(), "nosniff", w.Header().Get("X-Content-Type-Options"))
	assert.Equal(suite.T(), "DENY", w.Header().Get("X-Frame-Options"))
	assert.Equal(suite.T(), "1; mode=block", w.Header().Get("X-XSS-Protection"))
	assert.Contains(suite.T(), w.Header().Get("Strict-Transport-Security"), "max-age=31536000")
	assert.Equal(suite.T(), "default-src 'self'", w.Header().Get("Content-Security-Policy"))
	assert.Equal(suite.T(), "strict-origin-when-cross-origin", w.Header().Get("Referrer-Policy"))
}

// TestSecureCORS tests CORS middleware with allowed origin
func (suite *AuthMiddlewareTestSuite) TestSecureCORS_AllowedOrigin() {
	req := httptest.NewRequest("OPTIONS", "/cors", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusNoContent, w.Code)
	assert.Equal(suite.T(), "http://localhost:3000", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(suite.T(), w.Header().Get("Access-Control-Allow-Methods"), "GET")
	assert.Contains(suite.T(), w.Header().Get("Access-Control-Allow-Headers"), "Authorization")
}

// TestSecureCORS tests CORS middleware with disallowed origin
func (suite *AuthMiddlewareTestSuite) TestSecureCORS_DisallowedOrigin() {
	req := httptest.NewRequest("OPTIONS", "/cors", nil)
	req.Header.Set("Origin", "http://malicious-site.com")
	w := httptest.NewRecorder()

	suite.router.ServeHTTP(w, req)

	assert.Equal(suite.T(), http.StatusNoContent, w.Code)
	assert.Empty(suite.T(), w.Header().Get("Access-Control-Allow-Origin"))
}

// TestRealRequireRole tests the real RequireRole and getUserRoles implementation
func (suite *AuthMiddlewareTestSuite) TestRealRequireRole() {
	// Create a new router with the REAL middleware (not the mock)
	router := gin.New()
	realMiddleware := NewAuthMiddleware()

	router.GET("/real-protected", realMiddleware.RequireAuth(), realMiddleware.RequireRole("trader"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	token := suite.generateValidToken()

	req := httptest.NewRequest("GET", "/real-protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// getUserRoles returns "user", "trader" by default, so "trader" should pass
	assert.Equal(suite.T(), http.StatusOK, w.Code)
}

// TestRealRequireRole_Forbidden tests the real RequireRole with missing role
func (suite *AuthMiddlewareTestSuite) TestRealRequireRole_Forbidden() {
	router := gin.New()
	realMiddleware := NewAuthMiddleware()

	router.GET("/real-admin", realMiddleware.RequireAuth(), realMiddleware.RequireRole("admin"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	token := suite.generateValidToken()

	req := httptest.NewRequest("GET", "/real-admin", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	// getUserRoles returns "user", "trader" by default, so "admin" should fail
	assert.Equal(suite.T(), http.StatusForbidden, w.Code)
}

// TestValidateSignatureRequest tests signature request validation
func (suite *AuthMiddlewareTestSuite) TestValidateSignatureRequest() {
	tests := []struct {
		name        string
		request     AuthRequest
		expectError bool
	}{
		{
			name: "valid request",
			request: AuthRequest{
				Message:   "Test message",
				Signature: "0x" + strings.Repeat("a", 130),
				Address:   "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
				Nonce:     "test-nonce",
				Timestamp: time.Now().Unix(),
			},
			expectError: false,
		},
		{
			name: "invalid address",
			request: AuthRequest{
				Message:   "Test message",
				Signature: "0x" + strings.Repeat("a", 130),
				Address:   "invalid-address",
				Nonce:     "test-nonce",
				Timestamp: time.Now().Unix(),
			},
			expectError: true,
		},
		{
			name: "invalid signature format",
			request: AuthRequest{
				Message:   "Test message",
				Signature: "invalid-signature",
				Address:   "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
				Nonce:     "test-nonce",
				Timestamp: time.Now().Unix(),
			},
			expectError: true,
		},
		{
			name: "expired timestamp",
			request: AuthRequest{
				Message:   "Test message",
				Signature: "0x" + strings.Repeat("a", 130),
				Address:   "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
				Nonce:     "test-nonce",
				Timestamp: time.Now().Unix() - 400,
			},
			expectError: true,
		},
		{
			name: "empty nonce",
			request: AuthRequest{
				Message:   "Test message",
				Signature: "0x" + strings.Repeat("a", 130),
				Address:   "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
				Nonce:     "",
				Timestamp: time.Now().Unix(),
			},
			expectError: true,
		},
		{
			name: "empty message",
			request: AuthRequest{
				Message:   "",
				Signature: "0x" + strings.Repeat("a", 130),
				Address:   "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
				Nonce:     "test-nonce",
				Timestamp: time.Now().Unix(),
			},
			expectError: true,
		},
	}

	for _, tt := range tests {
		suite.T().Run(tt.name, func(t *testing.T) {
			err := ValidateSignatureRequest(tt.request)
			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestEthereumSignatureVerification tests Ethereum signature verification
func (suite *AuthMiddlewareTestSuite) TestEthereumSignatureVerification() {
	message := "Test message for signature verification"

	// Create signature
	prefixedMessage := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)
	hash := crypto.Keccak256Hash([]byte(prefixedMessage))
	signature, err := crypto.Sign(hash.Bytes(), suite.privateKey)
	suite.Require().NoError(err)

	signatureHex := "0x" + hex.EncodeToString(signature)

	// Test valid signature
	err = suite.middleware.verifyEthereumSignature(message, signatureHex, suite.address)
	assert.NoError(suite.T(), err)

	// Test invalid signature
	err = suite.middleware.verifyEthereumSignature(message, "0xinvalid", suite.address)
	assert.Error(suite.T(), err)

	// Test wrong address
	otherKey, _ := crypto.GenerateKey()
	otherAddress := crypto.PubkeyToAddress(otherKey.PublicKey).Hex()
	err = suite.middleware.verifyEthereumSignature(message, signatureHex, otherAddress)
	assert.Error(suite.T(), err)
}

// TestCleanupExpiredNonces tests nonce cleanup functionality
func (suite *AuthMiddlewareTestSuite) TestCleanupExpiredNonces() {
	// Add expired nonce
	expiredTime := time.Now().Add(-10 * time.Minute)
	suite.middleware.nonceMu.Lock()
	suite.middleware.nonceStore["expired-nonce"] = expiredTime
	suite.middleware.nonceMu.Unlock()

	// Add valid nonce
	validTime := time.Now().Add(-1 * time.Minute)
	suite.middleware.nonceMu.Lock()
	suite.middleware.nonceStore["valid-nonce"] = validTime
	suite.middleware.nonceMu.Unlock()

	// Run cleanup
	suite.middleware.cleanupExpiredNonces()

	// Check results
	suite.middleware.nonceMu.RLock()
	_, expiredExists := suite.middleware.nonceStore["expired-nonce"]
	_, validExists := suite.middleware.nonceStore["valid-nonce"]
	suite.middleware.nonceMu.RUnlock()

	assert.False(suite.T(), expiredExists, "Expired nonce should be removed")
	assert.True(suite.T(), validExists, "Valid nonce should remain")
}

// TestConcurrentNonceAccess tests concurrent access to nonce store
func (suite *AuthMiddlewareTestSuite) TestConcurrentNonceAccess() {
	// This test ensures thread safety of nonce operations
	done := make(chan bool, 10)

	for i := 0; i < 10; i++ {
		go func(id int) {
			nonce := fmt.Sprintf("concurrent-nonce-%d", id)
			suite.middleware.nonceMu.Lock()
			suite.middleware.nonceStore[nonce] = time.Now()
			suite.middleware.nonceMu.Unlock()
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify all nonces were stored
	suite.middleware.nonceMu.RLock()
	nonceCount := len(suite.middleware.nonceStore)
	suite.middleware.nonceMu.RUnlock()
	assert.Equal(suite.T(), 10, nonceCount)
}

// TestStop_MultipleCallsSafe tests that Stop can be called multiple times without panic
// and verifies that the cleanup goroutine terminates properly
func TestStop_MultipleCallsSafe(t *testing.T) {
	// Get initial goroutine count
	initialGoroutines := runtime.NumGoroutine()

	am := NewAuthMiddleware()

	// Allow some time for the goroutine to start
	time.Sleep(10 * time.Millisecond)

	// Verify goroutine is running (count should have increased)
	afterStart := runtime.NumGoroutine()
	assert.Greater(t, afterStart, initialGoroutines, "Background goroutine should be running")

	// Call Stop multiple times - should not panic
	am.Stop()
	am.Stop()
	am.Stop()

	// Wait for goroutine to terminate
	time.Sleep(50 * time.Millisecond)

	// Verify goroutine has terminated (count should return to initial or close to it)
	finalGoroutines := runtime.NumGoroutine()
	assert.LessOrEqual(t, finalGoroutines, initialGoroutines, "Background goroutine should have terminated")
}

// TestAuthMiddlewareTestSuite runs the test suite
func TestAuthMiddlewareTestSuite(t *testing.T) {
	suite.Run(t, new(AuthMiddlewareTestSuite))
}
