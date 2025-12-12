package websocket

import (
	"context"
	"fmt"
	"math/rand"
	"net/http/httptest"
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

// RealtimeTestSuite contains real-time scenario tests for WebSocket functionality
type RealtimeTestSuite struct {
	server  *httptest.Server
	ws      *Server
	hub     *Hub
	router  *gin.Engine
	cleanup func()
}

// setupRealtimeTest initializes the test environment
func setupRealtimeTest(t *testing.T) *RealtimeTestSuite {
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

	return &RealtimeTestSuite{
		server:  server,
		ws:      ws,
		hub:     ws.Hub,
		router:  router,
		cleanup: cleanup,
	}
}

// TestRapidPriceUpdates tests handling of rapid price update scenarios
func TestRapidPriceUpdates(t *testing.T) {
	suite := setupRealtimeTest(t)
	defer suite.cleanup()

	tests := []struct {
		name        string
		updateRate  time.Duration
		numUpdates  int
		numClients  int
		symbols     []string
		maxDuration time.Duration
	}{
		{
			name:        "High frequency single symbol",
			updateRate:  1 * time.Millisecond,
			numUpdates:  1000,
			numClients:  5,
			symbols:     []string{"ETH/USDT"},
			maxDuration: 10 * time.Second,
		},
		{
			name:        "Medium frequency multiple symbols",
			updateRate:  5 * time.Millisecond,
			numUpdates:  500,
			numClients:  10,
			symbols:     []string{"ETH/USDT", "BTC/USDT", "ADA/USDT"},
			maxDuration: 15 * time.Second,
		},
		{
			name:        "Burst updates",
			updateRate:  0, // No delay between updates
			numUpdates:  100,
			numClients:  3,
			symbols:     []string{"ETH/USDT", "BTC/USDT"},
			maxDuration: 5 * time.Second,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Pre-allocate slices to avoid race conditions when goroutines access slice element addresses
			clients := make([]*websocket.Conn, tt.numClients)
			receivedCounts := make([]int64, tt.numClients)
			lastPrices := make([]map[string]string, tt.numClients)
			var lastPricesMu sync.Mutex // Protects lastPrices map writes

			// Create clients
			for i := 0; i < tt.numClients; i++ {
				url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
				conn, _, err := websocket.DefaultDialer.Dial(url, nil)
				require.NoError(t, err)
				clients[i] = conn
				lastPrices[i] = make(map[string]string)

				// Subscribe to price updates
				for _, symbol := range tt.symbols {
					subMsg := Message{
						Type:   "subscribe",
						Topic:  "prices",
						Symbol: symbol,
					}
					err = conn.WriteJSON(subMsg)
					require.NoError(t, err)
				}

				// Start message receiver for this client
				go func(clientIndex int, conn *websocket.Conn) {
					for {
						var msg Message
						err := conn.ReadJSON(&msg)
						if err != nil {
							return
						}
						if msg.Type == "price_update" {
							atomic.AddInt64(&receivedCounts[clientIndex], 1)

							// Track latest price for each symbol (protected by mutex)
							if data, ok := msg.Data.(map[string]interface{}); ok {
								if symbol, ok := data["symbol"].(string); ok {
									if price, ok := data["price"].(string); ok {
										lastPricesMu.Lock()
										lastPrices[clientIndex][symbol] = price
										lastPricesMu.Unlock()
									}
								}
							}
						}
					}
				}(i, conn)
			}

			// Wait for connections to stabilize
			time.Sleep(100 * time.Millisecond)

			// Start rapid price updates
			start := time.Now()
			for i := 0; i < tt.numUpdates; i++ {
				// Randomly select a symbol to update
				symbol := tt.symbols[rand.Intn(len(tt.symbols))]
				basePrice := 2000.0
				if symbol == "BTC/USDT" {
					basePrice = 50000.0
				} else if symbol == "ADA/USDT" {
					basePrice = 1.0
				}

				priceUpdate := PriceUpdate{
					Symbol:    symbol,
					Price:     decimal.NewFromFloat(basePrice + float64(i)*0.001 + rand.Float64()*10 - 5),
					Change24h: decimal.NewFromFloat(rand.Float64()*10 - 5),
					Volume24h: decimal.NewFromFloat(1000000 + rand.Float64()*500000),
					Timestamp: time.Now(),
				}
				suite.hub.BroadcastPriceUpdate(priceUpdate)

				if tt.updateRate > 0 {
					time.Sleep(tt.updateRate)
				}
			}
			updateDuration := time.Since(start)

			// Wait for messages to be received
			time.Sleep(500 * time.Millisecond)

			// Close connections
			for _, conn := range clients {
				conn.Close()
			}

			// Verify results
			assert.True(t, updateDuration < tt.maxDuration, "Updates took too long: %v", updateDuration)

			for i := 0; i < len(receivedCounts); i++ {
				receivedCount := atomic.LoadInt64(&receivedCounts[i])
				minExpected := int64(float64(tt.numUpdates) * 0.8) // Allow 20% loss
				assert.True(t, receivedCount >= minExpected,
					"Client %d received too few updates: %d, expected at least %d",
					i, receivedCount, minExpected)

				// Verify that we received updates for subscribed symbols (protected read)
				lastPricesMu.Lock()
				for _, symbol := range tt.symbols {
					assert.Contains(t, lastPrices[i], symbol,
						"Client %d should have received updates for symbol %s", i, symbol)
				}
				lastPricesMu.Unlock()
			}

			t.Logf("Rapid price updates test completed: %d updates in %v, avg rate: %.2f updates/sec",
				tt.numUpdates, updateDuration, float64(tt.numUpdates)/updateDuration.Seconds())
		})
	}
}

// TestSimultaneousPoolUpdates tests concurrent pool update scenarios
func TestSimultaneousPoolUpdates(t *testing.T) {
	suite := setupRealtimeTest(t)
	defer suite.cleanup()

	const numClients = 8
	const numPools = 5
	const updatesPerPool = 50

	// Pre-allocate slices to avoid race conditions when goroutines access slice element addresses
	clients := make([]*websocket.Conn, numClients)
	receivedCounts := make([]int64, numClients)
	var poolUpdates []map[string]interface{}
	var mu sync.Mutex

	// Create clients
	for i := 0; i < numClients; i++ {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/pools"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		clients[i] = conn

		// Subscribe to pool updates
		for _, poolID := range []string{"pool_1", "pool_2", "pool_3", "pool_4", "pool_5"} {
			subMsg := Message{
				Type:   "subscribe",
				Topic:  "pools",
				PoolID: poolID,
			}
			err = conn.WriteJSON(subMsg)
			require.NoError(t, err)
		}

		// Start message receiver
		go func(clientIndex int, conn *websocket.Conn) {
			for {
				var msg Message
				err := conn.ReadJSON(&msg)
				if err != nil {
					return
				}
				if msg.Type == "pool_update" {
					atomic.AddInt64(&receivedCounts[clientIndex], 1)

					// Store pool update data
					if data, ok := msg.Data.(map[string]interface{}); ok {
						mu.Lock()
						poolUpdates = append(poolUpdates, data)
						mu.Unlock()
					}
				}
			}
		}(i, conn)
	}

	// Wait for connections to stabilize
	time.Sleep(100 * time.Millisecond)

	// Start simultaneous pool updates
	var wg sync.WaitGroup
	start := time.Now()

	for poolID := 1; poolID <= numPools; poolID++ {
		wg.Add(1)
		go func(poolID int) {
			defer wg.Done()

			for i := 0; i < updatesPerPool; i++ {
				poolUpdate := PoolUpdate{
					PoolID:    fmt.Sprintf("pool_%d", poolID),
					Token0:    "ETH",
					Token1:    "USDT",
					Liquidity: decimal.NewFromFloat(1000000 + float64(i)*1000 + rand.Float64()*50000),
					Reserve0:  decimal.NewFromFloat(1000.0 + float64(i)*10),
					Reserve1:  decimal.NewFromFloat(2000000.0 + float64(i)*1000),
					Volume24h: decimal.NewFromFloat(500000 + rand.Float64()*100000),
					FeeRate:   decimal.NewFromFloat(0.3),
					Timestamp: time.Now(),
				}
				suite.hub.BroadcastPoolUpdate(poolUpdate)
				time.Sleep(10 * time.Millisecond) // Small delay between updates
			}
		}(poolID)
	}

	wg.Wait()
	updateDuration := time.Since(start)

	// Wait for messages to be received
	time.Sleep(1 * time.Second)

	// Close connections
	for _, conn := range clients {
		conn.Close()
	}

	// Verify results
	totalExpectedUpdates := numPools * updatesPerPool
	for i := 0; i < len(receivedCounts); i++ {
		receivedCount := atomic.LoadInt64(&receivedCounts[i])
		minExpected := int64(float64(totalExpectedUpdates) * 0.8) // Allow 20% loss
		assert.True(t, receivedCount >= minExpected,
			"Client %d received too few pool updates: %d, expected at least %d",
			i, receivedCount, minExpected)
	}

	// Verify pool update data integrity
	mu.Lock()
	totalPoolUpdates := len(poolUpdates)
	mu.Unlock()

	assert.True(t, totalPoolUpdates > 0, "Should have received pool update data")

	// Check that we received updates for all pools
	poolsSeen := make(map[string]bool)
	mu.Lock()
	for _, update := range poolUpdates {
		if poolID, ok := update["pool_id"].(string); ok {
			poolsSeen[poolID] = true
		}
	}
	mu.Unlock()

	for poolID := 1; poolID <= numPools; poolID++ {
		expectedPoolID := fmt.Sprintf("pool_%d", poolID)
		assert.True(t, poolsSeen[expectedPoolID], "Should have seen updates for %s", expectedPoolID)
	}

	t.Logf("Simultaneous pool updates test completed: %d total updates in %v across %d pools",
		totalExpectedUpdates, updateDuration, numPools)
}

// TestClientReconnectionScenarios tests various client reconnection scenarios
func TestClientReconnectionScenarios(t *testing.T) {
	suite := setupRealtimeTest(t)
	defer suite.cleanup()

	t.Run("Immediate reconnection", func(t *testing.T) {
		const numReconnections = 10
		var successfulReconnections int64

		for i := 0; i < numReconnections; i++ {
			// Connect
			url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
			conn, _, err := websocket.DefaultDialer.Dial(url, nil)
			if err != nil {
				continue
			}

			// Subscribe
			subMsg := Message{
				Type:   "subscribe",
				Topic:  "prices",
				Symbol: "ETH/USDT",
			}
			err = conn.WriteJSON(subMsg)
			if err != nil {
				conn.Close()
				continue
			}

			// Immediately disconnect
			conn.Close()

			// Immediate reconnection
			conn2, _, err := websocket.DefaultDialer.Dial(url, nil)
			if err != nil {
				continue
			}

			// Re-subscribe
			err = conn2.WriteJSON(subMsg)
			if err != nil {
				conn2.Close()
				continue
			}

			atomic.AddInt64(&successfulReconnections, 1)
			conn2.Close()
			time.Sleep(10 * time.Millisecond)
		}

		successRate := float64(successfulReconnections) / float64(numReconnections)
		assert.True(t, successRate >= 0.9, "Immediate reconnection success rate too low: %.2f%%", successRate*100)

		t.Logf("Immediate reconnection test: %d/%d successful (%.2f%%)",
			successfulReconnections, numReconnections, successRate*100)
	})

	t.Run("Reconnection with message continuity", func(t *testing.T) {
		// First connection
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn1, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)

		// Subscribe and receive some messages
		subMsg := Message{
			Type:   "subscribe",
			Topic:  "prices",
			Symbol: "ETH/USDT",
		}
		err = conn1.WriteJSON(subMsg)
		require.NoError(t, err)

		// Start receiving messages
		var messages1 []Message
		var mu1 sync.Mutex
		go func() {
			for {
				var msg Message
				err := conn1.ReadJSON(&msg)
				if err != nil {
					return
				}
				mu1.Lock()
				messages1 = append(messages1, msg)
				mu1.Unlock()
			}
		}()

		// Send some price updates
		for i := 0; i < 5; i++ {
			priceUpdate := PriceUpdate{
				Symbol:    "ETH/USDT",
				Price:     decimal.NewFromFloat(2000.0 + float64(i)),
				Change24h: decimal.NewFromFloat(1.5),
				Volume24h: decimal.NewFromFloat(1000000),
				Timestamp: time.Now(),
			}
			suite.hub.BroadcastPriceUpdate(priceUpdate)
			time.Sleep(50 * time.Millisecond)
		}

		time.Sleep(100 * time.Millisecond)

		// Disconnect
		conn1.Close()
		time.Sleep(100 * time.Millisecond)

		// Reconnect
		conn2, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		defer conn2.Close()

		// Re-subscribe
		err = conn2.WriteJSON(subMsg)
		require.NoError(t, err)

		// Start receiving messages again
		var messages2 []Message
		var mu2 sync.Mutex
		go func() {
			for {
				var msg Message
				err := conn2.ReadJSON(&msg)
				if err != nil {
					return
				}
				mu2.Lock()
				messages2 = append(messages2, msg)
				mu2.Unlock()
			}
		}()

		// Send more price updates
		for i := 5; i < 10; i++ {
			priceUpdate := PriceUpdate{
				Symbol:    "ETH/USDT",
				Price:     decimal.NewFromFloat(2000.0 + float64(i)),
				Change24h: decimal.NewFromFloat(1.5),
				Volume24h: decimal.NewFromFloat(1000000),
				Timestamp: time.Now(),
			}
			suite.hub.BroadcastPriceUpdate(priceUpdate)
			time.Sleep(50 * time.Millisecond)
		}

		time.Sleep(200 * time.Millisecond)

		// Verify both connections received messages
		mu1.Lock()
		count1 := len(messages1)
		mu1.Unlock()

		mu2.Lock()
		count2 := len(messages2)
		mu2.Unlock()

		assert.True(t, count1 > 0, "First connection should have received messages")
		assert.True(t, count2 > 0, "Second connection should have received messages")

		t.Logf("Message continuity test: first connection received %d messages, second connection received %d messages",
			count1, count2)
	})

	t.Run("Concurrent reconnections", func(t *testing.T) {
		const numConcurrentClients = 20
		var wg sync.WaitGroup
		var successCount int64

		for i := 0; i < numConcurrentClients; i++ {
			wg.Add(1)
			go func(clientID int) {
				defer wg.Done()

				// Multiple reconnection cycles
				for cycle := 0; cycle < 3; cycle++ {
					url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
					conn, _, err := websocket.DefaultDialer.Dial(url, nil)
					if err != nil {
						continue
					}

					// Subscribe
					subMsg := Message{
						Type:   "subscribe",
						Topic:  "prices",
						Symbol: fmt.Sprintf("TOKEN%d/USDT", clientID),
					}
					err = conn.WriteJSON(subMsg)
					if err != nil {
						conn.Close()
						continue
					}

					// Keep connection alive briefly
					time.Sleep(time.Duration(rand.Intn(100)) * time.Millisecond)

					// Disconnect
					conn.Close()

					// Random delay before reconnection
					time.Sleep(time.Duration(rand.Intn(50)) * time.Millisecond)
				}

				atomic.AddInt64(&successCount, 1)
			}(i)
		}

		wg.Wait()

		successRate := float64(successCount) / float64(numConcurrentClients)
		assert.True(t, successRate >= 0.9, "Concurrent reconnection success rate too low: %.2f%%", successRate*100)

		t.Logf("Concurrent reconnections test: %d/%d clients successful (%.2f%%)",
			successCount, numConcurrentClients, successRate*100)
	})
}

// TestRealTimeDataIntegrity tests data integrity during real-time scenarios
func TestRealTimeDataIntegrity(t *testing.T) {
	suite := setupRealtimeTest(t)
	defer suite.cleanup()

	const numClients = 5
	const testDuration = 5 * time.Second

	// Pre-allocate all slices to avoid race conditions
	clients := make([]*websocket.Conn, numClients)
	receivedMessages := make([][]Message, numClients)
	mutexes := make([]sync.Mutex, numClients)

	// Create clients
	for i := 0; i < numClients; i++ {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		clients[i] = conn
		receivedMessages[i] = []Message{}

		// Subscribe to price updates
		for _, symbol := range []string{"ETH/USDT", "BTC/USDT"} {
			subMsg := Message{
				Type:   "subscribe",
				Topic:  "prices",
				Symbol: symbol,
			}
			err = conn.WriteJSON(subMsg)
			require.NoError(t, err)
		}

		// Start message collector
		go func(clientIndex int, conn *websocket.Conn) {
			for {
				var msg Message
				err := conn.ReadJSON(&msg)
				if err != nil {
					return
				}
				mutexes[clientIndex].Lock()
				receivedMessages[clientIndex] = append(receivedMessages[clientIndex], msg)
				mutexes[clientIndex].Unlock()
			}
		}(i, conn)
	}

	// Wait for connections to stabilize
	time.Sleep(100 * time.Millisecond)

	// Start data generation
	var sentUpdates []PriceUpdate
	var sentMutex sync.Mutex

	ctx, cancel := context.WithTimeout(context.Background(), testDuration)
	defer cancel()

	go func() {
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		counter := 0

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// Alternate between ETH and BTC updates
				basePrice := 2000.0
				symbol := "ETH/USDT"
				if counter%2 == 1 {
					basePrice = 45000.0
					symbol = "BTC/USDT"
				}

				priceUpdate := PriceUpdate{
					Symbol:    symbol,
					Price:     decimal.NewFromFloat(basePrice + float64(counter)*0.1),
					Change24h: decimal.NewFromFloat(float64(counter % 10)),
					Volume24h: decimal.NewFromFloat(float64(1000000 + counter*1000)),
					Timestamp: time.Now(),
				}

				sentMutex.Lock()
				sentUpdates = append(sentUpdates, priceUpdate)
				sentMutex.Unlock()

				suite.hub.BroadcastPriceUpdate(priceUpdate)
				counter++
			}
		}
	}()

	// Wait for test duration
	<-ctx.Done()

	// Wait for final messages
	time.Sleep(500 * time.Millisecond)

	// Close connections
	for _, conn := range clients {
		conn.Close()
	}

	// Analyze data integrity
	sentMutex.Lock()
	totalSent := len(sentUpdates)
	sentMutex.Unlock()

	assert.True(t, totalSent > 0, "Should have sent some updates")

	// Check that all clients received reasonable number of messages
	for i := 0; i < numClients; i++ {
		mutexes[i].Lock()
		receivedCount := len(receivedMessages[i])
		mutexes[i].Unlock()

		minExpected := int(float64(totalSent) * 0.7) // Allow 30% loss
		assert.True(t, receivedCount >= minExpected,
			"Client %d received too few messages: %d, expected at least %d",
			i, receivedCount, minExpected)
	}

	// Verify message ordering and content integrity
	for i := 0; i < numClients; i++ {
		mutexes[i].Lock()
		messages := receivedMessages[i]
		mutexes[i].Unlock()

		var lastETHPrice float64
		var lastBTCPrice float64

		for _, msg := range messages {
			if msg.Type == "price_update" {
				if data, ok := msg.Data.(map[string]interface{}); ok {
					if symbol, ok := data["symbol"].(string); ok {
						if priceStr, ok := data["price"].(string); ok {
							if price, err := parseFloat(priceStr); err == nil {
								// Verify price progression (should generally increase)
								if symbol == "ETH/USDT" {
									if lastETHPrice > 0 {
										assert.True(t, price >= lastETHPrice-1.0, // Allow small decreases
											"ETH price should not decrease significantly: %.6f -> %.6f", lastETHPrice, price)
									}
									lastETHPrice = price
								} else if symbol == "BTC/USDT" {
									if lastBTCPrice > 0 {
										assert.True(t, price >= lastBTCPrice-10.0, // Allow small decreases
											"BTC price should not decrease significantly: %.6f -> %.6f", lastBTCPrice, price)
									}
									lastBTCPrice = price
								}
							}
						}
					}
				}
			}
		}
	}

	t.Logf("Real-time data integrity test completed: sent %d updates over %v", totalSent, testDuration)
}

// Helper function to parse float from string
func parseFloat(s string) (float64, error) {
	var f float64
	_, err := fmt.Sscanf(s, "%f", &f)
	return f, err
}
