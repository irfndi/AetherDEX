package websocket

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// Server represents the WebSocket server
type Server struct {
	Hub      *Hub
	upgrader websocket.Upgrader
}

// NewServer creates a new WebSocket server
func NewServer() *Server {
	return &Server{
		Hub: NewHub(),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				// Allow connections from any origin in development
				// In production, implement proper origin checking
				return true
			},
		},
	}
}

// Start starts the WebSocket server
func (s *Server) Start() {
	go s.Hub.Run()
	log.Println("WebSocket server started")
}

// Stop stops the WebSocket server
func (s *Server) Stop() {
	s.Hub.Stop()
	log.Println("WebSocket server stopped")
}

// HandlePricesWebSocket handles WebSocket connections for price feeds
func (s *Server) HandlePricesWebSocket(c *gin.Context) {
	conn, err := s.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	clientID := generateClientID()
	client := NewClient(conn, s.Hub, clientID)

	// Register the client
	s.Hub.Register <- client

	// Start goroutines for reading and writing
	go client.WritePump()
	go client.ReadPump()

	log.Printf("Price WebSocket client %s connected", clientID)
}

// HandlePoolsWebSocket handles WebSocket connections for pool updates
func (s *Server) HandlePoolsWebSocket(c *gin.Context) {
	conn, err := s.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	clientID := generateClientID()
	client := NewClient(conn, s.Hub, clientID)

	// Register the client
	s.Hub.Register <- client

	// Start goroutines for reading and writing
	go client.WritePump()
	go client.ReadPump()

	log.Printf("Pool WebSocket client %s connected", clientID)
}

// HandleAuthenticatedWebSocket handles authenticated WebSocket connections
func (s *Server) HandleAuthenticatedWebSocket(c *gin.Context) {
	// Get user address from context (set by auth middleware)
	userAddress, exists := c.Get("userAddress")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	conn, err := s.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	clientID := generateClientID()
	client := NewClient(conn, s.Hub, clientID)
	client.SetAuth(userAddress.(string))

	// Register the client
	s.Hub.Register <- client

	// Start goroutines for reading and writing
	go client.WritePump()
	go client.ReadPump()

	log.Printf("Authenticated WebSocket client %s connected for user %s", clientID, userAddress)
}

// HandleWebSocketStats returns WebSocket connection statistics
func (s *Server) HandleWebSocketStats(c *gin.Context) {
	stats := s.Hub.GetStats()
	stats.ActiveConnections = s.Hub.GetClientCount()
	stats.TotalSubscriptions = s.Hub.GetSubscriptionCount()
	stats.LastUpdate = time.Now()

	c.JSON(http.StatusOK, stats)
}

// generateClientID generates a unique client ID
func generateClientID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// RegisterRoutes registers WebSocket routes with the Gin router
func (s *Server) RegisterRoutes(router *gin.Engine) {
	ws := router.Group("/ws")
	{
		ws.GET("/prices", s.HandlePricesWebSocket)
		ws.GET("/pools", s.HandlePoolsWebSocket)
		ws.GET("/authenticated", s.HandleAuthenticatedWebSocket) // Requires auth middleware
		ws.GET("/stats", s.HandleWebSocketStats)
	}
}
