package mock_tests

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

// TestPureGoSQLiteDriver tests that the pure Go SQLite driver works without CGO
func TestPureGoSQLiteDriver(t *testing.T) {
	// Open an in-memory SQLite database using pure Go driver
	db, err := sql.Open("sqlite", ":memory:")
	require.NoError(t, err)
	defer db.Close()

	// Test database connection
	err = db.Ping()
	require.NoError(t, err)

	// Create a test table
	_, err = db.Exec(`
		CREATE TABLE test_users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			address TEXT UNIQUE NOT NULL,
			nonce TEXT,
			is_active BOOLEAN DEFAULT true,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	require.NoError(t, err)

	// Insert test data
	_, err = db.Exec(
		"INSERT INTO test_users (address, nonce, is_active) VALUES (?, ?, ?)",
		"0x1234567890123456789012345678901234567890",
		"test-nonce-123",
		true,
	)
	require.NoError(t, err)

	// Query the data
	var address, nonce string
	var isActive bool
	err = db.QueryRow(
		"SELECT address, nonce, is_active FROM test_users WHERE address = ?",
		"0x1234567890123456789012345678901234567890",
	).Scan(&address, &nonce, &isActive)
	require.NoError(t, err)

	// Verify the data
	assert.Equal(t, "0x1234567890123456789012345678901234567890", address)
	assert.Equal(t, "test-nonce-123", nonce)
	assert.True(t, isActive)

	// Test update operation
	_, err = db.Exec(
		"UPDATE test_users SET nonce = ? WHERE address = ?",
		"updated-nonce-456",
		"0x1234567890123456789012345678901234567890",
	)
	require.NoError(t, err)

	// Verify update
	err = db.QueryRow(
		"SELECT nonce FROM test_users WHERE address = ?",
		"0x1234567890123456789012345678901234567890",
	).Scan(&nonce)
	require.NoError(t, err)
	assert.Equal(t, "updated-nonce-456", nonce)

	// Test delete operation
	_, err = db.Exec(
		"DELETE FROM test_users WHERE address = ?",
		"0x1234567890123456789012345678901234567890",
	)
	require.NoError(t, err)

	// Verify deletion
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM test_users").Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

// TestPureGoSQLiteTransactions tests transaction support in pure Go SQLite
func TestPureGoSQLiteTransactions(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	require.NoError(t, err)
	defer db.Close()

	// Create test table
	_, err = db.Exec(`
		CREATE TABLE test_accounts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			balance DECIMAL(18,8) DEFAULT 0
		)
	`)
	require.NoError(t, err)

	// Insert initial data
	_, err = db.Exec("INSERT INTO test_accounts (name, balance) VALUES (?, ?), (?, ?)",
		"Alice", 100.0, "Bob", 50.0)
	require.NoError(t, err)

	// Test successful transaction
	tx, err := db.Begin()
	require.NoError(t, err)

	// Transfer 25 from Alice to Bob
	_, err = tx.Exec("UPDATE test_accounts SET balance = balance - ? WHERE name = ?", 25.0, "Alice")
	require.NoError(t, err)

	_, err = tx.Exec("UPDATE test_accounts SET balance = balance + ? WHERE name = ?", 25.0, "Bob")
	require.NoError(t, err)

	err = tx.Commit()
	require.NoError(t, err)

	// Verify balances
	var aliceBalance, bobBalance float64
	err = db.QueryRow("SELECT balance FROM test_accounts WHERE name = ?", "Alice").Scan(&aliceBalance)
	require.NoError(t, err)
	assert.Equal(t, 75.0, aliceBalance)

	err = db.QueryRow("SELECT balance FROM test_accounts WHERE name = ?", "Bob").Scan(&bobBalance)
	require.NoError(t, err)
	assert.Equal(t, 75.0, bobBalance)

	// Test rollback transaction
	tx, err = db.Begin()
	require.NoError(t, err)

	_, err = tx.Exec("UPDATE test_accounts SET balance = balance - ? WHERE name = ?", 100.0, "Alice")
	require.NoError(t, err)

	// Rollback the transaction
	err = tx.Rollback()
	require.NoError(t, err)

	// Verify balances are unchanged
	err = db.QueryRow("SELECT balance FROM test_accounts WHERE name = ?", "Alice").Scan(&aliceBalance)
	require.NoError(t, err)
	assert.Equal(t, 75.0, aliceBalance) // Should still be 75, not -25
}
