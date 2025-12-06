package repository

import (
	"fmt"
	"testing"

	"github.com/irfndi/AetherDEX/backend/internal/models"
	"github.com/stretchr/testify/suite"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

// UserRepositoryTestSuite provides comprehensive tests for user repository
type UserRepositoryTestSuite struct {
	suite.Suite
	db   *gorm.DB
	repo UserRepository
}

// SetupSuite initializes the test suite
func (suite *UserRepositoryTestSuite) SetupSuite() {
	// Use in-memory SQLite for testing with pure Go driver
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared&_pragma=foreign_keys(1)"), &gorm.Config{})
	suite.Require().NoError(err)

	// Auto-migrate the schema
	err = db.AutoMigrate(&models.User{}, &models.Transaction{}, &models.LiquidityPosition{})
	suite.Require().NoError(err)

	suite.db = db
	suite.repo = NewUserRepository(db)
}

// SetupTest runs before each test
func (suite *UserRepositoryTestSuite) SetupTest() {
	// Clean up database before each test
	suite.db.Exec("DELETE FROM users")
}

// TearDownSuite cleans up after all tests
func (suite *UserRepositoryTestSuite) TearDownSuite() {
	if sqlDB, err := suite.db.DB(); err == nil {
		sqlDB.Close()
	}
}

// TestCreateUser tests user creation
func (suite *UserRepositoryTestSuite) TestCreateUser() {
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user", "trader"},
		IsActive: true,
	}

	err := suite.repo.Create(user)
	suite.NoError(err)
	suite.NotZero(user.ID)
	suite.NotZero(user.CreatedAt)
}

// TestCreateUserNil tests creating nil user
func (suite *UserRepositoryTestSuite) TestCreateUserNil() {
	err := suite.repo.Create(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "user cannot be nil")
}

// TestGetUserByAddress tests retrieving user by address
func (suite *UserRepositoryTestSuite) TestGetUserByAddress() {
	// Create test user
	originalUser := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}
	err := suite.repo.Create(originalUser)
	suite.NoError(err)

	// Retrieve user
	user, err := suite.repo.GetByAddress("0x1234567890123456789012345678901234567890")
	suite.NoError(err)
	suite.NotNil(user)
	suite.Equal(originalUser.Address, user.Address)
	suite.Equal(originalUser.Nonce, user.Nonce)
}

// TestGetUserByAddressNotFound tests retrieving non-existent user
func (suite *UserRepositoryTestSuite) TestGetUserByAddressNotFound() {
	user, err := suite.repo.GetByAddress("0x0000000000000000000000000000000000000000")
	suite.NoError(err)
	suite.Nil(user)
}

// TestGetUserByAddressEmpty tests retrieving user with empty address
func (suite *UserRepositoryTestSuite) TestGetUserByAddressEmpty() {
	user, err := suite.repo.GetByAddress("")
	suite.Error(err)
	suite.Nil(user)
	suite.Contains(err.Error(), "address cannot be empty")
}

// TestGetUserByID tests retrieving user by ID
func (suite *UserRepositoryTestSuite) TestGetUserByID() {
	// Create test user
	originalUser := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}
	err := suite.repo.Create(originalUser)
	suite.NoError(err)

	// Retrieve user
	user, err := suite.repo.GetByID(originalUser.ID)
	suite.NoError(err)
	suite.NotNil(user)
	suite.Equal(originalUser.ID, user.ID)
	suite.Equal(originalUser.Address, user.Address)
}

// TestGetUserByIDNotFound tests retrieving non-existent user by ID
func (suite *UserRepositoryTestSuite) TestGetUserByIDNotFound() {
	user, err := suite.repo.GetByID(999)
	suite.NoError(err)
	suite.Nil(user)
}

// TestGetUserByIDZero tests retrieving user with zero ID
func (suite *UserRepositoryTestSuite) TestGetUserByIDZero() {
	user, err := suite.repo.GetByID(0)
	suite.Error(err)
	suite.Nil(user)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestUpdateUser tests updating user
func (suite *UserRepositoryTestSuite) TestUpdateUser() {
	// Create test user
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}
	err := suite.repo.Create(user)
	suite.NoError(err)

	// Update user
	user.Nonce = "updated-nonce"
	user.IsActive = false
	err = suite.repo.Update(user)
	suite.NoError(err)

	// Verify update
	updatedUser, err := suite.repo.GetByID(user.ID)
	suite.NoError(err)
	suite.Equal("updated-nonce", updatedUser.Nonce)
	suite.False(updatedUser.IsActive)
}

// TestUpdateUserNil tests updating nil user
func (suite *UserRepositoryTestSuite) TestUpdateUserNil() {
	err := suite.repo.Update(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "user cannot be nil")
}

// TestDeleteUser tests deleting user
func (suite *UserRepositoryTestSuite) TestDeleteUser() {
	// Create test user
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}
	err := suite.repo.Create(user)
	suite.NoError(err)

	// Delete user
	err = suite.repo.Delete(user.ID)
	suite.NoError(err)

	// Verify deletion (soft delete)
	deletedUser, err := suite.repo.GetByID(user.ID)
	suite.NoError(err)
	suite.Nil(deletedUser) // Should be nil due to soft delete
}

// TestDeleteUserZeroID tests deleting user with zero ID
func (suite *UserRepositoryTestSuite) TestDeleteUserZeroID() {
	err := suite.repo.Delete(0)
	suite.Error(err)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestListUsers tests listing users with pagination
func (suite *UserRepositoryTestSuite) TestListUsers() {
	// Create multiple test users
	for i := 0; i < 5; i++ {
		user := &models.User{
			Address:  fmt.Sprintf("0x%040d", i),
			Nonce:    fmt.Sprintf("nonce-%d", i),
			Roles:    []string{"user"},
			IsActive: true,
		}
		err := suite.repo.Create(user)
		suite.NoError(err)
	}

	// Test pagination
	users, err := suite.repo.List(3, 0)
	suite.NoError(err)
	suite.Len(users, 3)

	// Test offset
	users, err = suite.repo.List(3, 2)
	suite.NoError(err)
	suite.Len(users, 3)
}

// TestUpdateNonce tests updating user nonce
func (suite *UserRepositoryTestSuite) TestUpdateNonce() {
	// Create test user
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "old-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}
	err := suite.repo.Create(user)
	suite.NoError(err)

	// Update nonce
	err = suite.repo.UpdateNonce(user.Address, "new-nonce")
	suite.NoError(err)

	// Verify update
	updatedUser, err := suite.repo.GetByAddress(user.Address)
	suite.NoError(err)
	suite.Equal("new-nonce", updatedUser.Nonce)
}

// TestUpdateNonceEmptyParams tests updating nonce with empty parameters
func (suite *UserRepositoryTestSuite) TestUpdateNonceEmptyParams() {
	err := suite.repo.UpdateNonce("", "nonce")
	suite.Error(err)
	suite.Contains(err.Error(), "address and nonce cannot be empty")

	err = suite.repo.UpdateNonce("0x1234567890123456789012345678901234567890", "")
	suite.Error(err)
	suite.Contains(err.Error(), "address and nonce cannot be empty")
}

// TestGetActiveUsers tests retrieving active users
func (suite *UserRepositoryTestSuite) TestGetActiveUsers() {
	// Create active and inactive users
	activeUser := &models.User{
		Address:  "0x1111111111111111111111111111111111111111",
		Nonce:    "nonce1",
		Roles:    []string{"user"},
		IsActive: true,
	}
	inactiveUser := &models.User{
		Address:  "0x2222222222222222222222222222222222222222",
		Nonce:    "nonce2",
		Roles:    []string{"user"},
		IsActive: false,
	}

	err := suite.repo.Create(activeUser)
	suite.NoError(err)
	err = suite.repo.Create(inactiveUser)
	suite.NoError(err)

	// Get active users
	activeUsers, err := suite.repo.GetActiveUsers()
	suite.NoError(err)
	suite.Len(activeUsers, 1)
	suite.Equal(activeUser.Address, activeUsers[0].Address)
}

// TestAddRole tests adding role to user
func (suite *UserRepositoryTestSuite) TestAddRole() {
	// Create test user
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}
	err := suite.repo.Create(user)
	suite.NoError(err)

	// Add role
	err = suite.repo.AddRole(user.Address, "admin")
	suite.NoError(err)

	// Verify role added
	updatedUser, err := suite.repo.GetByAddress(user.Address)
	suite.NoError(err)
	suite.Contains(updatedUser.Roles, "admin")
	suite.Contains(updatedUser.Roles, "user")
}

// TestAddRoleAlreadyExists tests adding existing role
func (suite *UserRepositoryTestSuite) TestAddRoleAlreadyExists() {
	// Create test user
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}
	err := suite.repo.Create(user)
	suite.NoError(err)

	// Add existing role
	err = suite.repo.AddRole(user.Address, "user")
	suite.NoError(err)

	// Verify role not duplicated
	updatedUser, err := suite.repo.GetByAddress(user.Address)
	suite.NoError(err)
	suite.Len(updatedUser.Roles, 1)
	suite.Equal("user", updatedUser.Roles[0])
}

// TestRemoveRole tests removing role from user
func (suite *UserRepositoryTestSuite) TestRemoveRole() {
	// Create test user with multiple roles
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user", "admin", "trader"},
		IsActive: true,
	}
	err := suite.repo.Create(user)
	suite.NoError(err)

	// Remove role
	err = suite.repo.RemoveRole(user.Address, "admin")
	suite.NoError(err)

	// Verify role removed
	updatedUser, err := suite.repo.GetByAddress(user.Address)
	suite.NoError(err)
	suite.NotContains(updatedUser.Roles, "admin")
	suite.Contains(updatedUser.Roles, "user")
	suite.Contains(updatedUser.Roles, "trader")
}

// TestRoleManagementEmptyParams tests role management with empty parameters
func (suite *UserRepositoryTestSuite) TestRoleManagementEmptyParams() {
	err := suite.repo.AddRole("", "admin")
	suite.Error(err)
	suite.Contains(err.Error(), "address and role cannot be empty")

	err = suite.repo.AddRole("0x1234567890123456789012345678901234567890", "")
	suite.Error(err)
	suite.Contains(err.Error(), "address and role cannot be empty")

	err = suite.repo.RemoveRole("", "admin")
	suite.Error(err)
	suite.Contains(err.Error(), "address and role cannot be empty")

	err = suite.repo.RemoveRole("0x1234567890123456789012345678901234567890", "")
	suite.Error(err)
	suite.Contains(err.Error(), "address and role cannot be empty")
}

// TestUserRepositoryTestSuite runs the test suite
func TestUserRepositoryTestSuite(t *testing.T) {
	suite.Run(t, new(UserRepositoryTestSuite))
}
