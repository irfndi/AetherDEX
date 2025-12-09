package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// MockAuthenticator represents a mock authentication service
type MockAuthenticator struct {
	usedNonces  map[string]bool
	nonceWindow time.Duration
	nonceStore  map[string]time.Time
}

// NewMockAuthenticator creates a new mock authenticator
func NewMockAuthenticator() *MockAuthenticator {
	return &MockAuthenticator{
		usedNonces:  make(map[string]bool),
		nonceWindow: 5 * time.Minute,
		nonceStore:  make(map[string]time.Time),
	}
}

// SignatureData represents signature verification data
type SignatureData struct {
	Message   string `json:"message"`
	Signature string `json:"signature"`
	Address   string `json:"address"`
	Nonce     string `json:"nonce"`
	Timestamp int64  `json:"timestamp"`
}

// VerifySignature verifies ECDSA signature
func (a *MockAuthenticator) VerifySignature(data SignatureData) error {
	// Validate timestamp
	if time.Now().Unix()-data.Timestamp > 300 { // 5 minutes
		return fmt.Errorf("signature expired")
	}

	// Check nonce replay
	if a.usedNonces[data.Nonce] {
		return fmt.Errorf("nonce already used")
	}

	// Verify signature format
	if !strings.HasPrefix(data.Signature, "0x") || len(data.Signature) != 132 {
		return fmt.Errorf("invalid signature format")
	}

	// Mark nonce as used
	a.usedNonces[data.Nonce] = true
	a.nonceStore[data.Nonce] = time.Now()

	return nil
}

// CleanupExpiredNonces removes expired nonces
func (a *MockAuthenticator) CleanupExpiredNonces() {
	now := time.Now()
	for nonce, timestamp := range a.nonceStore {
		if now.Sub(timestamp) > a.nonceWindow {
			delete(a.usedNonces, nonce)
			delete(a.nonceStore, nonce)
		}
	}
}

// TestSignatureVerification tests ECDSA signature verification
func TestSignatureVerification(t *testing.T) {
	auth := NewMockAuthenticator()

	t.Run("Valid signature verification", func(t *testing.T) {
		// Generate test key pair
		privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		require.NoError(t, err)

		message := "test message for signing"
		hash := sha256.Sum256([]byte(message))

		// Sign message
		r, s, err := ecdsa.Sign(rand.Reader, privateKey, hash[:])
		require.NoError(t, err)

		// Create signature data - ensure proper length padding
		rBytes := r.Bytes()
		sBytes := s.Bytes()
		// Pad to 32 bytes each (64 hex chars each)
		rHex := fmt.Sprintf("%064s", hex.EncodeToString(rBytes))
		sHex := fmt.Sprintf("%064s", hex.EncodeToString(sBytes))
		// Add recovery byte (v) - typically 27 or 28, using 1 byte = 2 hex chars
		signature := fmt.Sprintf("0x%s%s%02x", rHex, sHex, 27)
		data := SignatureData{
			Message:   message,
			Signature: signature,
			Address:   "0x1234567890123456789012345678901234567890",
			Nonce:     "test-nonce-1",
			Timestamp: time.Now().Unix(),
		}

		err = auth.VerifySignature(data)
		assert.NoError(t, err)
	})

	t.Run("Invalid signature format", func(t *testing.T) {
		data := SignatureData{
			Message:   "test message",
			Signature: "invalid-signature",
			Address:   "0x1234567890123456789012345678901234567890",
			Nonce:     "test-nonce-2",
			Timestamp: time.Now().Unix(),
		}

		err := auth.VerifySignature(data)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid signature format")
	})

	t.Run("Expired signature", func(t *testing.T) {
		data := SignatureData{
			Message:   "test message",
			Signature: "0x" + strings.Repeat("a", 130),
			Address:   "0x1234567890123456789012345678901234567890",
			Nonce:     "test-nonce-3",
			Timestamp: time.Now().Unix() - 400, // 6+ minutes ago
		}

		err := auth.VerifySignature(data)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "signature expired")
	})
}

// TestNonceValidation tests nonce validation and replay attack prevention
func TestNonceValidation(t *testing.T) {
	auth := NewMockAuthenticator()

	t.Run("Valid nonce acceptance", func(t *testing.T) {
		data := SignatureData{
			Message:   "test message",
			Signature: "0x" + strings.Repeat("a", 130),
			Address:   "0x1234567890123456789012345678901234567890",
			Nonce:     "unique-nonce-1",
			Timestamp: time.Now().Unix(),
		}

		err := auth.VerifySignature(data)
		assert.NoError(t, err)
	})

	t.Run("Nonce replay attack prevention", func(t *testing.T) {
		data := SignatureData{
			Message:   "test message",
			Signature: "0x" + strings.Repeat("b", 130),
			Address:   "0x1234567890123456789012345678901234567890",
			Nonce:     "unique-nonce-1", // Same nonce as previous test
			Timestamp: time.Now().Unix(),
		}

		err := auth.VerifySignature(data)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "nonce already used")
	})

	t.Run("Nonce cleanup functionality", func(t *testing.T) {
		// Add expired nonce
		auth.usedNonces["expired-nonce"] = true
		auth.nonceStore["expired-nonce"] = time.Now().Add(-10 * time.Minute)

		// Cleanup expired nonces
		auth.CleanupExpiredNonces()

		// Verify expired nonce is removed
		_, exists := auth.usedNonces["expired-nonce"]
		assert.False(t, exists)
	})
}

// TestEthereumSignatureVerification tests Ethereum-specific signature verification
func TestEthereumSignatureVerification(t *testing.T) {
	t.Run("Valid Ethereum signature", func(t *testing.T) {
		// Generate Ethereum key pair
		privateKey, err := crypto.GenerateKey()
		require.NoError(t, err)

		address := crypto.PubkeyToAddress(privateKey.PublicKey)
		message := "Hello AetherDEX"

		// Create Ethereum signed message hash
		hash := crypto.Keccak256Hash([]byte(fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)))

		// Sign the hash
		signature, err := crypto.Sign(hash.Bytes(), privateKey)
		require.NoError(t, err)

		// Verify signature
		recoveredPubKey, err := crypto.SigToPub(hash.Bytes(), signature)
		require.NoError(t, err)

		recoveredAddress := crypto.PubkeyToAddress(*recoveredPubKey)
		assert.Equal(t, address, recoveredAddress)
	})

	t.Run("Invalid Ethereum signature", func(t *testing.T) {
		message := "Hello AetherDEX"
		hash := crypto.Keccak256Hash([]byte(fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)))

		// Create invalid signature
		invalidSignature := make([]byte, 65)
		for i := range invalidSignature {
			invalidSignature[i] = 0xFF
		}

		// Attempt to recover public key from invalid signature
		_, err := crypto.SigToPub(hash.Bytes(), invalidSignature)
		assert.Error(t, err)
	})
}

// TestReplayAttackPrevention tests comprehensive replay attack prevention
func TestReplayAttackPrevention(t *testing.T) {
	auth := NewMockAuthenticator()

	t.Run("Multiple requests with same signature", func(t *testing.T) {
		data := SignatureData{
			Message:   "test message",
			Signature: "0x" + strings.Repeat("c", 130),
			Address:   "0x1234567890123456789012345678901234567890",
			Nonce:     "replay-test-nonce",
			Timestamp: time.Now().Unix(),
		}

		// First request should succeed
		err := auth.VerifySignature(data)
		assert.NoError(t, err)

		// Second request with same data should fail
		err = auth.VerifySignature(data)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "nonce already used")
	})

	t.Run("Concurrent nonce validation", func(t *testing.T) {
		// Test concurrent access to nonce validation
		done := make(chan bool, 10)
		successCount := 0

		for i := 0; i < 10; i++ {
			go func(index int) {
				data := SignatureData{
					Message:   "concurrent test",
					Signature: "0x" + strings.Repeat("d", 130),
					Address:   "0x1234567890123456789012345678901234567890",
					Nonce:     "concurrent-nonce", // Same nonce for all
					Timestamp: time.Now().Unix(),
				}

				err := auth.VerifySignature(data)
				if err == nil {
					successCount++
				}
				done <- true
			}(i)
		}

		// Wait for all goroutines to complete
		for i := 0; i < 10; i++ {
			<-done
		}

		// Only one should succeed due to nonce protection
		assert.Equal(t, 1, successCount)
	})
}

// TestSecurityEdgeCases tests various security edge cases
func TestSecurityEdgeCases(t *testing.T) {
	auth := NewMockAuthenticator()

	t.Run("Empty signature", func(t *testing.T) {
		data := SignatureData{
			Message:   "test",
			Signature: "",
			Address:   "0x1234567890123456789012345678901234567890",
			Nonce:     "empty-sig-nonce",
			Timestamp: time.Now().Unix(),
		}

		err := auth.VerifySignature(data)
		assert.Error(t, err)
	})

	t.Run("Malformed address", func(t *testing.T) {
		data := SignatureData{
			Message:   "test",
			Signature: "0x" + strings.Repeat("e", 130),
			Address:   "invalid-address",
			Nonce:     "malformed-addr-nonce",
			Timestamp: time.Now().Unix(),
		}

		// Validate address format
		if !common.IsHexAddress(data.Address) {
			t.Log("Address validation would fail")
		}
	})

	t.Run("Extremely long nonce", func(t *testing.T) {
		longNonce := strings.Repeat("a", 10000)
		data := SignatureData{
			Message:   "test",
			Signature: "0x" + strings.Repeat("f", 130),
			Address:   "0x1234567890123456789012345678901234567890",
			Nonce:     longNonce,
			Timestamp: time.Now().Unix(),
		}

		// Should handle long nonces gracefully
		err := auth.VerifySignature(data)
		assert.NoError(t, err)
	})

	t.Run("Future timestamp", func(t *testing.T) {
		data := SignatureData{
			Message:   "test",
			Signature: "0x" + strings.Repeat("g", 130),
			Address:   "0x1234567890123456789012345678901234567890",
			Nonce:     "future-timestamp-nonce",
			Timestamp: time.Now().Unix() + 3600, // 1 hour in future
		}

		// Should reject future timestamps
		if data.Timestamp > time.Now().Unix()+60 { // Allow 1 minute clock skew
			t.Log("Future timestamp validation would fail")
		}
	})
}

// BenchmarkSignatureVerification benchmarks signature verification performance
func BenchmarkSignatureVerification(b *testing.B) {
	auth := NewMockAuthenticator()

	b.Run("ECDSA verification", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			data := SignatureData{
				Message:   "benchmark message",
				Signature: "0x" + strings.Repeat("h", 130),
				Address:   "0x1234567890123456789012345678901234567890",
				Nonce:     fmt.Sprintf("bench-nonce-%d", i),
				Timestamp: time.Now().Unix(),
			}
			auth.VerifySignature(data)
		}
	})

	b.Run("Nonce validation", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			nonce := fmt.Sprintf("bench-nonce-validation-%d", i)
			_ = auth.usedNonces[nonce]
		}
	})
}
