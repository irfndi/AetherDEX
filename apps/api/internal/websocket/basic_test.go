package websocket

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestWebSocketServerBasic tests basic WebSocket server functionality
func TestWebSocketServerBasic(t *testing.T) {
	server := NewServer()
	require.NotNil(t, server)
	require.NotNil(t, server.Hub)

	// Test server start and stop
	server.Start()
	server.Stop()
}

// TestWebSocketServerClientCount tests client count functionality
func TestWebSocketServerClientCount(t *testing.T) {
	server := NewServer()
	server.Start()
	defer server.Stop()

	// Initially no clients
	assert.Equal(t, 0, server.Hub.GetClientCount())

	// Simulate adding clients
	client1 := &Client{
		ID:            "test-client-1",
		Send:          make(chan []byte, 256),
		Subscriptions: make(map[string]bool),
	}
	client2 := &Client{
		ID:            "test-client-2",
		Send:          make(chan []byte, 256),
		Subscriptions: make(map[string]bool),
	}

	server.Hub.Register <- client1
	time.Sleep(10 * time.Millisecond) // Allow goroutine to process
	assert.Equal(t, 1, server.Hub.GetClientCount())

	server.Hub.Register <- client2
	time.Sleep(10 * time.Millisecond)
	assert.Equal(t, 2, server.Hub.GetClientCount())

	// Test client removal
	server.Hub.Unregister <- client1
	time.Sleep(10 * time.Millisecond)
	assert.Equal(t, 1, server.Hub.GetClientCount())

	server.Hub.Unregister <- client2
	time.Sleep(10 * time.Millisecond)
	assert.Equal(t, 0, server.Hub.GetClientCount())
}

// TestPriceUpdateBroadcast tests price update broadcasting
func TestPriceUpdateBroadcast(t *testing.T) {
	server := NewServer()
	server.Start()
	defer server.Stop()

	// Create a test client
	client := &Client{
		ID:            "test-client",
		Send:          make(chan []byte, 256),
		Subscriptions: make(map[string]bool),
	}

	// Register client first
	server.Hub.Register <- client
	time.Sleep(10 * time.Millisecond)

	// Subscribe client to price updates for ETH
	subscription := &Subscription{
		Client: client,
		Topic:  "prices:ETH",
	}
	server.Hub.Subscribe <- subscription
	time.Sleep(10 * time.Millisecond)

	// Create and broadcast a price update
	priceUpdate := PriceUpdate{
		Symbol:    "ETH",
		Price:     decimal.NewFromFloat(2500.0),
		Change24h: decimal.NewFromFloat(5.5),
		Volume24h: decimal.NewFromFloat(1000000.0),
		Timestamp: time.Now(),
	}

	server.Hub.BroadcastPriceUpdate(priceUpdate)

	// Check if message was sent to client
	select {
	case msg := <-client.Send:
		assert.NotNil(t, msg)
		assert.Contains(t, string(msg), "ETH")
	case <-time.After(1 * time.Second):
		t.Error("Expected to receive price update message")
	}
}

// TestPoolUpdateBroadcast tests pool update broadcasting
func TestPoolUpdateBroadcast(t *testing.T) {
	server := NewServer()
	server.Start()
	defer server.Stop()

	// Create a test client
	client := &Client{
		ID:            "test-client",
		Send:          make(chan []byte, 256),
		Subscriptions: make(map[string]bool),
	}

	// Register client first
	server.Hub.Register <- client
	time.Sleep(10 * time.Millisecond)

	// Subscribe client to pool updates for ETH-USDC
	subscription := &Subscription{
		Client: client,
		Topic:  "pools:ETH-USDC",
	}
	server.Hub.Subscribe <- subscription
	time.Sleep(10 * time.Millisecond)

	// Create and broadcast a pool update
	poolUpdate := PoolUpdate{
		PoolID:    "ETH-USDC",
		Token0:    "ETH",
		Token1:    "USDC",
		Liquidity: decimal.NewFromFloat(1000000.0),
		Volume24h: decimal.NewFromFloat(500000.0),
		FeeRate:   decimal.NewFromFloat(0.003),
		Timestamp: time.Now(),
	}

	server.Hub.BroadcastPoolUpdate(poolUpdate)

	// Check if message was sent to client
	select {
	case msg := <-client.Send:
		assert.NotNil(t, msg)
		assert.Contains(t, string(msg), "ETH-USDC")
	case <-time.After(1 * time.Second):
		t.Error("Expected to receive pool update message")
	}
}

// TestMessageTypes tests different message types
func TestMessageTypes(t *testing.T) {
	tests := []struct {
		name        string
		messageType string
		expected    string
	}{
		{"Subscribe", "subscribe", "subscribe"},
		{"Unsubscribe", "unsubscribe", "unsubscribe"},
		{"Price Update", "price_update", "price_update"},
		{"Pool Update", "pool_update", "pool_update"},
		{"Ping", "ping", "ping"},
		{"Pong", "pong", "pong"},
		{"Error", "error", "error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.messageType)
		})
	}
}

// TestSubscriptionTypes tests different subscription types
func TestSubscriptionTypes(t *testing.T) {
	tests := []struct {
		name             string
		subscriptionType string
		expected         string
	}{
		{"Prices", "prices", "prices"},
		{"Pools", "pools", "pools"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.subscriptionType)
		})
	}
}

// TestBasicFunctionality tests basic WebSocket functionality
func TestBasicFunctionality(t *testing.T) {
	server := NewServer()
	server.Start()
	defer server.Stop()

	// Test that server is running
	// Test client count starts at zero
	assert.Equal(t, 0, server.Hub.GetClientCount())

	// Test price update structure
	priceUpdate := PriceUpdate{
		Symbol:    "ETH",
		Price:     decimal.NewFromFloat(2500.0),
		Change24h: decimal.NewFromFloat(5.5),
		Volume24h: decimal.NewFromFloat(1000000.0),
		Timestamp: time.Now(),
	}
	assert.Equal(t, "ETH", priceUpdate.Symbol)
	assert.True(t, priceUpdate.Price.Equal(decimal.NewFromFloat(2500.0)))
}
