package websocket

import (
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestWebSocketServerCreation tests server creation and basic operations
func TestWebSocketServerCreation(t *testing.T) {
	server := NewServer()
	require.NotNil(t, server)
	require.NotNil(t, server.Hub)
	require.NotNil(t, server.Hub.Clients)
	require.NotNil(t, server.Hub.Broadcast)
	require.NotNil(t, server.Hub.Register)
	require.NotNil(t, server.Hub.Unregister)

	// Test initial state
	assert.Equal(t, 0, server.Hub.GetClientCount())
}

// TestWebSocketServerStartStop tests server start and stop functionality
func TestWebSocketServerStartStop(t *testing.T) {
	server := NewServer()

	// Test start
	server.Start()

	// Test stop
	server.Stop()
}

// TestPriceUpdateStructure tests the PriceUpdate structure
func TestPriceUpdateStructure(t *testing.T) {
	priceUpdate := PriceUpdate{
		Symbol:    "ETH",
		Price:     decimal.NewFromFloat(2500.0),
		Change24h: decimal.NewFromFloat(5.5),
		Volume24h: decimal.NewFromFloat(1000000.0),
		Timestamp: time.Now(),
	}

	assert.Equal(t, "ETH", priceUpdate.Symbol)
	assert.True(t, priceUpdate.Price.Equal(decimal.NewFromFloat(2500.0)))
	assert.True(t, priceUpdate.Change24h.Equal(decimal.NewFromFloat(5.5)))
	assert.True(t, priceUpdate.Volume24h.Equal(decimal.NewFromFloat(1000000.0)))
	assert.False(t, priceUpdate.Timestamp.IsZero())
}

// TestPoolUpdateStructure tests the PoolUpdate structure
func TestPoolUpdateStructure(t *testing.T) {
	poolUpdate := PoolUpdate{
		PoolID:    "ETH-USDC",
		Token0:    "ETH",
		Token1:    "USDC",
		Liquidity: decimal.NewFromFloat(1000000.0),
		Volume24h: decimal.NewFromFloat(500000.0),
		FeeRate:   decimal.NewFromFloat(0.003),
		Timestamp: time.Now(),
	}

	assert.Equal(t, "ETH-USDC", poolUpdate.PoolID)
	assert.Equal(t, "ETH", poolUpdate.Token0)
	assert.Equal(t, "USDC", poolUpdate.Token1)
	assert.True(t, poolUpdate.Liquidity.Equal(decimal.NewFromFloat(1000000.0)))
	assert.True(t, poolUpdate.Volume24h.Equal(decimal.NewFromFloat(500000.0)))
	assert.True(t, poolUpdate.FeeRate.Equal(decimal.NewFromFloat(0.003)))
	assert.False(t, poolUpdate.Timestamp.IsZero())
}

// TestClientStructure tests the Client structure
func TestClientStructure(t *testing.T) {
	client := &Client{
		ID:            "test-client",
		Send:          make(chan []byte, 256),
		Subscriptions: make(map[string]bool),
	}

	assert.Equal(t, "test-client", client.ID)
	assert.NotNil(t, client.Send)
	assert.NotNil(t, client.Subscriptions)

	// Test subscription management
	client.Subscriptions["prices"] = true
	client.Subscriptions["prices:ETH"] = true
	client.Subscriptions["pools:ETH-USDC"] = true

	assert.True(t, client.Subscriptions["prices"])
	assert.True(t, client.Subscriptions["prices:ETH"])
	assert.True(t, client.Subscriptions["pools:ETH-USDC"])
}

// TestHubStructure tests the Hub structure
func TestHubStructure(t *testing.T) {
	server := NewServer()
	hub := server.Hub

	assert.NotNil(t, hub.Clients)
	assert.NotNil(t, hub.Broadcast)
	assert.NotNil(t, hub.Register)
	assert.NotNil(t, hub.Unregister)

	// Test initial state
	assert.Equal(t, 0, hub.GetClientCount())
}

// TestMessageConstants tests message type constants
func TestMessageConstants(t *testing.T) {
	// Test that constants are defined (this will fail at compile time if they're not)
	assert.NotEmpty(t, MessageTypeSubscribe)
	assert.NotEmpty(t, MessageTypeSubscriptionConfirmed)
	assert.NotEmpty(t, MessageTypeUnsubscribe)
	assert.NotEmpty(t, MessageTypeUnsubscriptionConfirmed)
	assert.NotEmpty(t, MessageTypePriceUpdate)
	assert.NotEmpty(t, MessageTypePoolUpdate)
	assert.NotEmpty(t, MessageTypePing)
	assert.NotEmpty(t, MessageTypePong)
	assert.NotEmpty(t, MessageTypeError)
}

// TestSubscriptionConstants tests subscription type constants
func TestSubscriptionConstants(t *testing.T) {
	// Test subscription topics
	assert.Equal(t, "prices", string(TopicPrices))
	assert.Equal(t, "pools", string(TopicPools))
}
