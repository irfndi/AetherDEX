package auth

import (
	"crypto/ecdsa"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// AuthMiddleware provides authentication middleware for API endpoints
type AuthMiddleware struct {
	nonceStore    map[string]time.Time
	nonceWindow   time.Duration
	requiredRoles map[string][]string
}

// NewAuthMiddleware creates a new authentication middleware
func NewAuthMiddleware() *AuthMiddleware {
	return &AuthMiddleware{
		nonceStore:    make(map[string]time.Time),
		nonceWindow:   5 * time.Minute,
		requiredRoles: make(map[string][]string),
	}
}

// AuthRequest represents an authentication request
type AuthRequest struct {
	Message   string `json:"message" binding:"required"`
	Signature string `json:"signature" binding:"required"`
	Address   string `json:"address" binding:"required"`
	Nonce     string `json:"nonce" binding:"required"`
	Timestamp int64  `json:"timestamp" binding:"required"`
}

// RequireAuth middleware that requires authentication
func (am *AuthMiddleware) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Extract auth header
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Authorization header required",
				"code":  "AUTH_HEADER_MISSING",
			})
			c.Abort()
			return
		}

		// Parse Bearer token
		if !strings.HasPrefix(authHeader, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid authorization format",
				"code":  "INVALID_AUTH_FORMAT",
			})
			c.Abort()
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		
		// Verify signature token
		address, err := am.verifySignatureToken(token)
		if err != nil {
			logrus.WithError(err).Warn("Authentication failed")
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Authentication failed",
				"code":  "AUTH_FAILED",
			})
			c.Abort()
			return
		}

		// Set user context
		c.Set("user_address", address)
		c.Next()
	}
}

// RequireRole middleware that requires specific roles
func (am *AuthMiddleware) RequireRole(roles ...string) gin.HandlerFunc {
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

		// Check user roles (simplified for testing)
		userRoles := am.getUserRoles(userAddress.(string))
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

// RateLimitByAddress middleware that limits requests by address
func (am *AuthMiddleware) RateLimitByAddress(requestsPerMinute int) gin.HandlerFunc {
	return func(c *gin.Context) {
		userAddress, exists := c.Get("user_address")
		if !exists {
			c.Next()
			return
		}

		// Simplified rate limiting (in production, use Redis or similar)
		key := fmt.Sprintf("rate_limit:%s", userAddress.(string))
		_ = key // Placeholder for rate limiting logic

		c.Next()
	}
}

// verifySignatureToken verifies a signature-based authentication token
func (am *AuthMiddleware) verifySignatureToken(token string) (string, error) {
	// Parse token format: "signature:nonce:timestamp:address"
	parts := strings.Split(token, ":")
	if len(parts) != 4 {
		return "", fmt.Errorf("invalid token format")
	}

	signature := parts[0]
	nonce := parts[1]
	timestampStr := parts[2]
	address := parts[3]

	// Validate address format
	if !common.IsHexAddress(address) {
		return "", fmt.Errorf("invalid address format")
	}

	// Parse timestamp
	timestamp, err := strconv.ParseInt(timestampStr, 10, 64)
	if err != nil {
		return "", fmt.Errorf("invalid timestamp")
	}

	// Check timestamp validity (5 minute window)
	now := time.Now().Unix()
	if now-timestamp > 300 || timestamp > now+60 {
		return "", fmt.Errorf("timestamp out of valid range")
	}

	// Check nonce replay
	if lastUsed, exists := am.nonceStore[nonce]; exists {
		if time.Since(lastUsed) < am.nonceWindow {
			return "", fmt.Errorf("nonce already used")
		}
	}

	// Verify signature
	message := fmt.Sprintf("AetherDEX Auth:%s:%d", nonce, timestamp)
	if err := am.verifyEthereumSignature(message, signature, address); err != nil {
		return "", fmt.Errorf("signature verification failed: %w", err)
	}

	// Store nonce
	am.nonceStore[nonce] = time.Now()

	// Cleanup old nonces periodically
	go am.cleanupExpiredNonces()

	return address, nil
}

// verifyEthereumSignature verifies an Ethereum signature
func (am *AuthMiddleware) verifyEthereumSignature(message, signature, expectedAddress string) error {
	// Remove 0x prefix if present
	if strings.HasPrefix(signature, "0x") {
		signature = signature[2:]
	}

	// Decode signature
	sigBytes, err := hex.DecodeString(signature)
	if err != nil {
		return fmt.Errorf("invalid signature encoding")
	}

	if len(sigBytes) != 65 {
		return fmt.Errorf("invalid signature length")
	}

	// Create message hash with Ethereum prefix
	prefixedMessage := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)
	hash := crypto.Keccak256Hash([]byte(prefixedMessage))

	// Recover public key
	pubKey, err := crypto.SigToPub(hash.Bytes(), sigBytes)
	if err != nil {
		return fmt.Errorf("failed to recover public key")
	}

	// Get address from public key
	recoveredAddress := crypto.PubkeyToAddress(*pubKey)

	// Compare addresses
	if !strings.EqualFold(recoveredAddress.Hex(), expectedAddress) {
		return fmt.Errorf("signature address mismatch")
	}

	return nil
}

// getUserRoles returns user roles (simplified for testing)
func (am *AuthMiddleware) getUserRoles(address string) []string {
	// In production, this would query a database or external service
	// For testing, return default roles
	return []string{"user", "trader"}
}

// cleanupExpiredNonces removes expired nonces from storage
func (am *AuthMiddleware) cleanupExpiredNonces() {
	now := time.Now()
	for nonce, timestamp := range am.nonceStore {
		if now.Sub(timestamp) > am.nonceWindow {
			delete(am.nonceStore, nonce)
		}
	}
}

// ValidateSignatureRequest validates signature request format
func ValidateSignatureRequest(req AuthRequest) error {
	// Validate address
	if !common.IsHexAddress(req.Address) {
		return fmt.Errorf("invalid address format")
	}

	// Validate signature format
	if !strings.HasPrefix(req.Signature, "0x") || len(req.Signature) != 132 {
		return fmt.Errorf("invalid signature format")
	}

	// Validate timestamp
	now := time.Now().Unix()
	if req.Timestamp < now-300 || req.Timestamp > now+60 {
		return fmt.Errorf("timestamp out of valid range")
	}

	// Validate nonce
	if len(req.Nonce) == 0 || len(req.Nonce) > 1000 {
		return fmt.Errorf("invalid nonce length")
	}

	// Validate message
	if len(req.Message) == 0 || len(req.Message) > 10000 {
		return fmt.Errorf("invalid message length")
	}

	return nil
}

// SecurityHeaders middleware adds security headers
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		c.Header("Content-Security-Policy", "default-src 'self'")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Next()
	}
}

// CORS middleware with security considerations
func SecureCORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		
		// Whitelist of allowed origins (in production, load from config)
		allowedOrigins := []string{
			"http://localhost:3000",
			"https://aetherdex.io",
		}

		isAllowed := false
		for _, allowed := range allowedOrigins {
			if origin == allowed {
				isAllowed = true
				break
			}
		}

		if isAllowed {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}