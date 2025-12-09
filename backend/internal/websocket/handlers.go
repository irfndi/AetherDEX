package websocket

import (
	"log"
	"net/http"
	"sync"
	"time"
	"strings"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// WebSocketHandler provides HTTP handlers for WebSocket endpoints
type WebSocketHandler struct {
	server *Server
}

// NewWebSocketHandler creates a new WebSocket handler
func NewWebSocketHandler(server *Server) *WebSocketHandler {
	return &WebSocketHandler{
		server: server,
	}
}

// HandlePricesWebSocket handles WebSocket connections for price feeds
func (h *WebSocketHandler) HandlePricesWebSocket(c *gin.Context) {
	h.server.HandlePricesWebSocket(c)
}

// HandlePoolsWebSocket handles WebSocket connections for pool updates
func (h *WebSocketHandler) HandlePoolsWebSocket(c *gin.Context) {
	h.server.HandlePoolsWebSocket(c)
}

// GetWebSocketStats returns WebSocket connection statistics
func (h *WebSocketHandler) GetWebSocketStats(c *gin.Context) {
	h.server.HandleWebSocketStats(c)
}

// MockPriceDataGenerator generates mock price data for testing
type MockPriceDataGenerator struct {
	server *Server
	ticker *time.Ticker
	done   chan bool
}

// NewMockPriceDataGenerator creates a new mock price data generator
func NewMockPriceDataGenerator(server *Server) *MockPriceDataGenerator {
	return &MockPriceDataGenerator{
		server: server,
		done:   make(chan bool, 1), // Buffered channel to prevent blocking
	}
}

// Start begins generating mock price data
func (m *MockPriceDataGenerator) Start(interval time.Duration) {
	m.ticker = time.NewTicker(interval)
	go func() {
		for {
			select {
			case <-m.done:
				return
			case <-m.ticker.C:
				m.generateMockPriceUpdates()
				m.generateMockPoolUpdates()
			}
		}
	}()
}

// Stop stops generating mock price data
func (m *MockPriceDataGenerator) Stop() {
	if m.ticker != nil {
		m.ticker.Stop()
	}
	// Use non-blocking send to prevent deadlock
	select {
	case m.done <- true:
	default:
		// Channel already has a value or receiver is not ready
	}
}

// generateMockPriceUpdates generates mock price updates
func (m *MockPriceDataGenerator) generateMockPriceUpdates() {
	tokens := []string{"ETH", "USDC", "BTC", "USDT"}
	basePrices := map[string]float64{
		"ETH":  2500.00,
		"USDC": 1.00,
		"BTC":  45000.00,
		"USDT": 1.00,
	}

	for _, token := range tokens {
		basePrice := basePrices[token]
		// Add some random variation (±5%)
		variation := (float64(time.Now().Nanosecond()%1000) - 500) / 10000.0
		newPrice := basePrice * (1 + variation)

		// Generate random 24h change
		change24h := (float64(time.Now().Nanosecond()%2000) - 1000) / 100.0

		// Generate random volume
		volume24h := float64(time.Now().Nanosecond()%10000000 + 1000000)

		priceUpdate := PriceUpdate{
			Symbol:    token,
			Price:     decimal.NewFromFloat(newPrice),
			Change24h: decimal.NewFromFloat(change24h),
			Volume24h: decimal.NewFromFloat(volume24h),
			Timestamp: time.Now(),
		}

		m.server.Hub.BroadcastPriceUpdate(priceUpdate)
	}
}

// generateMockPoolUpdates generates mock pool updates
func (m *MockPriceDataGenerator) generateMockPoolUpdates() {
	pools := []struct {
		poolID string
		token0 string
		token1 string
	}{
		{"ETH-USDC", "ETH", "USDC"},
		{"BTC-USDT", "BTC", "USDT"},
		{"ETH-BTC", "ETH", "BTC"},
	}

	for _, pool := range pools {
		// Generate random liquidity
		liquidity := float64(time.Now().Nanosecond()%50000000 + 10000000)

		// Generate random 24h volume
		volume24h := float64(time.Now().Nanosecond()%5000000 + 500000)

		poolUpdate := PoolUpdate{
			PoolID:    pool.poolID,
			Token0:    pool.token0,
			Token1:    pool.token1,
			Liquidity: decimal.NewFromFloat(liquidity),
			Volume24h: decimal.NewFromFloat(volume24h),
			FeeRate:   decimal.NewFromFloat(0.003), // 0.3% fee
			Timestamp: time.Now(),
		}

		m.server.Hub.BroadcastPoolUpdate(poolUpdate)
	}
}

// SetupWebSocketRoutes sets up WebSocket routes in a Gin router
func SetupWebSocketRoutes(router *gin.Engine, handler *WebSocketHandler) {
	ws := router.Group("/ws")
	{
		ws.GET("/prices", handler.HandlePricesWebSocket)
		ws.GET("/pools", handler.HandlePoolsWebSocket)
		ws.GET("/stats", handler.GetWebSocketStats)
	}
}

// WebSocketMiddleware provides middleware for WebSocket connections
func WebSocketMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Add CORS headers for WebSocket
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization, X-Requested-With")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		// Log WebSocket connection attempts
		safeClientIP := strings.ReplaceAll(c.ClientIP(), "\n", "")
		safeClientIP = strings.ReplaceAll(safeClientIP, "\r", "")
		log.Printf("WebSocket connection attempt from %s to %s", safeClientIP, c.Request.URL.Path)

		c.Next()
	}
}

// AuthenticatedWebSocketMiddleware provides authentication for WebSocket connections
func AuthenticatedWebSocketMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check for authentication token in query parameters or headers
		token := c.Query("token")
		if token == "" {
			token = c.GetHeader("Authorization")
		}

		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Authentication token required",
			})
			c.Abort()
			return
		}

		// TODO: Implement actual token validation
		// For now, accept any non-empty token
		if len(token) < 10 {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid authentication token",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// RateLimitMiddleware provides rate limiting for WebSocket connections
func RateLimitMiddleware(maxConnections int) gin.HandlerFunc {
	var mu sync.RWMutex
	connectionCount := make(map[string]int)
	return func(c *gin.Context) {
		clientIP := c.ClientIP()

		mu.RLock()
		count := connectionCount[clientIP]
		mu.RUnlock()

		if count >= maxConnections {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many connections from this IP",
			})
			c.Abort()
			return
		}

		mu.Lock()
		connectionCount[clientIP]++
		mu.Unlock()

		defer func() {
			mu.Lock()
			connectionCount[clientIP]--
			if connectionCount[clientIP] <= 0 {
				delete(connectionCount, clientIP)
			}
			mu.Unlock()
		}()

		c.Next()
	}
}
