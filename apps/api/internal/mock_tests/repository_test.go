package mock_tests

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/irfndi/AetherDEX/apps/api/internal/user"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
)

func boolPtr(b bool) *bool {
	return &b
}

// MockUserRepository implements user.UserRepository interface for testing
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

func (m *MockUserRepository) Create(u *models.User) error {
	if u == nil {
		return errors.New("user cannot be nil")
	}
	if u.Address == "" {
		return errors.New("user address cannot be empty")
	}
	if _, exists := m.users[u.Address]; exists {
		return errors.New("user already exists")
	}
	u.ID = m.nextID
	m.nextID++
	u.CreatedAt = time.Now()
	u.UpdatedAt = time.Now()
	m.users[u.Address] = u
	return nil
}

func (m *MockUserRepository) GetByAddress(address string) (*models.User, error) {
	if address == "" {
		return nil, errors.New("address cannot be empty")
	}
	u, exists := m.users[address]
	if !exists {
		return nil, nil
	}
	return u, nil
}

func (m *MockUserRepository) GetByID(id uint) (*models.User, error) {
	for _, u := range m.users {
		if u.ID == id {
			return u, nil
		}
	}
	return nil, nil
}

func (m *MockUserRepository) Update(u *models.User) error {
	if u == nil {
		return errors.New("user cannot be nil")
	}
	existingUser, exists := m.users[u.Address]
	if !exists {
		return errors.New("user not found")
	}
	existingUser.Nonce = u.Nonce
	existingUser.Roles = u.Roles
	existingUser.IsActive = u.IsActive
	existingUser.UpdatedAt = time.Now()
	return nil
}

func (m *MockUserRepository) Delete(id uint) error {
	for address, u := range m.users {
		if u.ID == id {
			delete(m.users, address)
			return nil
		}
	}
	return errors.New("user not found")
}

func (m *MockUserRepository) List(limit, offset int) ([]*models.User, error) {
	users := make([]*models.User, 0, len(m.users))
	for _, u := range m.users {
		users = append(users, u)
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
	u, exists := m.users[address]
	if !exists {
		return errors.New("user not found")
	}
	u.Nonce = nonce
	u.UpdatedAt = time.Now()
	return nil
}

func (m *MockUserRepository) GetActiveUsers() ([]*models.User, error) {
	var activeUsers []*models.User
	for _, u := range m.users {
		if u.IsActive != nil && *u.IsActive {
			activeUsers = append(activeUsers, u)
		}
	}
	return activeUsers, nil
}

// AddRole adds a role to a user
func (m *MockUserRepository) AddRole(address, role string) error {
	if address == "" || role == "" {
		return errors.New("address and role cannot be empty")
	}

	u, exists := m.users[address]
	if !exists {
		return errors.New("user not found")
	}

	// Check if role already exists
	for _, existingRole := range u.Roles {
		if existingRole == role {
			return nil // Role already exists, no error
		}
	}

	// Add role
	u.Roles = append(u.Roles, role)
	return nil
}

// RemoveRole removes a role from a user
func (m *MockUserRepository) RemoveRole(address, role string) error {
	if address == "" || role == "" {
		return errors.New("address and role cannot be empty")
	}

	u, exists := m.users[address]
	if !exists {
		return errors.New("user not found")
	}

	// Remove role from slice
	var newRoles []string
	for _, existingRole := range u.Roles {
		if existingRole != role {
			newRoles = append(newRoles, existingRole)
		}
	}
	u.Roles = newRoles
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
	u := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: boolPtr(true),
	}

	err := suite.userRepo.Create(u)
	suite.NoError(err)
	suite.Equal(uint(1), u.ID)
	suite.False(u.CreatedAt.IsZero())
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryCreateDuplicate() {
	user1 := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce-1",
		Roles:    []string{"user"},
		IsActive: boolPtr(true),
	}

	user2 := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce-2",
		Roles:    []string{"admin"},
		IsActive: boolPtr(true),
	}

	err1 := suite.userRepo.Create(user1)
	suite.NoError(err1)

	err2 := suite.userRepo.Create(user2)
	suite.Error(err2)
	suite.Contains(err2.Error(), "already exists")
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryGetByAddress() {
	u := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: boolPtr(true),
	}

	err := suite.userRepo.Create(u)
	suite.NoError(err)

	foundUser, err := suite.userRepo.GetByAddress("0x1234567890123456789012345678901234567890")
	suite.NoError(err)
	suite.NotNil(foundUser)
	suite.Equal(u.Address, foundUser.Address)
	suite.Equal(u.Nonce, foundUser.Nonce)
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryGetByAddressNotFound() {
	foundUser, err := suite.userRepo.GetByAddress("0x9999999999999999999999999999999999999999")
	suite.NoError(err)
	suite.Nil(foundUser)
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryUpdate() {
	u := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: boolPtr(true),
	}

	err := suite.userRepo.Create(u)
	suite.NoError(err)

	u.Nonce = "updated-nonce"
	u.Roles = []string{"user", "admin"}

	err = suite.userRepo.Update(u)
	suite.NoError(err)

	updatedUser, err := suite.userRepo.GetByAddress(u.Address)
	suite.NoError(err)
	suite.Equal("updated-nonce", updatedUser.Nonce)
	suite.Contains(updatedUser.Roles, "admin")
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryDelete() {
	u := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "test-nonce",
		Roles:    []string{"user"},
		IsActive: boolPtr(true),
	}

	err := suite.userRepo.Create(u)
	suite.NoError(err)

	err = suite.userRepo.Delete(u.ID)
	suite.NoError(err)

	foundUser, err := suite.userRepo.GetByAddress(u.Address)
	suite.NoError(err)
	suite.Nil(foundUser)
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryList() {
	// Create multiple users
	for i := 0; i < 5; i++ {
		u := &models.User{
			Address:  fmt.Sprintf("0x%040d", i),
			Nonce:    fmt.Sprintf("nonce-%d", i),
			Roles:    []string{"user"},
			IsActive: boolPtr(true),
		}
		err := suite.userRepo.Create(u)
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
	u := &models.User{
		Address:  "0x1234567890123456789012345678901234567890",
		Nonce:    "old-nonce",
		Roles:    []string{"user"},
		IsActive: boolPtr(true),
	}

	err := suite.userRepo.Create(u)
	suite.NoError(err)

	err = suite.userRepo.UpdateNonce(u.Address, "new-nonce")
	suite.NoError(err)

	updatedUser, err := suite.userRepo.GetByAddress(u.Address)
	suite.NoError(err)
	suite.Equal("new-nonce", updatedUser.Nonce)
}

func (suite *MockRepositoryTestSuite) TestUserRepositoryGetActiveUsers() {
	// Create users with different active states
	for i := 0; i < 5; i++ {
		u := &models.User{
			Address:  fmt.Sprintf("0x%040d", i),
			Nonce:    fmt.Sprintf("nonce-%d", i),
			Roles:    []string{"user"},
			IsActive: boolPtr(i%2 == 0), // Only even indices are active
		}
		err := suite.userRepo.Create(u)
		suite.NoError(err)
	}

	activeUsers, err := suite.userRepo.GetActiveUsers()
	suite.NoError(err)
	suite.Len(activeUsers, 3) // 0, 2, 4 are active

	for _, u := range activeUsers {
		suite.True(*u.IsActive)
	}
}

// TestMockRepositoryOperations runs the mock repository test suite
func TestMockRepositoryOperations(t *testing.T) {
	suite.Run(t, new(MockRepositoryTestSuite))
}

// TestRepositoryInterfaceCompliance tests that mock repositories implement the interfaces
func TestRepositoryInterfaceCompliance(t *testing.T) {
	t.Run("MockUserRepositoryInterface", func(t *testing.T) {
		// Test that MockUserRepository implements user.UserRepository interface
		var _ user.UserRepository = (*MockUserRepository)(nil)
		assert.True(t, true, "MockUserRepository implements UserRepository interface")
	})
}
