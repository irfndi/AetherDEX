package websocket

import (
	"time"

	"github.com/shopspring/decimal"
)

// MessageType represents different types of WebSocket messages
type MessageType string

const (
	MessageTypeSubscribe             MessageType = "subscribe"
	MessageTypeSubscriptionConfirmed MessageType = "subscription_confirmed"
	MessageTypeUnsubscribe           MessageType = "unsubscribe"
	MessageTypeUnsubscriptionConfirmed MessageType = "unsubscription_confirmed"
	MessageTypePriceUpdate           MessageType = "price_update"
	MessageTypePoolUpdate  MessageType = "pool_update"
	MessageTypeError       MessageType = "error"
	MessageTypePing        MessageType = "ping"
	MessageTypePong        MessageType = "pong"
)

// SubscriptionTopic represents different subscription topics
type SubscriptionTopic string

const (
	TopicPrices SubscriptionTopic = "prices"
	TopicPools  SubscriptionTopic = "pools"
	TopicTrades SubscriptionTopic = "trades"
)

// Message represents a generic WebSocket message
type Message struct {
	Type      MessageType `json:"type"`
	Topic     string      `json:"topic,omitempty"`
	Symbol    string      `json:"symbol,omitempty"`
	PoolID    string      `json:"pool_id,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Timestamp time.Time   `json:"timestamp"`
	Error     string      `json:"error,omitempty"`
}

// PriceUpdate represents a price update message
type PriceUpdate struct {
	Symbol    string          `json:"symbol"`
	Price     decimal.Decimal `json:"price"`
	Change24h decimal.Decimal `json:"change_24h"`
	Volume24h decimal.Decimal `json:"volume_24h"`
	High24h   decimal.Decimal `json:"high_24h,omitempty"`
	Low24h    decimal.Decimal `json:"low_24h,omitempty"`
	Timestamp time.Time       `json:"timestamp"`
}

// PoolUpdate represents a pool update message
type PoolUpdate struct {
	PoolID    string          `json:"pool_id"`
	Token0    string          `json:"token0,omitempty"`
	Token1    string          `json:"token1,omitempty"`
	Liquidity decimal.Decimal `json:"liquidity"`
	Reserve0  decimal.Decimal `json:"reserve0"`
	Reserve1  decimal.Decimal `json:"reserve1"`
	Volume24h decimal.Decimal `json:"volume_24h"`
	TVL       decimal.Decimal `json:"tvl,omitempty"`
	FeeRate   decimal.Decimal `json:"fee_rate,omitempty"`
	Timestamp time.Time       `json:"timestamp"`
}

// TradeUpdate represents a trade update message
type TradeUpdate struct {
	PoolID      string          `json:"pool_id"`
	TxHash      string          `json:"tx_hash"`
	UserAddress string          `json:"user_address,omitempty"`
	TokenIn     string          `json:"token_in"`
	TokenOut    string          `json:"token_out"`
	AmountIn    decimal.Decimal `json:"amount_in"`
	AmountOut   decimal.Decimal `json:"amount_out"`
	Price       decimal.Decimal `json:"price"`
	Timestamp   time.Time       `json:"timestamp"`
}

// SubscriptionRequest represents a subscription request
type SubscriptionRequest struct {
	Type   MessageType `json:"type"`
	Topic  string      `json:"topic"`
	Symbol string      `json:"symbol,omitempty"`
	PoolID string      `json:"pool_id,omitempty"`
}

// ErrorMessage represents an error message
type ErrorMessage struct {
	Type      MessageType `json:"type"`
	Error     string      `json:"error"`
	Code      int         `json:"code,omitempty"`
	Timestamp time.Time   `json:"timestamp"`
}

// ConnectionStats represents WebSocket connection statistics
type ConnectionStats struct {
	TotalConnections   int       `json:"total_connections"`
	ActiveConnections  int       `json:"active_connections"`
	TotalSubscriptions int       `json:"total_subscriptions"`
	MessagesSent       int64     `json:"messages_sent"`
	MessagesReceived   int64     `json:"messages_received"`
	LastUpdate         time.Time `json:"last_update"`
}
