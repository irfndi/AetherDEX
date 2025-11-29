package websocket

import (
	"encoding/json"
	"log"
	"sync"
	"time"
)

// Subscription represents a client subscription to a topic
type Subscription struct {
	Client *Client
	Topic  string
}

// Hub maintains the set of active clients and broadcasts messages to the clients
type Hub struct {
	// Registered clients
	Clients map[*Client]bool

	// Inbound messages from the clients
	Broadcast chan []byte

	// Register requests from the clients
	Register chan *Client

	// Unregister requests from clients
	Unregister chan *Client

	// Subscribe requests from clients
	Subscribe chan *Subscription

	// Unsubscribe requests from clients
	Unsubscribe chan *Subscription

	// Topic subscriptions: topic -> clients
	Subscriptions map[string]map[*Client]bool

	// Statistics
	Stats ConnectionStats

	// Mutex for thread safety
	mu sync.RWMutex

	// Channel to stop the hub
	stop chan struct{}

	// Ensure stop is only called once
	stopOnce sync.Once
}

// NewHub creates a new WebSocket hub
func NewHub() *Hub {
	return &Hub{
		Clients:       make(map[*Client]bool),
		Broadcast:     make(chan []byte),
		Register:      make(chan *Client),
		Unregister:    make(chan *Client),
		Subscribe:     make(chan *Subscription),
		Unsubscribe:   make(chan *Subscription),
		Subscriptions: make(map[string]map[*Client]bool),
		stop:          make(chan struct{}),
		Stats: ConnectionStats{
			LastUpdate: time.Now(),
		},
	}
}

// Run starts the hub and handles client connections and messages
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.registerClient(client)

		case client := <-h.Unregister:
			h.unregisterClient(client)

		case subscription := <-h.Subscribe:
			h.subscribeClient(subscription)

		case subscription := <-h.Unsubscribe:
			h.unsubscribeClient(subscription)

		case message := <-h.Broadcast:
			h.broadcastMessage(message)

		case <-h.stop:
			return
		}
	}
}

// registerClient registers a new client
func (h *Hub) registerClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.Clients[client] = true
	h.Stats.TotalConnections++
	h.Stats.ActiveConnections++
	h.Stats.LastUpdate = time.Now()

	log.Printf("Client %s registered. Active connections: %d", client.ID, h.Stats.ActiveConnections)
}

// unregisterClient unregisters a client and cleans up subscriptions
func (h *Hub) unregisterClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.Clients[client]; ok {
		delete(h.Clients, client)
		close(client.Send)
		h.Stats.ActiveConnections--
		h.Stats.LastUpdate = time.Now()

		// Remove client from all subscriptions
		for topic, clients := range h.Subscriptions {
			if _, subscribed := clients[client]; subscribed {
				delete(clients, client)
				h.Stats.TotalSubscriptions--
				// Clean up empty topic subscriptions
				if len(clients) == 0 {
					delete(h.Subscriptions, topic)
				}
			}
		}

		log.Printf("Client %s unregistered. Active connections: %d", client.ID, h.Stats.ActiveConnections)
	}
}

// subscribeClient subscribes a client to a topic
func (h *Hub) subscribeClient(subscription *Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.Subscriptions[subscription.Topic] == nil {
		h.Subscriptions[subscription.Topic] = make(map[*Client]bool)
	}

	if !h.Subscriptions[subscription.Topic][subscription.Client] {
		h.Subscriptions[subscription.Topic][subscription.Client] = true
		h.Stats.TotalSubscriptions++
		h.Stats.LastUpdate = time.Now()

		log.Printf("Client %s subscribed to topic %s", subscription.Client.ID, subscription.Topic)
	}
}

// unsubscribeClient unsubscribes a client from a topic
func (h *Hub) unsubscribeClient(subscription *Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if clients, exists := h.Subscriptions[subscription.Topic]; exists {
		if _, subscribed := clients[subscription.Client]; subscribed {
			delete(clients, subscription.Client)
			h.Stats.TotalSubscriptions--
			h.Stats.LastUpdate = time.Now()

			// Clean up empty topic subscriptions
			if len(clients) == 0 {
				delete(h.Subscriptions, subscription.Topic)
			}

			log.Printf("Client %s unsubscribed from topic %s", subscription.Client.ID, subscription.Topic)
		}
	}
}

// broadcastMessage broadcasts a message to all connected clients
func (h *Hub) broadcastMessage(message []byte) {
	h.mu.RLock()
	clientsToRemove := make([]*Client, 0)
	messagesSent := int64(0)
	for client := range h.Clients {
		select {
		case client.Send <- message:
			messagesSent++
		default:
			close(client.Send)
			clientsToRemove = append(clientsToRemove, client)
		}
	}
	h.mu.RUnlock()

	// Remove clients after iteration to avoid map modification during iteration
	if len(clientsToRemove) > 0 {
		h.mu.Lock()
		for _, client := range clientsToRemove {
			delete(h.Clients, client)
		}
		h.mu.Unlock()
	}

	// Update all stats under mutex for consistency
	h.mu.Lock()
	h.Stats.MessagesSent += messagesSent
	h.Stats.LastUpdate = time.Now()
	h.mu.Unlock()
}

// BroadcastToTopic broadcasts a message to all clients subscribed to a specific topic
func (h *Hub) BroadcastToTopic(topic string, message interface{}) {
	// Make a copy of the clients while holding the read lock to avoid data race
	h.mu.RLock()
	originalClients, exists := h.Subscriptions[topic]
	if !exists || len(originalClients) == 0 {
		h.mu.RUnlock()
		return
	}

	// Copy the clients map to iterate over safely
	clients := make([]*Client, 0, len(originalClients))
	for client := range originalClients {
		clients = append(clients, client)
	}
	h.mu.RUnlock()

	data, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling message for topic %s: %v", topic, err)
		return
	}

	// Track clients to remove
	clientsToRemove := make([]*Client, 0)
	messagesSent := int64(0)

	// Send messages to clients
	for _, client := range clients {
		select {
		case client.Send <- data:
			messagesSent++
		default:
			// Client's send channel is full, mark for removal
			close(client.Send)
			clientsToRemove = append(clientsToRemove, client)
		}
	}

	// Remove disconnected clients after iteration
	if len(clientsToRemove) > 0 {
		h.mu.Lock()
		for _, client := range clientsToRemove {
			delete(h.Clients, client)
			if topicClients, ok := h.Subscriptions[topic]; ok {
				delete(topicClients, client)
			}
		}
		h.mu.Unlock()
	}

	// Update all stats under mutex for consistency (avoid mixing atomic and mutex)
	if messagesSent > 0 || len(clientsToRemove) > 0 {
		h.mu.Lock()
		h.Stats.MessagesSent += messagesSent
		h.Stats.LastUpdate = time.Now()
		h.mu.Unlock()
	}
}

// BroadcastPriceUpdate broadcasts a price update to subscribed clients
func (h *Hub) BroadcastPriceUpdate(priceUpdate PriceUpdate) {
	topic := string(TopicPrices) + ":" + priceUpdate.Symbol
	message := Message{
		Type:      MessageTypePriceUpdate,
		Topic:     string(TopicPrices),
		Symbol:    priceUpdate.Symbol,
		Data:      priceUpdate,
		Timestamp: time.Now(),
	}
	h.BroadcastToTopic(topic, message)
}

// BroadcastPoolUpdate broadcasts a pool update to subscribed clients
func (h *Hub) BroadcastPoolUpdate(poolUpdate PoolUpdate) {
	topic := string(TopicPools) + ":" + poolUpdate.PoolID
	message := Message{
		Type:      MessageTypePoolUpdate,
		Topic:     string(TopicPools),
		PoolID:    poolUpdate.PoolID,
		Data:      poolUpdate,
		Timestamp: time.Now(),
	}
	h.BroadcastToTopic(topic, message)
}

// GetStats returns current connection statistics
func (h *Hub) GetStats() ConnectionStats {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.Stats
}

// GetClientCount returns the number of active clients
func (h *Hub) GetClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.Clients)
}

// GetSubscriptionCount returns the total number of subscriptions
func (h *Hub) GetSubscriptionCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for _, clients := range h.Subscriptions {
		count += len(clients)
	}
	return count
}

// Stop stops the hub and closes all client connections
func (h *Hub) Stop() {
	h.stopOnce.Do(func() {
		// Signal the hub to stop first
		close(h.stop)

		// Close all client connections gracefully using channel-based approach
		// to avoid concurrent WebSocket write conflicts with WritePump goroutines
		h.mu.Lock()
		clientsToClose := make([]*Client, 0, len(h.Clients))
		for client := range h.Clients {
			if client != nil {
				clientsToClose = append(clientsToClose, client)
			}
			delete(h.Clients, client)
		}
		h.mu.Unlock()

		// Close clients outside the lock to avoid blocking
		// The WritePump goroutine handles sending the close message
		for _, client := range clientsToClose {
			// Only cancel context - WritePump will detect Send channel closure
			// and handle the WebSocket close message properly
			client.Close()
		}
	})
}
