package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
)

// PerformanceTestSuite contains performance tests for the API
type PerformanceTestSuite struct {
	suite.Suite
	router *gin.Engine
	server *httptest.Server
}

// SetupSuite initializes the test suite
func (suite *PerformanceTestSuite) SetupSuite() {
	// Skip performance tests unless explicitly enabled
	if os.Getenv("PERFORMANCE_TESTS") != "true" {
		suite.T().Skip("Performance tests skipped. Set PERFORMANCE_TESTS=true to run.")
	}

	// Set Gin to test mode
	gin.SetMode(gin.TestMode)

	// Create router with test handlers
	suite.router = gin.New()
	suite.setupRoutes()

	// Create test server
	suite.server = httptest.NewServer(suite.router)
}

// TearDownSuite cleans up after tests
func (suite *PerformanceTestSuite) TearDownSuite() {
	if suite.server != nil {
		suite.server.Close()
	}
}

// setupRoutes configures test routes with mock handlers
func (suite *PerformanceTestSuite) setupRoutes() {
	api := suite.router.Group("/api/v1")
	{
		// Health check endpoint
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"status": "healthy"})
		})

		// Ping endpoint
		api.GET("/ping", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"message": "pong"})
		})

		// Mock swap quote endpoint with computation
		api.POST("/swap/quote", func(c *gin.Context) {
			var request struct {
				TokenIn  string `json:"tokenIn"`
				TokenOut string `json:"tokenOut"`
				AmountIn string `json:"amountIn"`
			}

			if err := c.ShouldBindJSON(&request); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}

			// Simulate computation-heavy quote calculation
			time.Sleep(10 * time.Millisecond)

			c.JSON(http.StatusOK, gin.H{
				"amountOut":    "2485.123456",
				"priceImpact":  "0.15",
				"fee":          "0.3",
				"route":        []string{request.TokenIn, request.TokenOut},
				"estimatedGas": "150000",
			})
		})

		// Mock tokens endpoint with large dataset
		api.GET("/tokens", func(c *gin.Context) {
			// Generate mock token data
			tokens := make([]gin.H, 1000)
			for i := 0; i < 1000; i++ {
				tokens[i] = gin.H{
					"address": fmt.Sprintf("0x%040d", i),
					"symbol":  fmt.Sprintf("TOKEN%d", i),
					"name":    fmt.Sprintf("Test Token %d", i),
					"price":   fmt.Sprintf("%.6f", float64(i)*1.234567),
					"volume":  fmt.Sprintf("%.2f", float64(i)*1000),
				}
			}

			c.JSON(http.StatusOK, gin.H{"tokens": tokens})
		})

		// Mock pools endpoint
		api.GET("/pools", func(c *gin.Context) {
			pools := make([]gin.H, 100)
			for i := 0; i < 100; i++ {
				pools[i] = gin.H{
					"id":        fmt.Sprintf("pool_%d", i),
					"token0":    fmt.Sprintf("0x%040d", i),
					"token1":    fmt.Sprintf("0x%040d", i+1),
					"liquidity": fmt.Sprintf("%.2f", float64(i)*10000),
					"volume24h": fmt.Sprintf("%.2f", float64(i)*5000),
					"fee":       "0.3",
				}
			}

			c.JSON(http.StatusOK, gin.H{"pools": pools})
		})

		// Mock CPU-intensive endpoint
		api.GET("/compute", func(c *gin.Context) {
			// Simulate CPU-intensive computation
			result := 0
			for i := 0; i < 1000000; i++ {
				result += i
			}

			c.JSON(http.StatusOK, gin.H{"result": result})
		})
	}
}

// TestPerformanceBaseline tests basic endpoint performance
func (suite *PerformanceTestSuite) TestPerformanceBaseline() {
	tests := []struct {
		name           string
		method         string
		path           string
		body           interface{}
		maxResponseTime time.Duration
	}{
		{"Health Check", "GET", "/api/v1/health", nil, 10 * time.Millisecond},
		{"Ping", "GET", "/api/v1/ping", nil, 10 * time.Millisecond},
		{"Tokens List", "GET", "/api/v1/tokens", nil, 100 * time.Millisecond},
		{"Pools List", "GET", "/api/v1/pools", nil, 50 * time.Millisecond},
		{
			"Swap Quote",
			"POST",
			"/api/v1/swap/quote",
			map[string]string{
				"tokenIn":  "0x1234567890123456789012345678901234567890",
				"tokenOut": "0x0987654321098765432109876543210987654321",
				"amountIn": "1.0",
			},
			50 * time.Millisecond,
		},
	}

	for _, test := range tests {
		suite.Run(test.name, func() {
			start := time.Now()

			var req *http.Request
			if test.body != nil {
				body, _ := json.Marshal(test.body)
				req = httptest.NewRequest(test.method, test.path, bytes.NewBuffer(body))
				req.Header.Set("Content-Type", "application/json")
			} else {
				req = httptest.NewRequest(test.method, test.path, nil)
			}

			w := httptest.NewRecorder()
			suite.router.ServeHTTP(w, req)

			duration := time.Since(start)

			// Assert response is successful
			assert.True(suite.T(), w.Code >= 200 && w.Code < 300, "Expected successful response")

			// Assert response time is within acceptable limits
			assert.True(suite.T(), duration <= test.maxResponseTime,
				"Response time %v exceeded maximum %v for %s", duration, test.maxResponseTime, test.name)

			suite.T().Logf("%s: %v", test.name, duration)
		})
	}
}

// TestConcurrentRequests tests performance under concurrent load
func (suite *PerformanceTestSuite) TestConcurrentRequests() {
	concurrencyLevels := []int{10, 50, 100}

	for _, concurrency := range concurrencyLevels {
		suite.Run(fmt.Sprintf("Concurrency_%d", concurrency), func() {
			var wg sync.WaitGroup
			responses := make(chan time.Duration, concurrency)
			errors := make(chan error, concurrency)

			start := time.Now()

			for i := 0; i < concurrency; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()

					reqStart := time.Now()
					req := httptest.NewRequest("GET", "/api/v1/health", nil)
					w := httptest.NewRecorder()
					suite.router.ServeHTTP(w, req)
					reqDuration := time.Since(reqStart)

					if w.Code != http.StatusOK {
						errors <- fmt.Errorf("request failed with status %d", w.Code)
						return
					}

					responses <- reqDuration
				}()
			}

			wg.Wait()
			totalDuration := time.Since(start)
			close(responses)
			close(errors)

			// Check for errors
			errorCount := 0
			for err := range errors {
				if err != nil {
					errorCount++
					suite.T().Logf("Error: %v", err)
				}
			}

			// Calculate response time statistics
			var responseTimes []time.Duration
			for duration := range responses {
				responseTimes = append(responseTimes, duration)
			}

			if len(responseTimes) > 0 {
				total := time.Duration(0)
				max := time.Duration(0)
				min := time.Duration(1<<63 - 1)

				for _, duration := range responseTimes {
					total += duration
					if duration > max {
						max = duration
					}
					if duration < min {
						min = duration
					}
				}

				average := total / time.Duration(len(responseTimes))

				suite.T().Logf("Concurrency %d: Total=%v, Avg=%v, Min=%v, Max=%v, Errors=%d",
					concurrency, totalDuration, average, min, max, errorCount)

				// Assertions
				assert.Equal(suite.T(), 0, errorCount, "No requests should fail")
				assert.True(suite.T(), average < 100*time.Millisecond, "Average response time should be reasonable")
				assert.True(suite.T(), max < 500*time.Millisecond, "Maximum response time should be acceptable")
			}
		})
	}
}

// TestMemoryUsage tests memory consumption
func (suite *PerformanceTestSuite) TestMemoryUsage() {
	var m1, m2 runtime.MemStats

	// Force garbage collection and get initial memory stats
	runtime.GC()
	runtime.ReadMemStats(&m1)

	// Perform multiple requests to test memory usage
	for i := 0; i < 1000; i++ {
		req := httptest.NewRequest("GET", "/api/v1/tokens", nil)
		w := httptest.NewRecorder()
		suite.router.ServeHTTP(w, req)
		assert.Equal(suite.T(), http.StatusOK, w.Code)
	}

	// Force garbage collection and get final memory stats
	runtime.GC()
	runtime.ReadMemStats(&m2)

	// Calculate memory increase
	memoryIncrease := m2.Alloc - m1.Alloc

	suite.T().Logf("Memory usage - Initial: %d bytes, Final: %d bytes, Increase: %d bytes",
		m1.Alloc, m2.Alloc, memoryIncrease)

	// Memory increase should be reasonable (less than 10MB)
	assert.True(suite.T(), memoryIncrease < 10*1024*1024,
		"Memory increase should be less than 10MB, got %d bytes", memoryIncrease)
}

// TestThroughput tests requests per second
func (suite *PerformanceTestSuite) TestThroughput() {
	duration := 5 * time.Second
	var requestCount int64
	var wg sync.WaitGroup
	done := make(chan bool)

	// Start multiple goroutines making requests
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-done:
					return
				default:
					req := httptest.NewRequest("GET", "/api/v1/ping", nil)
					w := httptest.NewRecorder()
					suite.router.ServeHTTP(w, req)
					if w.Code == http.StatusOK {
						requestCount++
					}
				}
			}
		}()
	}

	// Run for specified duration
	time.Sleep(duration)
	close(done)
	wg.Wait()

	rps := float64(requestCount) / duration.Seconds()
	suite.T().Logf("Throughput: %.2f requests/second (%d requests in %v)", rps, requestCount, duration)

	// Should handle at least 1000 requests per second
	assert.True(suite.T(), rps >= 1000, "Should handle at least 1000 requests/second, got %.2f", rps)
}

// TestCPUIntensiveEndpoint tests performance of CPU-heavy operations
func (suite *PerformanceTestSuite) TestCPUIntensiveEndpoint() {
	start := time.Now()

	req := httptest.NewRequest("GET", "/api/v1/compute", nil)
	w := httptest.NewRecorder()
	suite.router.ServeHTTP(w, req)

	duration := time.Since(start)

	assert.Equal(suite.T(), http.StatusOK, w.Code)
	assert.True(suite.T(), duration < 100*time.Millisecond,
		"CPU-intensive endpoint should complete within 100ms, took %v", duration)

	suite.T().Logf("CPU-intensive endpoint: %v", duration)
}

// BenchmarkHealthCheck benchmarks the health check endpoint
func BenchmarkHealthCheck(b *testing.B) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("GET", "/health", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
	}
}

// BenchmarkSwapQuote benchmarks the swap quote endpoint
func BenchmarkSwapQuote(b *testing.B) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/swap/quote", func(c *gin.Context) {
		var request struct {
			TokenIn  string `json:"tokenIn"`
			TokenOut string `json:"tokenOut"`
			AmountIn string `json:"amountIn"`
		}
		c.ShouldBindJSON(&request)
		c.JSON(http.StatusOK, gin.H{"amountOut": "2485.123456"})
	})

	body := bytes.NewBufferString(`{"tokenIn":"0x123","tokenOut":"0x456","amountIn":"1.0"}`)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		body.Reset()
		body.WriteString(`{"tokenIn":"0x123","tokenOut":"0x456","amountIn":"1.0"}`)
		req := httptest.NewRequest("POST", "/swap/quote", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
	}
}

// BenchmarkTokensList benchmarks the tokens list endpoint
func BenchmarkTokensList(b *testing.B) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/tokens", func(c *gin.Context) {
		tokens := make([]gin.H, 100)
		for i := 0; i < 100; i++ {
			tokens[i] = gin.H{
				"address": fmt.Sprintf("0x%040d", i),
				"symbol":  fmt.Sprintf("TOKEN%d", i),
				"name":    fmt.Sprintf("Test Token %d", i),
			}
		}
		c.JSON(http.StatusOK, gin.H{"tokens": tokens})
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("GET", "/tokens", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
	}
}

// TestPerformanceTestSuite runs the performance test suite
func TestPerformanceTestSuite(t *testing.T) {
	suite.Run(t, new(PerformanceTestSuite))
}