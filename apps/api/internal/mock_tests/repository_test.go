package mock_tests

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/irfndi/AetherDEX/backend/internal/models"
	"github.com/irfndi/AetherDEX/backend/internal/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
)

// MockUserRepository implements repository.UserRepository interface for testing
type MockUserRepository struct {
	users  map[string]*models.User
	nextID uint
}

func NewMockUserRepository() *MockUserRepository {
	return &MockUserRepository{
		users:  make(map[string]*models.User),
		nextID: 1,
	}
}

func (m *MockUserRepository) Create(user *models.User) error {
	if user == nil {
		return errors.New("user cannot be nil")
	}
	if user.Address == "" {
		return errors.New("user address cannot be empty")
	}
	if _, exists := m.users[user.Address]; exists {
		return errors.New("user already exists")
	}
	user.ID = m.nextID
	m.nextID++
	user.CreatedAt = time.Now()
	user.UpdatedAt = time.Now()
	m.users[user.Address] = user
	return nil
}

func (m *MockUserRepository) GetByAddress(address string) (*models.User, error) {
	if address == "" {
		return nil, errors.New("address cannot be empty")
	}
	user, exists := m.users[address]
	if !exists {
		return nil, nil
	}
	return user, nil
}

func (m *MockUserRepository) GetByID(id uint) (*models.User, error) {
	for _, user := range m.users {
		if user.ID == id {
			return user, nil
		}
	}
	return nil, nil
}

func (m *MockUserRepository) Update(user *models.User) error {
	if user == nil {
		return errors.New("user cannot be nil")
	}
	existingUser, exists := m.users[user.Address]
	if !exists {
		return errors.New("user not found")
	}
	existingUser.Nonce = user.Nonce
	existingUser.Roles = user.Roles
	existingUser.IsActive = user.IsActive
	existingUser.UpdatedAt = time.Now()
	return nil
}

func (m *MockUserRepository) Delete(id uint) error {
	for address, user := range m.users {
		if user.ID == id {
			delete(m.users, address)
			return nil
		}
	}
	return errors.New("user not found")
}

func (m *MockUserRepository) List(limit, offset int) ([]*models.User, error) {
	users := make([]*models.User, 0, len(m.users))
	for _, user := range m.users {
		users = append(users, user)
	}

	start := offset
	if start >= len(users) {
		return []*models.User{}, nil
	}

	end := start + limit
	if end > len(users) {
		end = len(users)
	}

	return users[start:end], nil
}

func (m *MockUserRepository) UpdateNonce(address, nonce string) error {
	user, exists := m.users[address]
	if !exists {
		return errors.New("user not found")
	}
	user.Nonce = nonce
	user.UpdatedAt = time.Now()
	return nil
}

func (m *MockUserRepository) GetActiveUsers() ([]*models.User, error) {
	var activeUsers []*models.User
	for _, user := range m.users {
		if user.IsActive {
			activeUsers = append(activeUsers, user)
		}
	}
	return activeUsers, nil
}

// AddRole adds a role to a user
func (m *MockUserRepository) AddRole(address, role string) error {
	if address == "" || role == "" {
		return errors.New("address and role cannot be empty")
	}

	user, exists := m.users[address]
	if !exists {
		return errors.New("user not found")
	}

	// Check if role already exists
	for _, existingRole := range user.Roles {
		if existingRole == role {
			return nil // Role already exists, no error
		}
	}

	// Add role
	user.Roles = append(user.Roles, role)
	return nil
}

// RemoveRole removes a role from a user
func (m *MockUserRepository) RemoveRole(address, role string) error {
	if address == "" || role == "" {
		return errors.New("address and role cannot be empty")
	}

	user, exists := m.users[address]
	if !exists {
		return errors.New("user not found")
	}

	// Remove role from slice
	var newRoles []string
	for _, existingRole := range user.Roles {
		if existingRole != role {
			newRoles = append(newRoles, existingRole)
		}
	}
	user.Roles = newRoles
	return nil
}

// MockRepositoryTestSuite tests repository operations using mock implementations
type MockRepositoryTestSuite struct {
	suite.Suite
	userRepo *MockUserRepository
}

func (suite *MockRepositoryTestSuite) SetupTest() {
	suite.userRepo = NewMockUserRepository()
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryCreate() {
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}

	err := suite.userRepo.Create(user)
	suite.NoError(err)
	suite.Equal(uint(1), user.ID)
	suite.False(user.CreatedAt.IsZero())
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryCreateDuplicate() {
	user1 := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce-1",
		Roles:    []string{"user"},
		IsActive: true,
	}

	user2 := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce-2",
		Roles:    []string{"admin"},
		IsActive: true,
	}

	err1 := suite.userRepo.Create(user1)
	suite.NoError(err1)

	err2 := suite.userRepo.Create(user2)
	suite.Error(err2)
	suite.Contains(err2.Error(), "already exists")
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryGetByAddress() {
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}

	err := suite.userRepo.Create(user)
	suite.NoError(err)

	foundUser, err := suite.userRepo.GetByAddress("0x1234567890123456789012345678901234567890")
	suite.NoError(err)
	suite.NotNil(foundUser)
	suite.Equal(user.Address, foundUser.Address)
	suite.Equal(user.Nonce, foundUser.Nonce)
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryGetByAddressNotFound() {
	foundUser, err := suite.userRepo.GetByAddress("0x9999999999999999999999999999999999999999")
	suite.NoError(err)
	suite.Nil(foundUser)
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryUpdate() {
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}

	err := suite.userRepo.Create(user)
	suite.NoError(err)

	user.Nonce = "updated-nonce"
	user.Roles = []string{"user", "admin"}

	err = suite.userRepo.Update(user)
	suite.NoError(err)

	updatedUser, err := suite.userRepo.GetByAddress(user.Address)
	suite.NoError(err)
	suite.Equal("updated-nonce", updatedUser.Nonce)
	suite.Contains(updatedUser.Roles, "admin")
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryDelete() {
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}

	err := suite.userRepo.Create(user)
	suite.NoError(err)

	err = suite.userRepo.Delete(user.ID)
	suite.NoError(err)

	foundUser, err := suite.userRepo.GetByAddress(user.Address)
	suite.NoError(err)
	suite.Nil(foundUser)
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryList() {
	// Create multiple users
	for i := 0; i < 5; i++ {
		user := &models.User{
			Address:  fmt.Sprintf("0x%040d", i),
			Nonce:    fmt.Sprintf("nonce-%d", i),
			Roles:    []string{"user"},
			IsActive: true,
		}
		err := suite.userRepo.Create(user)
		suite.NoError(err)
	}

	// Test listing with limit and offset
	users, err := suite.userRepo.List(3, 0)
	suite.NoError(err)
	suite.Len(users, 3)

	// Test listing with offset
	users, err = suite.userRepo.List(3, 2)
	suite.NoError(err)
	suite.Len(users, 3)
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryUpdateNonce() {
	user := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "old-nonce",
		Roles:    []string{"user"},
		IsActive: true,
	}

	err := suite.userRepo.Create(user)
	suite.NoError(err)

	err = suite.userRepo.UpdateNonce(user.Address, "new-nonce")
	suite.NoError(err)

	updatedUser, err := suite.userRepo.GetByAddress(user.Address)
	suite.NoError(err)
	suite.Equal("new-nonce", updatedUser.Nonce)
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryGetActiveUsers() {
	// Create users with different active states
	for i := 0; i < 5; i++ {
		user := &models.User{
			Address:  fmt.Sprintf("0x%040d", i),
			Nonce:    fmt.Sprintf("nonce-%d", i),
			Roles:    []string{"user"},
			IsActive: i%2 == 0, // Only even indices are active
		}
		err := suite.userRepo.Create(user)
		suite.NoError(err)
	}

	activeUsers, err := suite.userRepo.GetActiveUsers()
	suite.NoError(err)
	suite.Len(activeUsers, 3) // 0, 2, 4 are active

	for _, user := range activeUsers {
		suite.True(user.IsActive)
	}
}

// TestMockRepositoryOperations runs the mock repository test suite
func TestMockRepositoryOperations(t *testing.T) {
	suite.Run(t, new(MockRepositoryTestSuite))
}

// TestRepositoryInterfaceCompliance tests that mock repositories implement the interfaces
func TestRepositoryInterfaceCompliance(t *testing.T) {
	t.Run("MockUserRepositoryInterface", func(t *testing.T) {
		// Test that MockUserRepository implements repository.UserRepository interface
		var _ repository.UserRepository = (*MockUserRepository)(nil)
		assert.True(t, true, "MockUserRepository implements UserRepository interface")
	})
}
