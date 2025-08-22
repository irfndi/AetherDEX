package websocket

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Client represents a WebSocket client connection
type Client struct {
	ID            string
	Conn          *websocket.Conn
	Hub           *Hub
	Send          chan []byte
	Subscriptions map[string]bool // topic -> subscribed
	UserAddress   string          // for authenticated connections
	IsAuth        bool
	mu            sync.RWMutex
	ctx           context.Context
	cancel        context.CancelFunc
}

// NewClient creates a new WebSocket client
func NewClient(conn *websocket.Conn, hub *Hub, id string) *Client {
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{
		ID:            id,
		Conn:          conn,
		Hub:           hub,
		Send:          make(chan []byte, 256),
		Subscriptions: make(map[string]bool),
		ctx:           ctx,
		cancel:        cancel,
	}
}

// ReadPump pumps messages from the WebSocket connection to the hub
func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
		c.cancel()
	}()

	c.Conn.SetReadLimit(512)
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
			_, message, err := c.Conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket error: %v", err)
				}
				return
			}

			c.handleMessage(message)
		}
	}
}

// WritePump pumps messages from the hub to the WebSocket connection
func (c *Client) WritePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
		c.cancel()
	}()

	for {
		select {
		case <-c.ctx.Done():
			return
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleMessage processes incoming WebSocket messages
func (c *Client) handleMessage(message []byte) {
	var msg Message
	if err := json.Unmarshal(message, &msg); err != nil {
		c.sendError("Invalid message format", 400)
		return
	}

	switch msg.Type {
	case MessageTypeSubscribe:
		c.handleSubscribe(msg.Topic, msg.Symbol, msg.PoolID)
	case MessageTypeUnsubscribe:
		c.handleUnsubscribe(msg.Topic, msg.Symbol, msg.PoolID)
	case MessageTypePing:
		c.sendPong()
	default:
		c.sendError("Unknown message type", 400)
	}
}

// handleSubscribe handles subscription requests
func (c *Client) handleSubscribe(topic, symbol, poolID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	var key string
	switch topic {
	case string(TopicPrices):
		if symbol == "" {
			c.sendError("Symbol required for price subscription", 400)
			return
		}
		key = topic + ":" + symbol
	case string(TopicPools):
		if poolID == "" {
			c.sendError("Pool ID required for pool subscription", 400)
			return
		}
		key = topic + ":" + poolID
	case string(TopicTrades):
		if !c.IsAuth {
			c.sendError("Authentication required for trade subscription", 401)
			return
		}
		key = topic
	default:
		c.sendError("Invalid subscription topic", 400)
		return
	}

	c.Subscriptions[key] = true
	c.Hub.Subscribe <- &Subscription{
		Client: c,
		Topic:  key,
	}

	// Send subscription confirmation
	c.sendSubscriptionConfirmation(topic, symbol, poolID)
}

// handleUnsubscribe handles unsubscription requests
func (c *Client) handleUnsubscribe(topic, symbol, poolID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	var key string
	switch topic {
	case string(TopicPrices):
		key = topic + ":" + symbol
	case string(TopicPools):
		key = topic + ":" + poolID
	case string(TopicTrades):
		key = topic
	default:
		c.sendError("Invalid subscription topic", 400)
		return
	}

	delete(c.Subscriptions, key)
	c.Hub.Unsubscribe <- &Subscription{
		Client: c,
		Topic:  key,
	}

	// Send unsubscription confirmation
	c.sendUnsubscriptionConfirmation(topic, symbol, poolID)
}

// sendError sends an error message to the client
func (c *Client) sendError(errorMsg string, code int) {
	errorResponse := ErrorMessage{
		Type:      MessageTypeError,
		Error:     errorMsg,
		Code:      code,
		Timestamp: time.Now(),
	}

	data, _ := json.Marshal(errorResponse)
	select {
	case c.Send <- data:
	default:
		close(c.Send)
	}
}

// sendPong sends a pong message to the client
func (c *Client) sendPong() {
	pongResponse := Message{
		Type:      MessageTypePong,
		Timestamp: time.Now(),
	}

	data, _ := json.Marshal(pongResponse)
	select {
	case c.Send <- data:
	default:
		close(c.Send)
	}
}

// sendSubscriptionConfirmation sends a subscription confirmation message to the client
func (c *Client) sendSubscriptionConfirmation(topic, symbol, poolID string) {
	confirmationResponse := Message{
		Type:      MessageTypeSubscribe,
		Topic:     topic,
		Symbol:    symbol,
		PoolID:    poolID,
		Timestamp: time.Now(),
	}

	data, _ := json.Marshal(confirmationResponse)
	select {
	case c.Send <- data:
	default:
		close(c.Send)
	}
}

// sendUnsubscriptionConfirmation sends an unsubscription confirmation message to the client
func (c *Client) sendUnsubscriptionConfirmation(topic, symbol, poolID string) {
	confirmationResponse := Message{
		Type:      MessageTypeUnsubscribe,
		Topic:     topic,
		Symbol:    symbol,
		PoolID:    poolID,
		Timestamp: time.Now(),
	}

	data, _ := json.Marshal(confirmationResponse)
	select {
	case c.Send <- data:
	default:
		close(c.Send)
	}
}

// IsSubscribed checks if the client is subscribed to a topic
func (c *Client) IsSubscribed(topic string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Subscriptions[topic]
}

// SetAuth sets the authentication status and user address
func (c *Client) SetAuth(userAddress string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.IsAuth = true
	c.UserAddress = userAddress
}

// Close closes the client connection
func (c *Client) Close() {
	c.cancel()
	close(c.Send)
}
