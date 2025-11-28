package backend

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestDebugSwapExecute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()

	// Simple auth middleware
	authMiddleware := func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if auth != "Bearer valid_token" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}
		c.Next()
	}

	// Simple handler
	handleSwapExecute := func(c *gin.Context) {
		var req struct {
			TokenIn  string `json:"token_in"`
			TokenOut string `json:"token_out"`
			AmountIn string `json:"amount_in"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON"})
			return
		}
		t.Logf("Received request: %+v", req)
		if req.TokenIn == "db_deadlock" {
			t.Logf("Returning 409 for db_deadlock")
			c.JSON(http.StatusConflict, gin.H{"error": "database deadlock detected"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"transaction_hash": "0xabc123"})
	}

	// Setup routes
	v1 := router.Group("/api/v1")
	protected := v1.Group("/")
	protected.Use(authMiddleware)
	protected.POST("/swap/execute", handleSwapExecute)

	// Test the exact same request
	req, _ := http.NewRequest("POST", "/api/v1/swap/execute", bytes.NewBuffer([]byte(`{"token_in":"db_deadlock","token_out":"USDC","amount_in":"1.0"}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer valid_token")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	t.Logf("Response status: %d", w.Code)
	t.Logf("Response body: %s", w.Body.String())
	assert.Equal(t, http.StatusConflict, w.Code)
}