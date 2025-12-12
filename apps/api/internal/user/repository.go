package user

import (
	"errors"

	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

// UserRepository interface defines user database operations
type UserRepository interface {
	Create(user *models.User) error
	GetByAddress(address string) (*models.User, error)
	GetByID(id uint) (*models.User, error)
	Update(user *models.User) error
	Delete(id uint) error
	List(limit, offset int) ([]*models.User, error)
	UpdateNonce(address, nonce string) error
	GetActiveUsers() ([]*models.User, error)
	AddRole(address, role string) error
	RemoveRole(address, role string) error
}

// userRepository implements UserRepository interface
type userRepository struct {
	db *gorm.DB
}

// NewUserRepository creates a new user repository
func NewUserRepository(db *gorm.DB) UserRepository {
	return &userRepository{db: db}
}

// Create creates a new user
func (r *userRepository) Create(user *models.User) error {
	if user == nil {
		return errors.New("user cannot be nil")
	}
	return r.db.Create(user).Error
}

// GetByAddress retrieves a user by their Ethereum address
func (r *userRepository) GetByAddress(address string) (*models.User, error) {
	if address == "" {
		return nil, errors.New("address cannot be empty")
	}

	var user models.User
	err := r.db.Where("address = ?", address).First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &user, nil
}

// GetByID retrieves a user by their ID
func (r *userRepository) GetByID(id uint) (*models.User, error) {
	if id == 0 {
		return nil, errors.New("id cannot be zero")
	}

	var user models.User
	err := r.db.First(&user, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &user, nil
}

// Update updates an existing user
func (r *userRepository) Update(user *models.User) error {
	if user == nil {
		return errors.New("user cannot be nil")
	}
	return r.db.Save(user).Error
}

// Delete soft deletes a user by ID
func (r *userRepository) Delete(id uint) error {
	if id == 0 {
		return errors.New("id cannot be zero")
	}
	return r.db.Delete(&models.User{}, id).Error
}

// List retrieves users with pagination
func (r *userRepository) List(limit, offset int) ([]*models.User, error) {
	var users []*models.User
	err := r.db.Limit(limit).Offset(offset).Find(&users).Error
	return users, err
}

// UpdateNonce updates a user's nonce
func (r *userRepository) UpdateNonce(address, nonce string) error {
	if address == "" || nonce == "" {
		return errors.New("address and nonce cannot be empty")
	}
	return r.db.Model(&models.User{}).Where("address = ?", address).Update("nonce", nonce).Error
}

// GetActiveUsers retrieves all active users
func (r *userRepository) GetActiveUsers() ([]*models.User, error) {
	var users []*models.User
	err := r.db.Where("is_active = ?", true).Find(&users).Error
	return users, err
}

// AddRole adds a role to a user
func (r *userRepository) AddRole(address, role string) error {
	if address == "" || role == "" {
		return errors.New("address and role cannot be empty")
	}

	var user models.User
	err := r.db.Where("address = ?", address).First(&user).Error
	if err != nil {
		return err
	}

	// Check if role already exists
	for _, existingRole := range user.Roles {
		if existingRole == role {
			return nil // Role already exists
		}
	}

	user.Roles = append(user.Roles, role)
	return r.db.Save(&user).Error
}

// RemoveRole removes a role from a user
func (r *userRepository) RemoveRole(address, role string) error {
	if address == "" || role == "" {
		return errors.New("address and role cannot be empty")
	}

	var user models.User
	err := r.db.Where("address = ?", address).First(&user).Error
	if err != nil {
		return err
	}

	// Remove role from slice
	var newRoles pq.StringArray
	for _, existingRole := range user.Roles {
		if existingRole != role {
			newRoles = append(newRoles, existingRole)
		}
	}

	user.Roles = newRoles
	return r.db.Save(&user).Error
}
