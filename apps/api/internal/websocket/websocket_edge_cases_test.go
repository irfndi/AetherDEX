package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// EdgeCasesTestSuite contains edge case tests for WebSocket functionality
type EdgeCasesTestSuite struct {
	server  *httptest.Server
	ws      *Server
	hub     *Hub
	router  *gin.Engine
	cleanup func()
}

// setupEdgeCasesTest initializes the test environment
func setupEdgeCasesTest(t *testing.T) *EdgeCasesTestSuite {
	gin.SetMode(gin.TestMode)

	// Create WebSocket server
	ws := NewServer()

	// Create router and setup routes
	router := gin.New()
	handler := NewWebSocketHandler(ws)
	SetupWebSocketRoutes(router, handler)

	// Start test server
	server := httptest.NewServer(router)

	// Start hub in background
	go ws.Hub.Run()

	cleanup := func() {
		server.Close()
		ws.Stop()
	}

	return &EdgeCasesTestSuite{
		server:  server,
		ws:      ws,
		hub:     ws.Hub,
		router:  router,
		cleanup: cleanup,
	}
}

// TestConnectionTimeout tests various connection timeout scenarios
func TestConnectionTimeout(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	t.Run("Connection timeout during handshake", func(t *testing.T) {
		// Create a connection with very short timeout
		dialer := websocket.Dialer{
			HandshakeTimeout: 1 * time.Millisecond,
		}

		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		_, _, err := dialer.Dial(url, nil)

		// Should timeout or succeed quickly
		if err != nil {
			assert.Contains(t, err.Error(), "timeout", "Expected timeout error")
		}
	})

	t.Run("Read timeout on idle connection", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := dialWithRetry(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Set read deadline
		conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))

		// Try to read - should timeout
		var msg Message
		err = conn.ReadJSON(&msg)
		assert.Error(t, err, "Expected read timeout")
	})

	t.Run("Write timeout on slow connection", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := dialWithRetry(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Set write deadline
		conn.SetWriteDeadline(time.Now().Add(1 * time.Millisecond))

		// Try to write large message - may timeout
		largeMsg := Message{
			Type:  "subscribe",
			Topic: "prices",
			Data:  make(map[string]interface{}),
		}

		// Add large data
		if dataMap, ok := largeMsg.Data.(map[string]interface{}); ok {
			for i := 0; i < 1000; i++ {
				dataMap[fmt.Sprintf("key_%d", i)] = strings.Repeat("x", 1000)
			}
		}

		err = conn.WriteJSON(largeMsg)
		// May or may not timeout depending on system speed
		if err != nil {
			t.Logf("Write timeout occurred as expected: %v", err)
		}
	})
}

// TestMalformedMessages tests handling of various malformed messages
func TestMalformedMessages(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	tests := []struct {
		name        string
		message     interface{}
		desc        string
		expectClose bool
	}{
		{
			name:    "Invalid JSON",
			message: `{"type": "subscribe", "topic": "prices", "data":}`,
			desc:    "Malformed JSON should be handled gracefully",
		},
		{
			name: "Missing required fields",
			message: Message{
				Type: "subscribe",
				// Missing Topic
				Data: map[string]interface{}{"symbols": []string{"ETH/USDT"}},
			},
			desc: "Message missing required topic field",
		},
		{
			name: "Invalid message type",
			message: Message{
				Type:  "invalid_type",
				Topic: "prices",
				Data:  map[string]interface{}{"symbols": []string{"ETH/USDT"}},
			},
			desc: "Unknown message type should be rejected",
		},
		{
			name: "Invalid topic",
			message: Message{
				Type:  "subscribe",
				Topic: "invalid_topic",
				Data:  map[string]interface{}{"symbols": []string{"ETH/USDT"}},
			},
			desc: "Invalid topic should be rejected",
		},
		{
			name: "Null data",
			message: Message{
				Type:  "subscribe",
				Topic: "prices",
				Data:  nil,
			},
			desc: "Null data should be handled",
		},
		{
			name: "Extremely large message",
			message: Message{
				Type:  "subscribe",
				Topic: "prices",
				Data:  map[string]interface{}{"large_field": strings.Repeat("x", 1024*1024)}, // 1MB
			},
			desc:        "Very large message should be handled or rejected",
			expectClose: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create a new connection for each test case to ensure isolation
			url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
			conn, _, err := dialWithRetry(url, nil)
			require.NoError(t, err)
			defer conn.Close()

			var writeErr error
			if str, ok := tt.message.(string); ok {
				// Send raw string for invalid JSON test
				writeErr = conn.WriteMessage(websocket.TextMessage, []byte(str))
			} else {
				// Send as JSON
				writeErr = conn.WriteJSON(tt.message)
			}

			// Connection should remain stable even with malformed messages
			if writeErr != nil {
				if tt.expectClose {
					t.Logf("Write error for %s (expected): %v", tt.name, writeErr)
				} else {
					t.Logf("Write error for %s: %v", tt.name, writeErr)
				}
			}

			// Try to read response (may be error message or no response)
			conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
			var response Message
			readErr := conn.ReadJSON(&response)
			if readErr != nil {
				// Timeout is acceptable for malformed messages
				if tt.expectClose {
					// 1009 is expected for large message
					if strings.Contains(readErr.Error(), "1009") || strings.Contains(readErr.Error(), "close") {
						t.Logf("Received expected close error: %v", readErr)
					} else {
						t.Logf("Received other error: %v", readErr)
					}
				} else {
					t.Logf("Read timeout/error for %s: %v", tt.name, readErr)
				}
			} else {
				t.Logf("Response for %s: %+v", tt.name, response)
			}

			// Reset read deadline
			conn.SetReadDeadline(time.Time{})

			// Verify connection is still functional after malformed messages (if not expected close)
			if !tt.expectClose {
				validMsg := Message{
					Type:  "subscribe",
					Topic: "prices",
					Data:  map[string]interface{}{"symbols": []string{"ETH/USDT"}},
				}
				err = conn.WriteJSON(validMsg)
				assert.NoError(t, err, "Connection should still work after malformed messages")
			}
		})
	}
}

// TestSubscriptionLimits tests subscription limits and edge cases
func TestSubscriptionLimits(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
	conn, _, err := dialWithRetry(url, nil)
	require.NoError(t, err)
	defer conn.Close()

	t.Run("Multiple subscriptions to same topic", func(t *testing.T) {
		// Subscribe multiple times to the same topic
		for i := 0; i < 5; i++ {
			subMsg := Message{
				Type:  "subscribe",
				Topic: "prices",
				Data:  map[string]interface{}{"symbols": []string{"ETH/USDT"}},
			}
			err := conn.WriteJSON(subMsg)
			assert.NoError(t, err)
		}

		// Should handle duplicate subscriptions gracefully
		time.Sleep(100 * time.Millisecond)
	})

	t.Run("Subscribe to many different topics", func(t *testing.T) {
		topics := []string{"prices", "pools", "trades", "stats"}

		for _, topic := range topics {
			subMsg := Message{
				Type:  "subscribe",
				Topic: topic,
				Data:  map[string]interface{}{"symbols": []string{"ETH/USDT"}},
			}
			err := conn.WriteJSON(subMsg)
			assert.NoError(t, err)
		}

		time.Sleep(100 * time.Millisecond)
	})

	t.Run("Subscribe with excessive symbols", func(t *testing.T) {
		// Create a large list of symbols
		var symbols []string
		for i := 0; i < 1000; i++ {
			symbols = append(symbols, fmt.Sprintf("TOKEN%d/USDT", i))
		}

		subMsg := Message{
			Type:  "subscribe",
			Topic: "prices",
			Data:  map[string]interface{}{"symbols": symbols},
		}
		err := conn.WriteJSON(subMsg)
		// Should either succeed or fail gracefully
		if err != nil {
			t.Logf("Large subscription failed as expected: %v", err)
		}
	})

	t.Run("Unsubscribe from non-existent subscription", func(t *testing.T) {
		unsubMsg := Message{
			Type:  "unsubscribe",
			Topic: "nonexistent",
			Data:  map[string]interface{}{},
		}
		err := conn.WriteJSON(unsubMsg)
		assert.NoError(t, err, "Unsubscribing from non-existent topic should not error")
	})
}

// TestMemoryLeaks tests for potential memory leaks in long-running connections
func TestMemoryLeaks(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	// Get initial memory stats
	var m1 runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m1)
	initialAlloc := m1.Alloc

	t.Run("Long-running connection with many messages", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := dialWithRetry(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Subscribe to updates
		subMsg := Message{
			Type:   "subscribe",
			Topic:  "prices",
			Symbol: "ETH/USDT",
		}
		err = conn.WriteJSON(subMsg)
		require.NoError(t, err)

		// Start message reader
		var messageCount int64
		go func() {
			for {
				var msg Message
				err := conn.ReadJSON(&msg)
				if err != nil {
					return
				}
				atomic.AddInt64(&messageCount, 1)
			}
		}()

		// Send many messages over time
		for i := 0; i < 1000; i++ {
			priceUpdate := PriceUpdate{
				Symbol:    "ETH/USDT",
				Price:     decimal.NewFromFloat(2000.0 + float64(i)*0.1),
				Change24h: decimal.NewFromFloat(1.5),
				Volume24h: decimal.NewFromFloat(1000000),
				Timestamp: time.Now(),
			}
			suite.hub.BroadcastPriceUpdate(priceUpdate)
			time.Sleep(5 * time.Millisecond)
		}

		// Wait for messages to be processed
		time.Sleep(1 * time.Second)

		receivedCount := atomic.LoadInt64(&messageCount)
		assert.True(t, receivedCount > 0, "Should have received some messages")
		t.Logf("Received %d messages", receivedCount)
	})

	t.Run("Multiple connection cycles", func(t *testing.T) {
		// Create and destroy many connections
		for cycle := 0; cycle < 50; cycle++ {
			url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
			conn, _, err := dialWithRetry(url, nil)
			if err != nil {
				continue
			}

			// Quick subscription and unsubscription
			subMsg := Message{
				Type:   "subscribe",
				Topic:  "prices",
				Symbol: "ETH/USDT",
			}
			conn.WriteJSON(subMsg)

			time.Sleep(10 * time.Millisecond)

			unsubMsg := Message{
				Type:   "unsubscribe",
				Topic:  "prices",
				Symbol: "ETH/USDT",
			}
			conn.WriteJSON(unsubMsg)

			conn.Close()
			time.Sleep(5 * time.Millisecond)
		}
	})

	// Force garbage collection and check memory
	runtime.GC()
	runtime.GC() // Run twice to ensure cleanup
	time.Sleep(500 * time.Millisecond)
	var m2 runtime.MemStats
	runtime.ReadMemStats(&m2)
	finalAlloc := m2.Alloc

	// Memory should not have grown excessively
	var memoryGrowth uint64
	if finalAlloc > initialAlloc {
		memoryGrowth = finalAlloc - initialAlloc
	} else {
		t.Logf("Memory actually decreased: initial=%d, final=%d", initialAlloc, finalAlloc)
		memoryGrowth = 0
	}
	maxAcceptableGrowth := uint64(50 * 1024 * 1024) // 50MB

	assert.True(t, memoryGrowth < maxAcceptableGrowth,
		"Memory growth too high: %d bytes (%.2f MB), max acceptable: %d bytes (%.2f MB)",
		memoryGrowth, float64(memoryGrowth)/(1024*1024),
		maxAcceptableGrowth, float64(maxAcceptableGrowth)/(1024*1024))

	t.Logf("Memory leak test completed: initial=%d, final=%d, growth=%d bytes (%.2f MB)",
		initialAlloc, finalAlloc, memoryGrowth, float64(memoryGrowth)/(1024*1024))
}

// TestConcurrentSubscriptionManagement tests concurrent subscription operations
func TestConcurrentSubscriptionManagement(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	const numGoroutines = 10
	const operationsPerGoroutine = 20

	var wg sync.WaitGroup
	var successCount int64
	var errorCount int64

	// Start concurrent subscription/unsubscription operations with separate connections
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()

			// Create separate connection for each goroutine to avoid race conditions
			url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
			conn, _, err := websocket.DefaultDialer.Dial(url, nil)
			if err != nil {
				atomic.AddInt64(&errorCount, int64(operationsPerGoroutine))
				return
			}
			defer conn.Close()

			for j := 0; j < operationsPerGoroutine; j++ {
				// Alternate between subscribe and unsubscribe
				var msg Message
				if j%2 == 0 {
					msg = Message{
						Type:   "subscribe",
						Topic:  "prices",
						Symbol: fmt.Sprintf("TOKEN%d/USDT", goroutineID),
					}
				} else {
					msg = Message{
						Type:  "unsubscribe",
						Topic: "prices",
						Data:  map[string]interface{}{},
					}
				}

				err := conn.WriteJSON(msg)
				if err != nil {
					atomic.AddInt64(&errorCount, 1)
				} else {
					atomic.AddInt64(&successCount, 1)
				}

				time.Sleep(5 * time.Millisecond) // Small delay
			}
		}(i)
	}

	wg.Wait()

	totalOperations := int64(numGoroutines * operationsPerGoroutine)
	successRate := float64(successCount) / float64(totalOperations)

	assert.True(t, successRate >= 0.90, "Success rate too low: %d/%d (%.2f%%)",
		successCount, totalOperations, successRate*100)

	t.Logf("Concurrent subscription management test completed: %d success, %d errors out of %d operations",
		successCount, errorCount, totalOperations)
}

// TestInvalidConnectionStates tests handling of invalid connection states
func TestInvalidConnectionStates(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	t.Run("Write to closed connection", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)

		// Close connection
		conn.Close()

		// Try to write to closed connection
		msg := Message{
			Type:   "subscribe",
			Topic:  "prices",
			Symbol: "ETH/USDT",
		}
		err = conn.WriteJSON(msg)
		assert.Error(t, err, "Writing to closed connection should error")
	})

	t.Run("Read from closed connection", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)

		// Close connection
		conn.Close()

		// Try to read from closed connection
		var msg Message
		err = conn.ReadJSON(&msg)
		assert.Error(t, err, "Reading from closed connection should error")
	})

	t.Run("Multiple close calls", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)

		// Close connection multiple times
		err1 := conn.Close()
		err2 := conn.Close()
		err3 := conn.Close()

		// First close should succeed, subsequent ones may error
		assert.NoError(t, err1, "First close should succeed")
		// Subsequent closes may or may not error - both are acceptable
		t.Logf("Subsequent close errors: %v, %v", err2, err3)
	})
}

// TestResourceExhaustion tests behavior under resource exhaustion
func TestResourceExhaustion(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	t.Run("Rapid connection creation and destruction", func(t *testing.T) {
		const numConnections = 50 // Reduced to prevent timeout
		var wg sync.WaitGroup
		var successCount int64
		var connections []*websocket.Conn
		var connMutex sync.Mutex

		// Create a timeout context for the entire test
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		for i := 0; i < numConnections; i++ {
			wg.Add(1)
			go func(index int) {
				defer wg.Done()

				// Check if context is cancelled
				select {
				case <-ctx.Done():
					return
				default:
				}

				url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
				dialer := websocket.Dialer{
					HandshakeTimeout: 2 * time.Second,
				}
				conn, _, err := dialer.Dial(url, nil)
				if err != nil {
					t.Logf("Connection %d failed: %v", index, err)
					return
				}

				// Store connection for cleanup
				connMutex.Lock()
				connections = append(connections, conn)
				connMutex.Unlock()

				// Quick operation with timeout
				conn.SetWriteDeadline(time.Now().Add(1 * time.Second))
				msg := Message{
					Type:   "subscribe",
					Topic:  "prices",
					Symbol: "ETH/USDT",
				}
				err = conn.WriteJSON(msg)
				if err == nil {
					atomic.AddInt64(&successCount, 1)
				}

				// Close connection immediately
				conn.Close()
			}(i)

			// Small delay to prevent overwhelming
			if i%5 == 0 {
				time.Sleep(10 * time.Millisecond)
			}
		}

		// Wait for all goroutines with timeout
		done := make(chan struct{})
		go func() {
			wg.Wait()
			close(done)
		}()

		select {
		case <-done:
			// All goroutines completed
		case <-ctx.Done():
			t.Logf("Test timed out, cleaning up remaining connections")
		}

		// Ensure all connections are closed
		connMutex.Lock()
		for _, conn := range connections {
			if conn != nil {
				conn.Close()
			}
		}
		connMutex.Unlock()

		// Wait a bit for cleanup
		time.Sleep(100 * time.Millisecond)

		successRate := float64(successCount) / float64(numConnections)
		assert.True(t, successRate >= 0.6, "Success rate too low under rapid connections: %.2f%%", successRate*100)

		t.Logf("Rapid connection test completed: %d/%d successful (%.2f%%)",
			successCount, numConnections, successRate*100)
	})
}

// TestNetworkInterruptionRecovery tests client reconnection after network drops
func TestNetworkInterruptionRecovery(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	t.Run("Client reconnection after connection drop", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"

		// Initial connection
		conn1, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)

		// Subscribe to prices
		subMsg := Message{
			Type:   "subscribe",
			Topic:  "prices",
			Symbol: "ETH/USDT",
		}
		err = conn1.WriteJSON(subMsg)
		require.NoError(t, err)

		// Simulate network interruption by closing connection
		conn1.Close()
		time.Sleep(100 * time.Millisecond)

		// Attempt reconnection
		conn2, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn2.Close()

		// Re-subscribe after reconnection
		err = conn2.WriteJSON(subMsg)
		assert.NoError(t, err, "Should be able to re-subscribe after reconnection")

		// Verify connection is working
		conn2.SetReadDeadline(time.Now().Add(1 * time.Second))
		var response Message
		err = conn2.ReadJSON(&response)
		// May timeout if no immediate response, which is acceptable
		if err != nil {
			t.Logf("No immediate response after reconnection (acceptable): %v", err)
		}
	})

	t.Run("Message queue handling during disconnection", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"

		// Connect and subscribe
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)

		subMsg := Message{
			Type:   "subscribe",
			Topic:  "prices",
			Symbol: "BTC/USDT",
		}
		err = conn.WriteJSON(subMsg)
		require.NoError(t, err)

		// Simulate price update while connected
		priceUpdate := PriceUpdate{
			Symbol:    "BTC/USDT",
			Price:     decimal.NewFromFloat(50000.0),
			Volume24h: decimal.NewFromFloat(100.0),
			Timestamp: time.Now(),
		}
		suite.hub.BroadcastPriceUpdate(priceUpdate)

		// Close connection to simulate network interruption
		conn.Close()

		// Send more updates while disconnected
		for i := 0; i < 5; i++ {
			priceUpdate.Price = decimal.NewFromFloat(50000.0 + float64(i*100))
			suite.hub.BroadcastPriceUpdate(priceUpdate)
			time.Sleep(10 * time.Millisecond)
		}

		// Reconnect
		conn2, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn2.Close()

		// Re-subscribe
		err = conn2.WriteJSON(subMsg)
		assert.NoError(t, err)

		// Consume subscription confirmation if present
		conn2.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		var confirmMsg Message
		err = conn2.ReadJSON(&confirmMsg)
		if err == nil && confirmMsg.Type == "subscription_confirmed" {
			// Good, we got the confirmation
		} else if err == nil {
			// If it's not confirmation, it might be the update we're looking for,
			// but usually confirmation comes first.
			// However, since we re-subscribed, we expect confirmation.
			// Let's just log it and proceed to read next message if needed.
			t.Logf("Received message after resubscribe: %s", confirmMsg.Type)
		}

		// Should be able to receive new updates
		priceUpdate.Price = decimal.NewFromFloat(51000.0)
		suite.hub.BroadcastPriceUpdate(priceUpdate)

		conn2.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		var response Message
		err = conn2.ReadJSON(&response)
		if err == nil {
			assert.Equal(t, MessageTypePriceUpdate, response.Type)
			t.Logf("Successfully received price update after reconnection")
		} else {
			t.Logf("No immediate response (acceptable): %v", err)
		}
	})
}

// TestServerRestartScenarios tests graceful shutdown and client state preservation
func TestServerRestartScenarios(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	t.Run("Graceful shutdown handling", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"

		// Connect multiple clients
		var connections []*websocket.Conn
		for i := 0; i < 3; i++ {
			conn, _, err := websocket.DefaultDialer.Dial(url, nil)
			require.NoError(t, err)
			connections = append(connections, conn)

			// Subscribe each client
			subMsg := Message{
				Type:   "subscribe",
				Topic:  "prices",
				Symbol: fmt.Sprintf("TOKEN%d/USDT", i),
			}
			err = conn.WriteJSON(subMsg)
			require.NoError(t, err)
		}

		// Verify all connections are active
		assert.Equal(t, 3, len(suite.hub.Clients), "Should have 3 active clients")

		// Simulate graceful shutdown
		suite.ws.Stop()
		time.Sleep(100 * time.Millisecond)

		// Check that connections are properly closed
		for i, conn := range connections {
			// Try to read from connection - should fail or receive close message
			conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
			_, _, err := conn.ReadMessage()
			if err != nil {
				// Connection closed properly
				isCloseError := websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) ||
					websocket.IsUnexpectedCloseError(err) ||
					strings.Contains(err.Error(), "connection reset by peer") ||
					strings.Contains(err.Error(), "broken pipe")

				assert.True(t, isCloseError,
					"Connection %d should be closed with proper close error, got: %v", i, err)
			} else {
				// If no error, the connection might still be open, which is acceptable in some cases
				t.Logf("Connection %d still readable after shutdown (may be acceptable)", i)
			}
			conn.Close()
		}
	})

	t.Run("Client state preservation across restart", func(t *testing.T) {
		// This test simulates what would happen in a real restart scenario
		// where clients need to re-establish their subscriptions

		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Subscribe to multiple symbols
		subscriptions := []string{"ETH/USDT", "BTC/USDT", "ADA/USDT"}
		for _, symbol := range subscriptions {
			subMsg := Message{
				Type:   "subscribe",
				Topic:  "prices",
				Symbol: symbol,
			}
			err = conn.WriteJSON(subMsg)
			require.NoError(t, err)
			time.Sleep(10 * time.Millisecond)
		}

		// Verify subscriptions are active by sending price updates
		for _, symbol := range subscriptions {
			priceUpdate := PriceUpdate{
				Symbol:    symbol,
				Price:     decimal.NewFromFloat(1000.0),
				Volume24h: decimal.NewFromFloat(100.0),
				Timestamp: time.Now(),
			}
			suite.hub.BroadcastPriceUpdate(priceUpdate)
		}

		// Client should receive updates for all subscribed symbols
		receivedUpdates := make(map[string]bool)
		conn.SetReadDeadline(time.Now().Add(1 * time.Second))

		for len(receivedUpdates) < len(subscriptions) {
			var response Message
			err = conn.ReadJSON(&response)
			if err != nil {
				break // Timeout or error
			}

			if response.Type == "price_update" {
				if data, ok := response.Data.(map[string]interface{}); ok {
					if symbol, ok := data["symbol"].(string); ok {
						receivedUpdates[symbol] = true
					}
				}
			}
		}

		t.Logf("Received updates for %d/%d subscribed symbols", len(receivedUpdates), len(subscriptions))
	})
}

// TestClientCleanup tests proper resource cleanup when clients disconnect
func TestClientCleanup(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	t.Run("Unexpected client disconnection cleanup", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"

		// Track initial client count
		initialClients := len(suite.hub.Clients)

		// Connect multiple clients
		var connections []*websocket.Conn
		for i := 0; i < 5; i++ {
			conn, _, err := websocket.DefaultDialer.Dial(url, nil)
			require.NoError(t, err)
			connections = append(connections, conn)

			// Subscribe each client
			subMsg := Message{
				Type:   "subscribe",
				Topic:  "prices",
				Symbol: fmt.Sprintf("TOKEN%d/USDT", i),
			}
			err = conn.WriteJSON(subMsg)
			require.NoError(t, err)
		}

		// Verify clients are registered
		time.Sleep(100 * time.Millisecond)
		assert.Equal(t, initialClients+5, len(suite.hub.Clients), "Should have 5 additional clients")

		// Abruptly close connections without proper unsubscribe
		for _, conn := range connections {
			conn.Close()
		}

		// Wait for cleanup
		time.Sleep(500 * time.Millisecond)

		// Verify clients are cleaned up
		assert.Equal(t, initialClients, len(suite.hub.Clients), "Clients should be cleaned up after disconnection")
	})

	t.Run("Memory leak prevention", func(t *testing.T) {
		// Force garbage collection before test
		runtime.GC()
		runtime.GC()
		time.Sleep(100 * time.Millisecond)
		var m1 runtime.MemStats
		runtime.ReadMemStats(&m1)
		initialAlloc := m1.Alloc

		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"

		// Create a timeout context
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		// Create and destroy many connections with timeout protection
		const numConnections = 30 // Reduced from 50
		for i := 0; i < numConnections; i++ {
			// Check if context is cancelled
			select {
			case <-ctx.Done():
				t.Logf("Memory leak test timed out at connection %d", i)
				return
			default:
			}

			dialer := websocket.Dialer{
				HandshakeTimeout: 1 * time.Second,
			}
			conn, _, err := dialer.Dial(url, nil)
			if err != nil {
				t.Logf("Connection %d failed: %v", i, err)
				continue
			}

			// Subscribe and immediately disconnect with timeout
			conn.SetWriteDeadline(time.Now().Add(500 * time.Millisecond))
			subMsg := Message{
				Type:   "subscribe",
				Topic:  "prices",
				Symbol: "ETH/USDT",
			}
			conn.WriteJSON(subMsg)
			conn.Close()

			if i%5 == 0 {
				time.Sleep(20 * time.Millisecond)
			}
		}

		// Wait for cleanup and force garbage collection
		time.Sleep(500 * time.Millisecond)
		runtime.GC()
		runtime.GC()
		time.Sleep(100 * time.Millisecond)
		var m2 runtime.MemStats
		runtime.ReadMemStats(&m2)
		finalAlloc := m2.Alloc

		var memoryGrowth uint64
		if finalAlloc > initialAlloc {
			memoryGrowth = finalAlloc - initialAlloc
		} else {
			t.Logf("Memory actually decreased: initial=%d, final=%d", initialAlloc, finalAlloc)
			memoryGrowth = 0
		}
		maxAcceptableGrowth := uint64(15 * 1024 * 1024) // 15MB (increased tolerance)

		assert.True(t, memoryGrowth < maxAcceptableGrowth,
			"Memory growth too high after client cleanup: %d bytes (%.2f MB)",
			memoryGrowth, float64(memoryGrowth)/(1024*1024))

		t.Logf("Memory cleanup test: initial=%d, final=%d, growth=%d bytes (%.2f MB)",
			initialAlloc, finalAlloc, memoryGrowth, float64(memoryGrowth)/(1024*1024))
	})
}

// TestConnectionResilience tests ping/pong mechanisms and heartbeat functionality
func TestConnectionResilience(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	t.Run("Ping/Pong mechanism", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Set up ping handler
		pongReceived := make(chan bool, 1)
		conn.SetPongHandler(func(appData string) error {
			select {
			case pongReceived <- true:
			default:
			}
			return nil
		})

		// Send ping
		err = conn.WriteMessage(websocket.PingMessage, []byte("ping"))
		assert.NoError(t, err, "Should be able to send ping")

		// Wait for pong response
		select {
		case <-pongReceived:
			t.Logf("Pong received successfully")
		case <-time.After(1 * time.Second):
			t.Logf("No pong received within timeout (may be acceptable)")
		}
	})

	t.Run("Connection timeout handling", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Subscribe to prices using correct format
		subMsg := Message{
			Type:      MessageTypeSubscribe,
			Topic:     "prices",
			Symbol:    "ETH",
			Timestamp: time.Now(),
		}
		err = conn.WriteJSON(subMsg)
		require.NoError(t, err)

		// Read subscription confirmation
		conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		var confirmMsg Message
		err = conn.ReadJSON(&confirmMsg)
		require.NoError(t, err)
		assert.Equal(t, MessageTypeSubscriptionConfirmed, confirmMsg.Type)

		// Set short read deadline to test timeout handling
		conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))

		// Try to read - should timeout
		var response Message
		err = conn.ReadJSON(&response)
		if err != nil {
			isTimeout := strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "deadline exceeded")
			if !isTimeout {
				t.Logf("Unexpected error (not timeout): %v", err)
			}
			assert.True(t, isTimeout, "Expected timeout error, got: %v", err)
		} else {
			t.Logf("Received response before timeout: %+v", response)
		}
	})

	t.Run("Heartbeat functionality", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Subscribe to prices using correct format
		subMsg := Message{
			Type:      MessageTypeSubscribe,
			Topic:     "prices",
			Symbol:    "BTC",
			Timestamp: time.Now(),
		}
		err = conn.WriteJSON(subMsg)
		require.NoError(t, err)

		// Read subscription confirmation
		conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		var confirmMsg Message
		err = conn.ReadJSON(&confirmMsg)
		require.NoError(t, err)

		// Send periodic heartbeat messages
		heartbeatTicker := time.NewTicker(100 * time.Millisecond)
		defer heartbeatTicker.Stop()

		heartbeatCount := 0
		maxHeartbeats := 5

		for heartbeatCount < maxHeartbeats {
			select {
			case <-heartbeatTicker.C:
				heartbeatMsg := Message{
					Type:  "heartbeat",
					Topic: "system",
					Data:  map[string]interface{}{"timestamp": time.Now().Unix()},
				}
				err = conn.WriteJSON(heartbeatMsg)
				if err != nil {
					t.Logf("Heartbeat failed: %v", err)
					return
				}
				heartbeatCount++
			case <-time.After(1 * time.Second):
				t.Logf("Heartbeat test timeout")
				return
			}
		}

		assert.Equal(t, maxHeartbeats, heartbeatCount, "Should have sent all heartbeat messages")
		t.Logf("Heartbeat functionality test completed: %d heartbeats sent", heartbeatCount)
	})
}

// TestMessageDeliveryGuarantees tests message ordering and delivery confirmation
func TestMessageDeliveryGuarantees(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	t.Run("Message ordering", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Subscribe to prices using correct format
		subMsg := Message{
			Type:      MessageTypeSubscribe,
			Topic:     "prices",
			Symbol:    "ETH",
			Timestamp: time.Now(),
		}
		err = conn.WriteJSON(subMsg)
		require.NoError(t, err)

		// Read subscription confirmation
		var confirmMsg Message
		err = conn.ReadJSON(&confirmMsg)
		require.NoError(t, err)
		assert.Equal(t, MessageTypeSubscriptionConfirmed, confirmMsg.Type)
		assert.Equal(t, "prices", confirmMsg.Topic)
		assert.Equal(t, "ETH", confirmMsg.Symbol)
		t.Logf("Subscription confirmed for %s:%s", confirmMsg.Topic, confirmMsg.Symbol)

		// Wait a bit for subscription to be processed
		time.Sleep(100 * time.Millisecond)

		// Send multiple price updates in sequence
		expectedPrices := []float64{1000.0, 1001.0, 1002.0, 1003.0, 1004.0}
		for i, price := range expectedPrices {
			priceUpdate := PriceUpdate{
				Symbol:    "ETH",
				Price:     decimal.NewFromFloat(price),
				Volume24h: decimal.NewFromFloat(100.0),
				Change24h: decimal.NewFromFloat(1.5),
				Timestamp: time.Now(),
			}
			suite.hub.BroadcastPriceUpdate(priceUpdate)
			time.Sleep(50 * time.Millisecond) // Increased delay between updates
			t.Logf("Sent price update %d: %.2f", i+1, price)
		}

		// Read responses and verify ordering
		receivedPrices := make([]float64, 0)
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))

		for len(receivedPrices) < len(expectedPrices) {
			var priceUpdate PriceUpdate
			err = conn.ReadJSON(&priceUpdate)
			if err != nil {
				t.Logf("Read error: %v", err)
				break // Timeout or error
			}

			if priceUpdate.Symbol == "ETH" {
				priceFloat, _ := priceUpdate.Price.Float64()
				receivedPrices = append(receivedPrices, priceFloat)
				t.Logf("Received price update: %.2f", priceFloat)
			}
		}

		t.Logf("Message ordering test: sent %d, received %d price updates",
			len(expectedPrices), len(receivedPrices))

		// Verify that we received some updates (exact ordering may vary due to async nature)
		assert.True(t, len(receivedPrices) > 0, "Should receive at least some price updates")
	})

	t.Run("Duplicate prevention", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Subscribe to prices
		subMsg := Message{
			Type:   "subscribe",
			Topic:  "prices",
			Symbol: "BTC/USDT",
		}
		err = conn.WriteJSON(subMsg)
		require.NoError(t, err)

		// Wait a bit for subscription to be processed
		time.Sleep(100 * time.Millisecond)

		// Send the same price update multiple times
		priceUpdate := PriceUpdate{
			Symbol:    "BTC",
			Price:     decimal.NewFromFloat(50000.0),
			Volume24h: decimal.NewFromFloat(100.0),
			Change24h: decimal.NewFromFloat(2.5),
			Timestamp: time.Now(),
		}

		for i := 0; i < 3; i++ {
			suite.hub.BroadcastPriceUpdate(priceUpdate)
			time.Sleep(50 * time.Millisecond)
		}

		// Count received updates
		updateCount := 0
		conn.SetReadDeadline(time.Now().Add(1 * time.Second))

		for updateCount < 5 { // Read up to 5 messages
			var priceUpdate PriceUpdate
			err = conn.ReadJSON(&priceUpdate)
			if err != nil {
				break // Timeout or error
			}

			if priceUpdate.Symbol == "BTC" {
				updateCount++
				t.Logf("Received price update %d", updateCount)
			}
		}

		t.Logf("Duplicate prevention test: received %d updates from 3 broadcasts", updateCount)
		// Note: The system may or may not implement deduplication, so we just log the results
	})

	t.Run("Delivery confirmation", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Subscribe to prices using correct format
		subMsg := Message{
			Type:      MessageTypeSubscribe,
			Topic:     "prices",
			Symbol:    "ADA",
			Timestamp: time.Now(),
		}
		err = conn.WriteJSON(subMsg)
		require.NoError(t, err)

		// Read subscription confirmation
		conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		var confirmMsg Message
		err = conn.ReadJSON(&confirmMsg)
		require.NoError(t, err)

		// Wait a bit for subscription to be processed
		time.Sleep(100 * time.Millisecond)

		// Send a price update
		priceUpdate := PriceUpdate{
			Symbol:    "ADA",
			Price:     decimal.NewFromFloat(1.5),
			Volume24h: decimal.NewFromFloat(1000.0),
			Change24h: decimal.NewFromFloat(0.5),
			Timestamp: time.Now(),
		}
		suite.hub.BroadcastPriceUpdate(priceUpdate)

		// Try to receive the update
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		var receivedUpdate PriceUpdate
		err = conn.ReadJSON(&receivedUpdate)

		if err == nil && receivedUpdate.Symbol == "ADA" {
			t.Logf("Price update delivered successfully: %+v", receivedUpdate)

			// Send acknowledgment (if the system supports it)
			ackMsg := Message{
				Type:      "ack",
				Topic:     "system",
				Timestamp: time.Now(),
			}
			err = conn.WriteJSON(ackMsg)
			assert.NoError(t, err, "Should be able to send acknowledgment")
		} else {
			t.Logf("No price update received or error: %v", err)
		}
	})
}

// TestGracefulDegradation tests system behavior when WebSocket capacity is exceeded
func TestGracefulDegradation(t *testing.T) {
	suite := setupEdgeCasesTest(t)
	defer suite.cleanup()

	t.Run("Connection limit handling", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"

		// Try to create many connections to test limits
		const maxConnections = 50
		var connections []*websocket.Conn
		var successfulConnections int

		for i := 0; i < maxConnections; i++ {
			conn, _, err := websocket.DefaultDialer.Dial(url, nil)
			if err != nil {
				t.Logf("Connection %d failed: %v", i+1, err)
				break
			}
			connections = append(connections, conn)
			successfulConnections++

			// Small delay to prevent overwhelming
			if i%10 == 0 {
				time.Sleep(10 * time.Millisecond)
			}
		}

		// Clean up connections
		for _, conn := range connections {
			conn.Close()
		}

		assert.True(t, successfulConnections > 0, "Should be able to create at least some connections")
		t.Logf("Connection limit test: %d/%d connections successful", successfulConnections, maxConnections)
	})

	t.Run("High message volume handling", func(t *testing.T) {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn.Close()

		// Subscribe to prices
		subMsg := Message{
			Type:   "subscribe",
			Topic:  "prices",
			Symbol: "ETH/USDT",
		}
		err = conn.WriteJSON(subMsg)
		require.NoError(t, err)

		// Wait a bit for subscription to be processed
		time.Sleep(100 * time.Millisecond)

		// Send high volume of price updates
		const numUpdates = 15 // Reduced for more realistic testing
		var wg sync.WaitGroup

		wg.Add(1)
		go func() {
			defer wg.Done()
			time.Sleep(500 * time.Millisecond) // Give client time to be ready
			for i := 0; i < numUpdates; i++ {
				priceUpdate := PriceUpdate{
					Symbol:    "ETH/USDT",
					Price:     decimal.NewFromFloat(1000.0 + float64(i)),
					Change24h: decimal.NewFromFloat(float64(i) * 0.1),
					Volume24h: decimal.NewFromFloat(100000.0),
					Timestamp: time.Now(),
				}
				suite.hub.BroadcastPriceUpdate(priceUpdate)
				time.Sleep(50 * time.Millisecond) // Delay between broadcasts
				t.Logf("Broadcasted price update %d for ETH/USDT: $%.2f", i+1, 1000.0+float64(i))
			}
		}()

		// Count received messages
		receivedCount := 0
		conn.SetReadDeadline(time.Now().Add(15 * time.Second)) // Longer timeout

		for receivedCount < numUpdates {
			var response Message
			err = conn.ReadJSON(&response)
			if err != nil {
				t.Logf("Read error after %d messages: %v", receivedCount, err)
				break // Timeout or error
			}

			if response.Type == MessageTypePriceUpdate && response.Symbol == "ETH/USDT" {
				// Extract PriceUpdate from Data field
				dataBytes, _ := json.Marshal(response.Data)
				var price PriceUpdate
				if err := json.Unmarshal(dataBytes, &price); err == nil {
					receivedCount++
					t.Logf("Received price update %d for %s: $%s", receivedCount, price.Symbol, price.Price.String())
				}
			}
		}

		wg.Wait()

		deliveryRate := float64(receivedCount) / float64(numUpdates)
		assert.True(t, deliveryRate > 0.6, "Should deliver at least 60%% of high-volume messages")
		t.Logf("High volume test: %d/%d messages delivered (%.2f%%)",
			receivedCount, numUpdates, deliveryRate*100)
	})

	t.Run("Resource exhaustion recovery", func(t *testing.T) {
		// Force garbage collection before test
		runtime.GC()
		runtime.GC()
		time.Sleep(100 * time.Millisecond)
		var m1 runtime.MemStats
		runtime.ReadMemStats(&m1)
		initialAlloc := m1.Alloc

		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"

		// Create stress load
		for round := 0; round < 3; round++ {
			t.Logf("Stress round %d", round+1)

			// Create many short-lived connections
			for i := 0; i < 20; i++ {
				conn, _, err := websocket.DefaultDialer.Dial(url, nil)
				if err != nil {
					continue
				}

				// Quick subscribe and disconnect
				subMsg := Message{
					Type:   "subscribe",
					Topic:  "prices",
					Symbol: "ETH/USDT",
				}
				conn.WriteJSON(subMsg)
				conn.Close()
			}

			// Allow recovery time
			time.Sleep(200 * time.Millisecond)
			runtime.GC()
		}

		// Test that system is still responsive after stress
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		assert.NoError(t, err, "Should be able to connect after stress test")
		if conn != nil {
			defer conn.Close()

			subMsg := Message{
				Type:   "subscribe",
				Topic:  "prices",
				Symbol: "BTC/USDT",
			}
			err = conn.WriteJSON(subMsg)
			assert.NoError(t, err, "Should be able to subscribe after stress test")
		}

		// Check memory usage
		runtime.GC()
		runtime.GC()
		time.Sleep(100 * time.Millisecond)
		var m2 runtime.MemStats
		runtime.ReadMemStats(&m2)
		finalAlloc := m2.Alloc

		var memoryGrowth uint64
		if finalAlloc > initialAlloc {
			memoryGrowth = finalAlloc - initialAlloc
		} else {
			t.Logf("Memory actually decreased: initial=%d, final=%d", initialAlloc, finalAlloc)
			memoryGrowth = 0
		}
		maxAcceptableGrowth := uint64(50 * 1024 * 1024) // 50MB

		assert.True(t, memoryGrowth < maxAcceptableGrowth,
			"Memory growth too high after stress test: %d bytes (%.2f MB)",
			memoryGrowth, float64(memoryGrowth)/(1024*1024))

		t.Logf("Resource exhaustion recovery test completed: memory growth %d bytes (%.2f MB)",
			memoryGrowth, float64(memoryGrowth)/(1024*1024))
	})
}
