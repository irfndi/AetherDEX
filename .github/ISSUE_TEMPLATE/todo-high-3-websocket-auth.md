---
name: "[HIGH] Implement WebSocket Token Validation"
about: WebSocket authentication is incomplete
title: 'Implement actual token validation in WebSocket handlers'
labels: ['high-priority', 'backend', 'security', 'websocket']
assignees: ''
---

## 🟠 High Priority: WebSocket Token Validation Missing

**Priority:** P1 - HIGH
**Component:** Backend API - WebSocket
**File:** `apps/api/internal/websocket/handlers.go:202`

### Problem

The authenticated WebSocket endpoint has incomplete token validation. The TODO indicates validation logic needs to be implemented.

**Current code (line 202):**
```go
// TODO: Implement actual token validation
```

This creates a security gap where authenticated WebSocket connections may not properly verify user identity.

### Impact

- ⚠️ WebSocket authentication incomplete
- ⚠️ Potential unauthorized access to user-specific events
- ⚠️ Cannot verify JWT token expiration
- ⚠️ Risk of token replay attacks

### Current State Analysis

**What exists:**
- ✅ Auth middleware in `apps/api/internal/auth/middleware.go`
- ✅ Ethereum signature verification (EIP-191)
- ✅ Nonce-based replay prevention
- ✅ WebSocket auth context key setup

**What's missing:**
- ❌ Token validation in WebSocket upgrade handler
- ❌ Token expiration checking
- ❌ Token refresh mechanism for long-lived connections

**Auth context key mismatch:**
```go
// middleware.go sets: "user_address"
ctx = context.WithValue(ctx, "user_address", address)

// server.go expects: "userAddress"
userAddress, ok := r.Context().Value("userAddress").(string)
```
This will always fail! Need to fix key mismatch.

### Solution

**Step 1: Fix Context Key Mismatch**

Update `apps/api/internal/websocket/server.go:93` to use correct key:
```go
// Before
userAddress, ok := r.Context().Value("userAddress").(string)

// After
userAddress, ok := r.Context().Value("user_address").(string)
```

**Step 2: Implement Token Validation**

Add validation function in `apps/api/internal/websocket/handlers.go`:

```go
package websocket

import (
    "context"
    "errors"
    "time"
    "github.com/golang-jwt/jwt/v5"
)

// ValidateWebSocketToken validates JWT token from query params or headers
func ValidateWebSocketToken(ctx context.Context, token string) (*Claims, error) {
    if token == "" {
        return nil, errors.New("token is required")
    }

    // Parse JWT token
    claims := &Claims{}
    parsedToken, err := jwt.ParseWithClaims(token, claims, func(token *jwt.Token) (interface{}, error) {
        // Verify signing method
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, errors.New("invalid signing method")
        }
        return []byte(getJWTSecret()), nil
    })

    if err != nil {
        return nil, errors.New("invalid token")
    }

    if !parsedToken.Valid {
        return nil, errors.New("token is not valid")
    }

    // Verify token not expired
    if claims.ExpiresAt != nil && claims.ExpiresAt.Before(time.Now()) {
        return nil, errors.New("token has expired")
    }

    // Verify user address format
    if !isValidEthereumAddress(claims.Address) {
        return nil, errors.New("invalid address in token")
    }

    return claims, nil
}

// Claims structure for JWT
type Claims struct {
    Address string `json:"address"`
    Nonce   string `json:"nonce"`
    jwt.RegisteredClaims
}

// Helper to validate Ethereum address format
func isValidEthereumAddress(address string) bool {
    if len(address) != 42 {
        return false
    }
    if address[:2] != "0x" {
        return false
    }
    // Additional validation can be added
    return true
}
```

**Step 3: Update WebSocket Upgrade Handler**

Modify `apps/api/internal/websocket/server.go`:

```go
func (s *Server) handleWebSocketConnection(w http.ResponseWriter, r *http.Request) {
    // Get token from query parameter or header
    token := r.URL.Query().Get("token")
    if token == "" {
        token = r.Header.Get("Authorization")
        if len(token) > 7 && token[:7] == "Bearer " {
            token = token[7:]
        }
    }

    // Validate token for authenticated endpoint
    if r.URL.Path == "/ws/authenticated" {
        claims, err := ValidateWebSocketToken(r.Context(), token)
        if err != nil {
            http.Error(w, "Unauthorized: "+err.Error(), http.StatusUnauthorized)
            return
        }

        // Add validated address to context
        ctx := context.WithValue(r.Context(), "user_address", claims.Address)
        r = r.WithContext(ctx)
    }

    // Proceed with WebSocket upgrade
    conn, err := s.upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Printf("WebSocket upgrade error: %v", err)
        return
    }

    // Rest of connection handling...
    client := NewClient(s.hub, conn, userAddress)
    s.hub.register <- client

    go client.writePump()
    go client.readPump()
}
```

**Step 4: Handle Token Expiration for Long-Lived Connections**

Add token refresh mechanism:

```go
// In client.go
type Client struct {
    hub         *Hub
    conn        *websocket.Conn
    send        chan []byte
    address     string
    tokenExpiry time.Time  // NEW
}

// Check token expiration periodically
func (c *Client) checkTokenExpiration() {
    ticker := time.NewTicker(1 * time.Minute)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            if time.Now().After(c.tokenExpiry) {
                // Token expired, request refresh
                c.send <- []byte(`{"type":"token_expired","message":"Please refresh your token"}`)
                c.hub.unregister <- c
                c.conn.Close()
                return
            }
        }
    }
}
```

### Implementation Steps

1. **Fix context key mismatch** (5 minutes)
   - Update `server.go:93` to use `"user_address"`

2. **Add token validation function** (1 hour)
   - Create `ValidateWebSocketToken` in `handlers.go`
   - Add JWT parsing and validation
   - Add expiration checking

3. **Update WebSocket upgrade** (30 minutes)
   - Extract token from query/header
   - Validate token before upgrade
   - Set validated address in context

4. **Add token expiration handling** (1 hour)
   - Track token expiry in Client struct
   - Add periodic expiration check
   - Send refresh notification to client

5. **Add tests** (2 hours)
   - Unit test: Valid token accepted
   - Unit test: Expired token rejected
   - Unit test: Invalid signature rejected
   - Integration: Long-lived connection with token refresh

### Acceptance Criteria

- [ ] Context key mismatch fixed (`"user_address"`)
- [ ] Token validation function implemented
- [ ] JWT token parsed and validated
- [ ] Token expiration checked
- [ ] Invalid tokens rejected (401 response)
- [ ] Expired tokens trigger refresh notification
- [ ] Unit tests for token validation
- [ ] Integration test for authenticated WebSocket
- [ ] TODO comment removed from code

### Testing Checklist

- [ ] Valid JWT token → WebSocket connects successfully
- [ ] Expired JWT token → Connection rejected (401)
- [ ] Invalid JWT signature → Connection rejected (401)
- [ ] Missing token on `/ws/authenticated` → Rejected (401)
- [ ] Token expires during connection → Disconnect + refresh message
- [ ] Public endpoints (`/ws/prices`) → No token required

### Related Files

- `apps/api/internal/websocket/handlers.go` - Add validation function (line 202)
- `apps/api/internal/websocket/server.go` - Update upgrade handler (line 93)
- `apps/api/internal/websocket/client.go` - Add token expiry tracking
- `apps/api/internal/auth/middleware.go` - Reference for signature validation
- `apps/api/internal/websocket/handlers_test.go` - Add tests

### Security Considerations

**Token Storage:**
- Frontend should store JWT in memory (not localStorage)
- Use secure HTTP-only cookies if possible
- Implement token refresh before expiration

**Token Transmission:**
- Prefer query parameter for WebSocket (headers not always available)
- Use TLS/WSS in production
- Consider short-lived tokens (5-15 minutes)

**Rate Limiting:**
- Implement connection rate limiting per address
- Prevent token brute-force attempts
- Track failed authentication attempts

### Timeline

- **Target:** Sprint 1 (Week 1)
- **Estimated effort:** 6-8 hours
- **Dependencies:** Auth middleware (already exists)

### Additional Context

**Why query parameter for token?**
- WebSocket upgrade happens before full HTTP headers parsed
- Some clients don't support custom headers on WebSocket
- Query param is most compatible approach

**Token refresh flow:**
```
1. Client connects with token (5min expiry)
2. After 4 minutes, client receives "token_expiring" message
3. Client requests refresh from /api/auth/refresh
4. Client receives new token
5. Client reconnects with new token
6. Old connection gracefully closes
```

---

**Priority:** 🟠 HIGH - Security Gap
**Labels:** `high-priority`, `backend`, `security`, `websocket`
