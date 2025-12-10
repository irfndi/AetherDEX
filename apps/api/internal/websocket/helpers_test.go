package websocket

import (
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// dialWithRetry attempts to dial a WebSocket connection with retries for transient errors
func dialWithRetry(url string, header http.Header) (*websocket.Conn, *http.Response, error) {
	var conn *websocket.Conn
	var resp *http.Response
	var err error

	// Increase retries and delay for stability
	for i := 0; i < 10; i++ {
		conn, resp, err = websocket.DefaultDialer.Dial(url, header)
		if err == nil {
			return conn, resp, nil
		}
		
		// Retry on common transient errors
		errMsg := err.Error()
		if strings.Contains(errMsg, "can't assign requested address") || 
		   strings.Contains(errMsg, "connection refused") ||
		   strings.Contains(errMsg, "i/o timeout") {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		
		// If it's a different error, return immediately (or maybe retry those too?)
		// For now, let's be aggressive with retries only on known flaky errors
		return nil, resp, err
	}
	return conn, resp, err
}
