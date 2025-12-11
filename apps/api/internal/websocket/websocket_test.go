package websocket

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/suite"
)

// WebSocketTestSuite provides a test suite for WebSocket functionality
type WebSocketTestSuite struct {
	suite.Suite
	server     *Server
	testServer *httptest.Server
	clients    []*websocket.Conn
}

// SetupSuite initializes the test suite
func (suite *WebSocketTestSuite) SetupSuite() {
	// Create WebSocket server
	suite.server = NewServer()
	suite.server.Start()

	// Create test HTTP server
	gin.SetMode(gin.TestMode)
	router := gin.New()
	suite.server.RegisterRoutes(router)
	suite.testServer = httptest.NewServer(router)
}

// TearDownSuite cleans up after all tests
func (suite *WebSocketTestSuite) TearDownSuite() {
	if suite.server != nil {
		suite.server.Stop()
	}
	if suite.testServer != nil {
		suite.testServer.Close()
	}
	for _, client := range suite.clients {
		if client != nil {
			client.Close()
		}
	}
}

// TestWebSocketConnection tests basic WebSocket connection establishment
func (suite *WebSocketTestSuite) TestWebSocketConnection() {
	// Convert HTTP URL to WebSocket URL
	wsURL := "ws" + strings.TrimPrefix(suite.testServer.URL, "http") + "/ws/prices"

	// Connect to WebSocket
	conn, _, err := dialWithRetry(wsURL, nil)
	suite.Require().NoError(err)
	defer conn.Close()

	// Verify connection is established
	suite.Assert().NotNil(conn)

	// Send a ping message
	err = conn.WriteMessage(websocket.PingMessage, []byte{})
	suite.Assert().NoError(err)
}

// TestWebSocketAuthentication tests WebSocket authentication
func (suite *WebSocketTestSuite) TestWebSocketAuthentication() {
	// Try to connect to authenticated WebSocket endpoint
	wsURL := "ws" + strings.TrimPrefix(suite.testServer.URL, "http") + "/ws/authenticated"
	header := http.Header{}
	header.Set("Authorization", "Bearer test-token")

	conn, resp, err := dialWithRetry(wsURL, header)
	if err == nil {
		conn.Close()
	}

	// Should fail without proper authentication middleware
	suite.Require().Error(err)
	suite.Require().NotNil(resp)
}

// TestPriceFeedSubscription tests price feed subscription functionality
func (suite *WebSocketTestSuite) TestPriceFeedSubscription() {
	wsURL := "ws" + strings.TrimPrefix(suite.testServer.URL, "http") + "/ws/prices"

	conn, _, err := dialWithRetry(wsURL, nil)
	suite.Require().NoError(err)
	defer conn.Close()

	// Subscribe to price feed
	subscribeMsg := SubscriptionRequest{
		Type:   MessageTypeSubscribe,
		Topic:  "prices",
		Symbol: "ETH",
	}

	msgBytes, err := json.Marshal(subscribeMsg)
	suite.Require().NoError(err)

	err = conn.WriteMessage(websocket.TextMessage, msgBytes)
	suite.Assert().NoError(err)

	// Read subscription confirmation (if any)
	conn.SetReadDeadline(time.Now().Add(1 * time.Second))
	conn.ReadMessage() // Discard subscription confirmation

	// Simulate price update broadcast
	priceUpdate := PriceUpdate{
		Symbol:    "ETH",
		Price:     decimal.NewFromFloat(2500.50),
		Change24h: decimal.NewFromFloat(5.25),
		Volume24h: decimal.NewFromFloat(1000000.0),
		Timestamp: time.Now(),
	}

	// Broadcast price update
	go func() {
		time.Sleep(100 * time.Millisecond)
		suite.server.Hub.BroadcastPriceUpdate(priceUpdate)
	}()

	// Read the broadcasted message
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, message, err := conn.ReadMessage()
	suite.Assert().NoError(err)

	var receivedMessage Message
	err = json.Unmarshal(message, &receivedMessage)
	suite.Assert().NoError(err)
	suite.Assert().Equal(MessageTypePriceUpdate, receivedMessage.Type)
	suite.Assert().Equal("ETH", receivedMessage.Symbol)

	// Extract the price update from the data field
	dataBytes, err := json.Marshal(receivedMessage.Data)
	suite.Assert().NoError(err)
	var receivedUpdate PriceUpdate
	err = json.Unmarshal(dataBytes, &receivedUpdate)
	suite.Assert().NoError(err)
	suite.Assert().Equal("ETH", receivedUpdate.Symbol)
	suite.Assert().True(receivedUpdate.Price.Equal(decimal.NewFromFloat(2500.50)))
}

// TestPoolUpdateSubscription tests pool update subscription functionality
func (suite *WebSocketTestSuite) TestPoolUpdateSubscription() {
	wsURL := "ws" + strings.TrimPrefix(suite.testServer.URL, "http") + "/ws/pools"

	conn, _, err := dialWithRetry(wsURL, nil)
	suite.Require().NoError(err)
	defer conn.Close()

	// Subscribe to pool updates
	subscribeMsg := SubscriptionRequest{
		Type:   MessageTypeSubscribe,
		Topic:  "pools",
		PoolID: "pool-1",
	}

	msgBytes, err := json.Marshal(subscribeMsg)
	suite.Require().NoError(err)

	err = conn.WriteMessage(websocket.TextMessage, msgBytes)
	suite.Assert().NoError(err)

	// Read subscription confirmation (if any)
	conn.SetReadDeadline(time.Now().Add(1 * time.Second))
	conn.ReadMessage() // Discard subscription confirmation

	// Simulate pool update broadcast
	poolUpdate := PoolUpdate{
		PoolID:    "pool-1",
		Liquidity: decimal.NewFromFloat(1500000.0),
		Reserve0:  decimal.NewFromFloat(750000.0),
		Reserve1:  decimal.NewFromFloat(750000.0),
		Volume24h: decimal.NewFromFloat(500000.0),
		Timestamp: time.Now(),
	}

	// Broadcast pool update
	go func() {
		time.Sleep(100 * time.Millisecond)
		suite.server.Hub.BroadcastPoolUpdate(poolUpdate)
	}()

	// Read the broadcasted message
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, message, err := conn.ReadMessage()
	suite.Assert().NoError(err)

	var receivedMessage Message
	err = json.Unmarshal(message, &receivedMessage)
	suite.Assert().NoError(err)
	suite.Assert().Equal(MessageTypePoolUpdate, receivedMessage.Type)
	suite.Assert().Equal("pool-1", receivedMessage.PoolID)

	// Extract the pool update from the data field
	dataBytes, err := json.Marshal(receivedMessage.Data)
	suite.Assert().NoError(err)
	var receivedUpdate PoolUpdate
	err = json.Unmarshal(dataBytes, &receivedUpdate)
	suite.Assert().NoError(err)
	suite.Assert().Equal("pool-1", receivedUpdate.PoolID)
	suite.Assert().True(receivedUpdate.Liquidity.Equal(decimal.NewFromFloat(1500000.0)))
}

// TestWebSocketErrorHandling tests error handling scenarios
func (suite *WebSocketTestSuite) TestWebSocketErrorHandling() {
	wsURL := "ws" + strings.TrimPrefix(suite.testServer.URL, "http") + "/ws/prices"

	conn, _, err := dialWithRetry(wsURL, nil)
	suite.Require().NoError(err)
	defer conn.Close()

	// Send invalid JSON message
	err = conn.WriteMessage(websocket.TextMessage, []byte("invalid json"))
	suite.Assert().NoError(err)

	// Read error response
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, message, err := conn.ReadMessage()
	suite.Assert().NoError(err)

	var errorMsg ErrorMessage
	err = json.Unmarshal(message, &errorMsg)
	suite.Assert().NoError(err)
	suite.Assert().Equal(MessageTypeError, errorMsg.Type)
	suite.Assert().Contains(errorMsg.Error, "Invalid")
}

// TestConcurrentWebSocketConnections tests multiple concurrent connections
func (suite *WebSocketTestSuite) TestConcurrentWebSocketConnections() {
	const numConnections = 10
	var wg sync.WaitGroup
	var mu sync.Mutex
	connections := make([]*websocket.Conn, 0, numConnections)

	// Create multiple concurrent connections
	for i := 0; i < numConnections; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			wsURL := "ws" + strings.TrimPrefix(suite.testServer.URL, "http") + "/ws/prices"
			conn, _, err := dialWithRetry(wsURL, nil)
			if err != nil {
				return
			}

			mu.Lock()
			connections = append(connections, conn)
			mu.Unlock()

			// Subscribe to price feed
			subscribeMsg := SubscriptionRequest{
				Type:   MessageTypeSubscribe,
				Topic:  "prices",
				Symbol: "ETH",
			}

			msgBytes, err := json.Marshal(subscribeMsg)
			suite.Require().NoError(err)

			err = conn.WriteMessage(websocket.TextMessage, msgBytes)
			suite.Assert().NoError(err)
		}(i)
	}

	wg.Wait()

	// Verify all connections are established
	suite.Assert().Equal(numConnections, len(connections))

	// Broadcast a message to all connections
	priceUpdate := PriceUpdate{
		Symbol:    "ETH",
		Price:     decimal.NewFromFloat(3000.0),
		Change24h: decimal.NewFromFloat(10.0),
		Volume24h: decimal.NewFromFloat(2000000.0),
		Timestamp: time.Now(),
	}

	suite.server.Hub.BroadcastPriceUpdate(priceUpdate)

	// Verify all connections receive the message
	for _, conn := range connections {
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, message, err := conn.ReadMessage()
		suite.Assert().NoError(err)

		var receivedUpdate PriceUpdate
		err = json.Unmarshal(message, &receivedUpdate)
		suite.Assert().NoError(err)
		suite.Assert().Equal("ETH", receivedUpdate.Symbol)

		conn.Close()
	}
}

// TestWebSocketStats tests WebSocket statistics endpoint
func (suite *WebSocketTestSuite) TestWebSocketStats() {
	// Create a few connections
	conns := make([]*websocket.Conn, 3)
	for i := 0; i < 3; i++ {
		wsURL := "ws" + strings.TrimPrefix(suite.testServer.URL, "http") + "/ws/prices"
		conn, _, err := dialWithRetry(wsURL, nil)
		suite.Require().NoError(err)
		conns[i] = conn
	}

	// Wait for connections to be registered
	time.Sleep(100 * time.Millisecond)

	// Get stats
	stats := suite.server.Hub.GetStats()
	suite.Assert().GreaterOrEqual(stats.ActiveConnections, 3)
	suite.Assert().NotZero(stats.LastUpdate)

	// Clean up connections
	for _, conn := range conns {
		conn.Close()
	}
}

// TestSubscriptionManagement tests subscription and unsubscription
func (suite *WebSocketTestSuite) TestSubscriptionManagement() {
	wsURL := "ws" + strings.TrimPrefix(suite.testServer.URL, "http") + "/ws/prices"

	conn, _, err := dialWithRetry(wsURL, nil)
	suite.Require().NoError(err)
	defer conn.Close()

	// Subscribe to price feed
	subscribeMsg := SubscriptionRequest{
		Type:   MessageTypeSubscribe,
		Topic:  "prices",
		Symbol: "ETH",
	}

	msgBytes, err := json.Marshal(subscribeMsg)
	suite.Require().NoError(err)

	err = conn.WriteMessage(websocket.TextMessage, msgBytes)
	suite.Assert().NoError(err)

	// Read subscription confirmation (if any)
	conn.SetReadDeadline(time.Now().Add(1 * time.Second))
	conn.ReadMessage() // Discard subscription confirmation

	// Unsubscribe from price feed
	unsubscribeMsg := SubscriptionRequest{
		Type:   MessageTypeUnsubscribe,
		Topic:  "prices",
		Symbol: "ETH",
	}

	msgBytes, err = json.Marshal(unsubscribeMsg)
	suite.Require().NoError(err)

	err = conn.WriteMessage(websocket.TextMessage, msgBytes)
	suite.Assert().NoError(err)

	// Read unsubscription confirmation (if any)
	conn.SetReadDeadline(time.Now().Add(1 * time.Second))
	conn.ReadMessage() // Discard unsubscription confirmation

	// Broadcast a price update - should not receive it after unsubscribing
	priceUpdate := PriceUpdate{
		Symbol:    "ETH",
		Price:     decimal.NewFromFloat(2800.0),
		Change24h: decimal.NewFromFloat(8.0),
		Volume24h: decimal.NewFromFloat(1800000.0),
		Timestamp: time.Now(),
	}

	go func() {
		time.Sleep(100 * time.Millisecond)
		suite.server.Hub.BroadcastPriceUpdate(priceUpdate)
	}()

	// Should not receive the message after unsubscribing
	conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, _, err = conn.ReadMessage()
	suite.Assert().Error(err) // Should timeout
}

// TestWebSocketSuite runs the WebSocket test suite
func TestWebSocketSuite(t *testing.T) {
	suite.Run(t, new(WebSocketTestSuite))
}
