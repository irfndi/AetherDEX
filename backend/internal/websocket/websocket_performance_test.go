package websocket

import (
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

// PerformanceTestSuite contains performance tests for WebSocket functionality
type PerformanceTestSuite struct {
	server  *httptest.Server
	ws      *Server
	hub     *Hub
	router  *gin.Engine
	cleanup func()
}

// setupPerformanceTest initializes the test environment
func setupPerformanceTest(t *testing.T) *PerformanceTestSuite {
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

	return &PerformanceTestSuite{
		server:  server,
		ws:      ws,
		hub:     ws.Hub,
		router:  router,
		cleanup: cleanup,
	}
}

// TestConcurrentConnections tests multiple simultaneous WebSocket connections
func TestConcurrentConnections(t *testing.T) {
	suite := setupPerformanceTest(t)
	defer suite.cleanup()

	tests := []struct {
		name        string
		numClients  int
		maxDuration time.Duration
	}{
		{"10 concurrent clients", 10, 5 * time.Second},
		{"50 concurrent clients", 50, 10 * time.Second},
		{"100 concurrent clients", 100, 15 * time.Second},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start := time.Now()
			var wg sync.WaitGroup
			var successCount int64
			var errorCount int64

			// Create concurrent connections
			for i := 0; i < tt.numClients; i++ {
				wg.Add(1)
				go func(clientID int) {
					defer wg.Done()

					// Connect to WebSocket
					url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
					conn, _, err := websocket.DefaultDialer.Dial(url, nil)
					if err != nil {
						atomic.AddInt64(&errorCount, 1)
						return
					}
					defer conn.Close()

					// Send subscription message
					subMsg := Message{
						Type:  "subscribe",
						Topic: "prices",
						Data:  map[string]interface{}{"symbols": []string{"ETH/USDT"}},
					}
					err = conn.WriteJSON(subMsg)
					if err != nil {
						atomic.AddInt64(&errorCount, 1)
						return
					}

					// Keep connection alive for a short time
					time.Sleep(2 * time.Second)
					atomic.AddInt64(&successCount, 1)
				}(i)
			}

			wg.Wait()
			duration := time.Since(start)

			// Verify results
			assert.True(t, duration < tt.maxDuration, "Test took too long: %v", duration)
			assert.Equal(t, int64(tt.numClients), successCount+errorCount, "Total connections mismatch")
			assert.True(t, float64(successCount)/float64(tt.numClients) >= 0.95, "Success rate too low: %d/%d", successCount, tt.numClients)

			t.Logf("Concurrent connections test completed: %d clients, %v duration, %d success, %d errors",
				tt.numClients, duration, successCount, errorCount)
		})
	}
}

// TestHighFrequencyBroadcasting tests rapid message broadcasting
func TestHighFrequencyBroadcasting(t *testing.T) {
	suite := setupPerformanceTest(t)
	defer suite.cleanup()

	tests := []struct {
		name          string
		messageCount  int
		broadcastRate time.Duration
		clientCount   int
	}{
		{"100 messages/sec to 5 clients", 100, 10 * time.Millisecond, 5},
		{"500 messages/sec to 10 clients", 500, 2 * time.Millisecond, 10},
		{"1000 messages/sec to 20 clients", 1000, 1 * time.Millisecond, 20},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var clients []*websocket.Conn
			var receivedCounts []int64

			// Create multiple clients
			for i := 0; i < tt.clientCount; i++ {
				url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
				conn, _, err := websocket.DefaultDialer.Dial(url, nil)
				require.NoError(t, err)
				clients = append(clients, conn)
				receivedCounts = append(receivedCounts, 0)

				// Subscribe to price updates
				subMsg := Message{
					Type:  "subscribe",
					Topic: "prices",
					Data:  map[string]interface{}{"symbols": []string{"ETH/USDT"}},
				}
				err = conn.WriteJSON(subMsg)
				require.NoError(t, err)

				// Start message counter for this client
				go func(clientIndex int, conn *websocket.Conn) {
					for {
						var msg Message
						err := conn.ReadJSON(&msg)
						if err != nil {
							return
						}
						if msg.Type == "price_update" {
							atomic.AddInt64(&receivedCounts[clientIndex], 1)
						}
					}
				}(i, conn)
			}

			// Wait for connections to stabilize
			time.Sleep(100 * time.Millisecond)

			// Start high-frequency broadcasting
			start := time.Now()
			for i := 0; i < tt.messageCount; i++ {
				priceUpdate := PriceUpdate{
					Symbol:    "ETH/USDT",
					Price:     decimal.NewFromFloat(2000.0 + float64(i)*0.1),
					Change24h: decimal.NewFromFloat(1.5),
					Volume24h: decimal.NewFromFloat(1000000),
					Timestamp: time.Now(),
				}
				suite.hub.BroadcastPriceUpdate(priceUpdate)
				time.Sleep(tt.broadcastRate)
			}
			broadcastDuration := time.Since(start)

			// Wait for messages to be received
			time.Sleep(500 * time.Millisecond)

			// Close all connections
			for _, conn := range clients {
				conn.Close()
			}

			// Verify results
			for i, count := range receivedCounts {
				receivedCount := atomic.LoadInt64(&count)
				successRate := float64(receivedCount) / float64(tt.messageCount)
				assert.True(t, successRate >= 0.9, "Client %d received too few messages: %d/%d (%.2f%%)",
					i, receivedCount, tt.messageCount, successRate*100)
			}

			t.Logf("High-frequency broadcasting test completed: %d messages in %v to %d clients",
				tt.messageCount, broadcastDuration, tt.clientCount)
		})
	}
}

// TestMemoryUsageUnderLoad tests memory consumption during high load
func TestMemoryUsageUnderLoad(t *testing.T) {
	suite := setupPerformanceTest(t)
	defer suite.cleanup()

	// Get initial memory stats
	var m1 runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m1)
	initialAlloc := m1.Alloc

	// Create many connections and send many messages
	const numClients = 50
	const numMessages = 1000

	var clients []*websocket.Conn

	// Create connections
	for i := 0; i < numClients; i++ {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		clients = append(clients, conn)

		// Subscribe to updates
		subMsg := Message{
			Type:  "subscribe",
			Topic: "prices",
			Data:  map[string]interface{}{"symbols": []string{"ETH/USDT", "BTC/USDT"}},
		}
		err = conn.WriteJSON(subMsg)
		require.NoError(t, err)
	}

	// Send many messages
	for i := 0; i < numMessages; i++ {
		priceUpdate := PriceUpdate{
			Symbol:    "ETH/USDT",
			Price:     decimal.NewFromFloat(2000.0 + float64(i)*0.1),
			Change24h: decimal.NewFromFloat(1.5),
			Volume24h: decimal.NewFromFloat(1000000),
			Timestamp: time.Now(),
		}
		suite.hub.BroadcastPriceUpdate(priceUpdate)

		if i%100 == 0 {
			time.Sleep(10 * time.Millisecond) // Small delay to prevent overwhelming
		}
	}

	// Wait for processing
	time.Sleep(1 * time.Second)

	// Close connections
	for _, conn := range clients {
		conn.Close()
	}

	// Wait for cleanup
	time.Sleep(500 * time.Millisecond)

	// Force garbage collection and check memory
	runtime.GC()
	runtime.GC() // Run twice to ensure cleanup
	var m2 runtime.MemStats
	runtime.ReadMemStats(&m2)
	finalAlloc := m2.Alloc

	// Memory should not have grown excessively
	memoryGrowth := finalAlloc - initialAlloc
	maxAcceptableGrowth := uint64(50 * 1024 * 1024) // 50MB

	assert.True(t, memoryGrowth < maxAcceptableGrowth,
		"Memory growth too high: %d bytes (%.2f MB), max acceptable: %d bytes (%.2f MB)",
		memoryGrowth, float64(memoryGrowth)/(1024*1024),
		maxAcceptableGrowth, float64(maxAcceptableGrowth)/(1024*1024))

	t.Logf("Memory usage test completed: initial=%d, final=%d, growth=%d bytes (%.2f MB)",
		initialAlloc, finalAlloc, memoryGrowth, float64(memoryGrowth)/(1024*1024))
}

// TestConnectionThroughput tests the maximum connection throughput
func TestConnectionThroughput(t *testing.T) {
	suite := setupPerformanceTest(t)
	defer suite.cleanup()

	const targetConnections = 200
	const maxDuration = 30 * time.Second

	start := time.Now()
	var successCount int64
	var wg sync.WaitGroup

	// Create connections as fast as possible
	for i := 0; i < targetConnections; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
			conn, _, err := websocket.DefaultDialer.Dial(url, nil)
			if err != nil {
				return
			}
			defer conn.Close()

			// Quick subscription test
			subMsg := Message{
				Type:  "subscribe",
				Topic: "prices",
				Data:  map[string]interface{}{"symbols": []string{"ETH/USDT"}},
			}
			err = conn.WriteJSON(subMsg)
			if err != nil {
				return
			}

			atomic.AddInt64(&successCount, 1)
			time.Sleep(100 * time.Millisecond) // Keep connection alive briefly
		}()

		// Small delay to prevent overwhelming the server
		if i%10 == 0 {
			time.Sleep(10 * time.Millisecond)
		}
	}

	wg.Wait()
	duration := time.Since(start)

	// Verify results
	assert.True(t, duration < maxDuration, "Throughput test took too long: %v", duration)
	successRate := float64(successCount) / float64(targetConnections)
	assert.True(t, successRate >= 0.9, "Success rate too low: %d/%d (%.2f%%)",
		successCount, targetConnections, successRate*100)

	connectionsPerSecond := float64(successCount) / duration.Seconds()
	t.Logf("Connection throughput test completed: %d connections in %v (%.2f conn/sec)",
		successCount, duration, connectionsPerSecond)
}

// TestBroadcastLatency tests message broadcast latency
func TestBroadcastLatency(t *testing.T) {
	suite := setupPerformanceTest(t)
	defer suite.cleanup()

	const numClients = 20
	const numTests = 100

	var clients []*websocket.Conn
	var latencies []time.Duration
	var mu sync.Mutex

	// Create clients
	for i := 0; i < numClients; i++ {
		url := strings.Replace(suite.server.URL, "http", "ws", 1) + "/ws/prices"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		require.NoError(t, err)
		clients = append(clients, conn)

		// Subscribe to price updates
		subMsg := Message{
			Type:  "subscribe",
			Topic: "prices",
			Data:  map[string]interface{}{"symbols": []string{"ETH/USDT"}},
		}
		err = conn.WriteJSON(subMsg)
		require.NoError(t, err)

		// Start latency measurement for this client
		go func(conn *websocket.Conn) {
			for {
				var msg Message
				err := conn.ReadJSON(&msg)
				if err != nil {
					return
				}
				if msg.Type == "price_update" {
					receiveTime := time.Now()
					if data, ok := msg.Data.(map[string]interface{}); ok {
						if timestampFloat, ok := data["timestamp"].(float64); ok {
							sendTime := time.Unix(int64(timestampFloat), 0)
							latency := receiveTime.Sub(sendTime)
							mu.Lock()
							latencies = append(latencies, latency)
							mu.Unlock()
						}
					}
				}
			}
		}(conn)
	}

	// Wait for connections to stabilize
	time.Sleep(100 * time.Millisecond)

	// Send test messages with timestamps
	for i := 0; i < numTests; i++ {
		priceUpdate := PriceUpdate{
			Symbol:    "ETH/USDT",
			Price:     decimal.NewFromFloat(2000.0 + float64(i)*0.1),
			Change24h: decimal.NewFromFloat(1.5),
			Volume24h: decimal.NewFromFloat(1000000),
			Timestamp: time.Now(),
		}
		suite.hub.BroadcastPriceUpdate(priceUpdate)
		time.Sleep(50 * time.Millisecond) // Space out messages
	}

	// Wait for all messages to be received
	time.Sleep(1 * time.Second)

	// Close connections
	for _, conn := range clients {
		conn.Close()
	}

	// Analyze latencies
	mu.Lock()
	totalLatencies := len(latencies)
	latenciesCopy := make([]time.Duration, len(latencies))
	copy(latenciesCopy, latencies)
	mu.Unlock()

	assert.True(t, totalLatencies > 0, "No latency measurements received")

	// Calculate statistics only if we have measurements
	if totalLatencies > 0 {
		var totalLatency time.Duration
		var maxLatency time.Duration
		minLatency := time.Hour // Start with a large value

		for _, latency := range latenciesCopy {
			totalLatency += latency
			if latency > maxLatency {
				maxLatency = latency
			}
			if latency < minLatency {
				minLatency = latency
			}
		}

		avgLatency := totalLatency / time.Duration(totalLatencies)

		// Verify acceptable latency
		maxAcceptableLatency := 100 * time.Millisecond
		assert.True(t, avgLatency < maxAcceptableLatency,
			"Average latency too high: %v, max acceptable: %v", avgLatency, maxAcceptableLatency)

		t.Logf("Broadcast latency test completed: %d measurements, avg=%v, min=%v, max=%v",
			totalLatencies, avgLatency, minLatency, maxLatency)
	} else {
		t.Logf("Broadcast latency test completed: no measurements received")
	}
}
