package repository

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/assert"
	_ "modernc.org/sqlite"
)

// TestModerncSQLiteDriver tests if modernc.org/sqlite driver works
func TestModerncSQLiteDriver(t *testing.T) {
	// Test direct SQL connection with modernc.org/sqlite
	db, err := sql.Open("sqlite", ":memory:")
	assert.NoError(t, err)
	defer db.Close()

	// Test basic query
	_, err = db.Exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)")
	assert.NoError(t, err)

	_, err = db.Exec("INSERT INTO test (name) VALUES (?)", "test")
	assert.NoError(t, err)

	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM test").Scan(&count)
	assert.NoError(t, err)
	assert.Equal(t, 1, count)
}
