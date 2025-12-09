package token

import (
	"fmt"
	"testing"

	"github.com/irfndi/AetherDEX/apps/api/internal/models"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/suite"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
)

// TokenRepositoryTestSuite provides comprehensive tests for token repository
type TokenRepositoryTestSuite struct {
	suite.Suite
	db   *gorm.DB
	repo TokenRepository
}

// SetupSuite initializes the test suite
func (suite *TokenRepositoryTestSuite) SetupSuite() {
	// Use in-memory SQLite for testing with pure Go driver
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared&_pragma=foreign_keys(1)"), &gorm.Config{})
	suite.Require().NoError(err)

	// Auto-migrate the schema
	err = db.AutoMigrate(&models.Token{})
	suite.Require().NoError(err)

	suite.db = db
	suite.repo = NewTokenRepository(db)
}

// SetupTest runs before each test
func (suite *TokenRepositoryTestSuite) SetupTest() {
	// Clean up database before each test
	suite.db.Exec("DELETE FROM tokens")
}

// TearDownSuite cleans up after all tests
func (suite *TokenRepositoryTestSuite) TearDownSuite() {
	if sqlDB, err := suite.db.DB(); err == nil {
		sqlDB.Close()
	}
}

// TestCreateToken tests token creation
func (suite *TokenRepositoryTestSuite) TestCreateToken() {
	token := &models.Token{
		Address:     "0x1111111111111111111111111111111111111111",
		Symbol:      "TEST",
		Name:        "Test Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		Price:       decimal.NewFromFloat(1.5),
		MarketCap:   decimal.NewFromInt(1500000),
		Volume24h:   decimal.NewFromInt(50000),
		IsVerified:  true,
		IsActive:    true,
		LogoURL:     "https://example.com/logo.png",
		WebsiteURL:  "https://example.com",
	}

	err := suite.repo.Create(token)
	suite.NoError(err)
	suite.NotZero(token.ID)
	suite.NotZero(token.CreatedAt)
}

// TestCreateTokenNil tests creating nil token
func (suite *TokenRepositoryTestSuite) TestCreateTokenNil() {
	err := suite.repo.Create(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "token cannot be nil")
}

// TestGetTokenByID tests retrieving token by ID
func (suite *TokenRepositoryTestSuite) TestGetTokenByID() {
	// Create test token
	originalToken := &models.Token{
		Address:     "0x1111111111111111111111111111111111111111",
		Symbol:      "TEST",
		Name:        "Test Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		Price:       decimal.NewFromFloat(1.5),
		MarketCap:   decimal.NewFromInt(1500000),
		Volume24h:   decimal.NewFromInt(50000),
		IsVerified:  true,
		IsActive:    true,
	}
	err := suite.repo.Create(originalToken)
	suite.NoError(err)

	// Retrieve token
	token, err := suite.repo.GetByID(originalToken.ID)
	suite.NoError(err)
	suite.NotNil(token)
	suite.Equal(originalToken.Address, token.Address)
	suite.Equal(originalToken.Symbol, token.Symbol)
	suite.Equal(originalToken.Name, token.Name)
	suite.Equal(originalToken.Decimals, token.Decimals)
}

// TestGetTokenByIDNotFound tests retrieving non-existent token
func (suite *TokenRepositoryTestSuite) TestGetTokenByIDNotFound() {
	token, err := suite.repo.GetByID(999)
	suite.NoError(err)
	suite.Nil(token)
}

// TestGetTokenByIDZero tests retrieving token with zero ID
func (suite *TokenRepositoryTestSuite) TestGetTokenByIDZero() {
	token, err := suite.repo.GetByID(0)
	suite.Error(err)
	suite.Nil(token)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestGetTokenByAddress tests retrieving token by address
func (suite *TokenRepositoryTestSuite) TestGetTokenByAddress() {
	// Create test token
	originalToken := &models.Token{
		Address:     "0x1111111111111111111111111111111111111111",
		Symbol:      "TEST",
		Name:        "Test Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		IsActive:    true,
	}
	err := suite.repo.Create(originalToken)
	suite.NoError(err)

	// Retrieve token by address
	token, err := suite.repo.GetByAddress("0x1111111111111111111111111111111111111111")
	suite.NoError(err)
	suite.NotNil(token)
	suite.Equal(originalToken.Address, token.Address)
	suite.Equal(originalToken.Symbol, token.Symbol)
}

// TestGetTokenByAddressNotFound tests retrieving non-existent token by address
func (suite *TokenRepositoryTestSuite) TestGetTokenByAddressNotFound() {
	token, err := suite.repo.GetByAddress("0x0000000000000000000000000000000000000000")
	suite.NoError(err)
	suite.Nil(token)
}

// TestGetTokenByAddressEmpty tests retrieving token with empty address
func (suite *TokenRepositoryTestSuite) TestGetTokenByAddressEmpty() {
	token, err := suite.repo.GetByAddress("")
	suite.Error(err)
	suite.Nil(token)
	suite.Contains(err.Error(), "address cannot be empty")
}

// TestGetTokenBySymbol tests retrieving token by symbol
func (suite *TokenRepositoryTestSuite) TestGetTokenBySymbol() {
	// Create test token
	originalToken := &models.Token{
		Address:     "0x1111111111111111111111111111111111111111",
		Symbol:      "TEST",
		Name:        "Test Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		IsActive:    true,
	}
	err := suite.repo.Create(originalToken)
	suite.NoError(err)

	// Retrieve token by symbol
	token, err := suite.repo.GetBySymbol("TEST")
	suite.NoError(err)
	suite.NotNil(token)
	suite.Equal(originalToken.Symbol, token.Symbol)
	suite.Equal(originalToken.Address, token.Address)
}

// TestGetTokenBySymbolNotFound tests retrieving non-existent token by symbol
func (suite *TokenRepositoryTestSuite) TestGetTokenBySymbolNotFound() {
	token, err := suite.repo.GetBySymbol("NONEXISTENT")
	suite.NoError(err)
	suite.Nil(token)
}

// TestGetTokenBySymbolEmpty tests retrieving token with empty symbol
func (suite *TokenRepositoryTestSuite) TestGetTokenBySymbolEmpty() {
	token, err := suite.repo.GetBySymbol("")
	suite.Error(err)
	suite.Nil(token)
	suite.Contains(err.Error(), "symbol cannot be empty")
}

// TestUpdateToken tests updating token
func (suite *TokenRepositoryTestSuite) TestUpdateToken() {
	// Create test token
	token := &models.Token{
		Address:     "0x1111111111111111111111111111111111111111",
		Symbol:      "TEST",
		Name:        "Test Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		Price:       decimal.NewFromFloat(1.5),
		IsActive:    true,
	}
	err := suite.repo.Create(token)
	suite.NoError(err)

	// Update token
	token.Name = "Updated Test Token"
	token.Price = decimal.NewFromFloat(2.0)
	token.IsVerified = true
	err = suite.repo.Update(token)
	suite.NoError(err)

	// Verify update
	updatedToken, err := suite.repo.GetByID(token.ID)
	suite.NoError(err)
	suite.Equal("Updated Test Token", updatedToken.Name)
	suite.True(decimal.NewFromFloat(2.0).Equal(updatedToken.Price))
	suite.True(updatedToken.IsVerified)
}

// TestUpdateTokenNil tests updating nil token
func (suite *TokenRepositoryTestSuite) TestUpdateTokenNil() {
	err := suite.repo.Update(nil)
	suite.Error(err)
	suite.Contains(err.Error(), "token cannot be nil")
}

// TestDeleteToken tests deleting token
func (suite *TokenRepositoryTestSuite) TestDeleteToken() {
	// Create test token
	token := &models.Token{
		Address:     "0x1111111111111111111111111111111111111111",
		Symbol:      "TEST",
		Name:        "Test Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		IsActive:    true,
	}
	err := suite.repo.Create(token)
	suite.NoError(err)

	// Delete token
	err = suite.repo.Delete(token.ID)
	suite.NoError(err)

	// Verify deletion (soft delete)
	deletedToken, err := suite.repo.GetByID(token.ID)
	suite.NoError(err)
	suite.Nil(deletedToken) // Should be nil due to soft delete
}

// TestDeleteTokenZeroID tests deleting token with zero ID
func (suite *TokenRepositoryTestSuite) TestDeleteTokenZeroID() {
	err := suite.repo.Delete(0)
	suite.Error(err)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestListTokens tests listing tokens with pagination
func (suite *TokenRepositoryTestSuite) TestListTokens() {
	// Create multiple test tokens
	for i := 0; i < 5; i++ {
		token := &models.Token{
			Address:     fmt.Sprintf("0x%040d", i),
			Symbol:      fmt.Sprintf("TEST%d", i),
			Name:        fmt.Sprintf("Test Token %d", i),
			Decimals:    18,
			TotalSupply: decimal.NewFromInt(1000000 + int64(i*100000)),
			IsActive:    true,
		}
		err := suite.repo.Create(token)
		suite.NoError(err)
	}

	// Test pagination
	tokens, err := suite.repo.List(3, 0)
	suite.NoError(err)
	suite.Len(tokens, 3)

	// Test offset
	tokens, err = suite.repo.List(3, 2)
	suite.NoError(err)
	suite.Len(tokens, 3)
}

// TestGetVerifiedTokens tests retrieving verified tokens
func (suite *TokenRepositoryTestSuite) TestGetVerifiedTokens() {
	// Create verified and unverified tokens
	for i := 0; i < 5; i++ {
		token := &models.Token{
			Address:     fmt.Sprintf("0x%040d", i),
			Symbol:      fmt.Sprintf("TEST%d", i),
			Name:        fmt.Sprintf("Test Token %d", i),
			Decimals:    18,
			TotalSupply: decimal.NewFromInt(1000000),
			IsVerified:  i < 3, // First 3 are verified
			IsActive:    true,
		}
		err := suite.repo.Create(token)
		suite.NoError(err)
	}

	// Get verified tokens
	verifiedTokens, err := suite.repo.GetVerifiedTokens(10, 0)
	suite.NoError(err)
	suite.Len(verifiedTokens, 3)

	// Verify all tokens are verified and active
	for _, token := range verifiedTokens {
		suite.True(token.IsVerified)
		suite.True(token.IsActive)
	}
}

// TestGetActiveTokens tests retrieving active tokens
func (suite *TokenRepositoryTestSuite) TestGetActiveTokens() {
	// Create active and inactive tokens
	for i := 0; i < 5; i++ {
		token := &models.Token{
			Address:     fmt.Sprintf("0x%040d", i),
			Symbol:      fmt.Sprintf("TEST%d", i),
			Name:        fmt.Sprintf("Test Token %d", i),
			Decimals:    18,
			TotalSupply: decimal.NewFromInt(1000000),
			IsActive:    i < 4, // First 4 are active
		}
		err := suite.repo.Create(token)
		suite.NoError(err)
	}

	// Get active tokens
	activeTokens, err := suite.repo.GetActiveTokens(10, 0)
	suite.NoError(err)
	suite.Len(activeTokens, 4)

	// Verify all tokens are active
	for _, token := range activeTokens {
		suite.True(token.IsActive)
	}
}

// TestGetTokensBySymbols tests retrieving tokens by multiple symbols
func (suite *TokenRepositoryTestSuite) TestGetTokensBySymbols() {
	// Create test tokens
	symbols := []string{"BTC", "ETH", "USDC", "DAI", "LINK"}
	for i, symbol := range symbols {
		token := &models.Token{
			Address:     fmt.Sprintf("0x%040d", i),
			Symbol:      symbol,
			Name:        fmt.Sprintf("%s Token", symbol),
			Decimals:    18,
			TotalSupply: decimal.NewFromInt(1000000),
			IsActive:    true,
		}
		err := suite.repo.Create(token)
		suite.NoError(err)
	}

	// Create inactive token
	inactiveToken := &models.Token{
		Address:     "0x9999999999999999999999999999999999999999",
		Symbol:      "INACTIVE",
		Name:        "Inactive Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		IsActive:    false,
	}
	err := suite.repo.Create(inactiveToken)
	suite.NoError(err)

	// Get tokens by symbols (including inactive one)
	requestSymbols := []string{"BTC", "ETH", "INACTIVE"}
	tokens, err := suite.repo.GetTokensBySymbols(requestSymbols)
	suite.NoError(err)
	suite.Len(tokens, 2) // Only active tokens should be returned

	// Verify returned tokens
	returnedSymbols := make([]string, len(tokens))
	for i, token := range tokens {
		returnedSymbols[i] = token.Symbol
		suite.True(token.IsActive)
	}
	suite.Contains(returnedSymbols, "BTC")
	suite.Contains(returnedSymbols, "ETH")
	suite.NotContains(returnedSymbols, "INACTIVE")
}

// TestGetTokensBySymbolsEmpty tests retrieving tokens with empty symbols list
func (suite *TokenRepositoryTestSuite) TestGetTokensBySymbolsEmpty() {
	tokens, err := suite.repo.GetTokensBySymbols([]string{})
	suite.NoError(err)
	suite.Empty(tokens)
}

// TestUpdatePrice tests updating token price
func (suite *TokenRepositoryTestSuite) TestUpdatePrice() {
	// Create test token
	token := &models.Token{
		Address:     "0x1111111111111111111111111111111111111111",
		Symbol:      "TEST",
		Name:        "Test Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		Price:       decimal.NewFromFloat(1.0),
		IsActive:    true,
	}
	err := suite.repo.Create(token)
	suite.NoError(err)

	// Update price
	newPrice := decimal.NewFromFloat(2.5)
	err = suite.repo.UpdatePrice(token.ID, newPrice)
	suite.NoError(err)

	// Verify update
	updatedToken, err := suite.repo.GetByID(token.ID)
	suite.NoError(err)
	suite.True(newPrice.Equal(updatedToken.Price))
}

// TestUpdatePriceZeroID tests updating price with zero ID
func (suite *TokenRepositoryTestSuite) TestUpdatePriceZeroID() {
	err := suite.repo.UpdatePrice(0, decimal.NewFromFloat(1.0))
	suite.Error(err)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestUpdateMarketData tests updating token market data
func (suite *TokenRepositoryTestSuite) TestUpdateMarketData() {
	// Create test token
	token := &models.Token{
		Address:     "0x1111111111111111111111111111111111111111",
		Symbol:      "TEST",
		Name:        "Test Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		MarketCap:   decimal.NewFromInt(1000000),
		Volume24h:   decimal.NewFromInt(50000),
		IsActive:    true,
	}
	err := suite.repo.Create(token)
	suite.NoError(err)

	// Update market data
	newMarketCap := decimal.NewFromInt(2000000)
	newVolume24h := decimal.NewFromInt(100000)
	err = suite.repo.UpdateMarketData(token.ID, newMarketCap, newVolume24h)
	suite.NoError(err)

	// Verify update
	updatedToken, err := suite.repo.GetByID(token.ID)
	suite.NoError(err)
	suite.True(newMarketCap.Equal(updatedToken.MarketCap))
	suite.True(newVolume24h.Equal(updatedToken.Volume24h))
}

// TestUpdateMarketDataZeroID tests updating market data with zero ID
func (suite *TokenRepositoryTestSuite) TestUpdateMarketDataZeroID() {
	err := suite.repo.UpdateMarketData(0, decimal.NewFromInt(1000000), decimal.NewFromInt(50000))
	suite.Error(err)
	suite.Contains(err.Error(), "id cannot be zero")
}

// TestSearchTokens tests searching tokens by name or symbol
func (suite *TokenRepositoryTestSuite) TestSearchTokens() {
	// Create test tokens
	tokens := []*models.Token{
		{
			Address:     "0x1111111111111111111111111111111111111111",
			Symbol:      "BTC",
			Name:        "Bitcoin",
			Decimals:    8,
			TotalSupply: decimal.NewFromInt(21000000),
			IsActive:    true,
		},
		{
			Address:     "0x2222222222222222222222222222222222222222",
			Symbol:      "ETH",
			Name:        "Ethereum",
			Decimals:    18,
			TotalSupply: decimal.NewFromInt(120000000),
			IsActive:    true,
		},
		{
			Address:     "0x3333333333333333333333333333333333333333",
			Symbol:      "USDC",
			Name:        "USD Coin",
			Decimals:    6,
			TotalSupply: decimal.NewFromInt(1000000000),
			IsActive:    true,
		},
		{
			Address:     "0x4444444444444444444444444444444444444444",
			Symbol:      "WBTC",
			Name:        "Wrapped Bitcoin",
			Decimals:    8,
			TotalSupply: decimal.NewFromInt(150000),
			IsActive:    true,
		},
	}

	for _, token := range tokens {
		err := suite.repo.Create(token)
		suite.NoError(err)
	}

	// Search by symbol
	results, err := suite.repo.SearchTokens("btc", 10, 0)
	suite.NoError(err)
	suite.Len(results, 2) // BTC and WBTC

	// Search by name
	results, err = suite.repo.SearchTokens("bitcoin", 10, 0)
	suite.NoError(err)
	suite.Len(results, 2) // Bitcoin and Wrapped Bitcoin

	// Search by partial name
	results, err = suite.repo.SearchTokens("coin", 10, 0)
	suite.NoError(err)
	suite.Len(results, 2) // USD Coin and Wrapped Bitcoin (contains "coin")

	// Search with no results
	results, err = suite.repo.SearchTokens("nonexistent", 10, 0)
	suite.NoError(err)
	suite.Empty(results)
}

// TestSearchTokensEmpty tests searching with empty query
func (suite *TokenRepositoryTestSuite) TestSearchTokensEmpty() {
	results, err := suite.repo.SearchTokens("", 10, 0)
	suite.NoError(err)
	suite.Empty(results)
}

// TestGetTopTokensByVolume tests retrieving top tokens by volume
func (suite *TokenRepositoryTestSuite) TestGetTopTokensByVolume() {
	// Create tokens with different volumes
	volumes := []int64{100000, 500000, 200000, 800000, 50000}
	for i, volume := range volumes {
		token := &models.Token{
			Address:     fmt.Sprintf("0x%040d", i),
			Symbol:      fmt.Sprintf("TEST%d", i),
			Name:        fmt.Sprintf("Test Token %d", i),
			Decimals:    18,
			TotalSupply: decimal.NewFromInt(1000000),
			Volume24h:   decimal.NewFromInt(volume),
			IsActive:    true,
		}
		err := suite.repo.Create(token)
		suite.NoError(err)
	}

	// Create inactive token with high volume (should not be included)
	inactiveToken := &models.Token{
		Address:     "0x9999999999999999999999999999999999999999",
		Symbol:      "INACTIVE",
		Name:        "Inactive Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		Volume24h:   decimal.NewFromInt(1000000), // Highest volume
		IsActive:    false,
	}
	err := suite.repo.Create(inactiveToken)
	suite.NoError(err)

	// Get top tokens by volume
	topTokens, err := suite.repo.GetTopTokensByVolume(3)
	suite.NoError(err)
	suite.Len(topTokens, 3)

	// Verify order (highest volume first) and all are active
	suite.True(topTokens[0].Volume24h.GreaterThanOrEqual(topTokens[1].Volume24h))
	suite.True(topTokens[1].Volume24h.GreaterThanOrEqual(topTokens[2].Volume24h))
	for _, token := range topTokens {
		suite.True(token.IsActive)
	}

	// Verify highest volume token is TEST3 (800000)
	suite.Equal("TEST3", topTokens[0].Symbol)
}

// TestGetTopTokensByMarketCap tests retrieving top tokens by market cap
func (suite *TokenRepositoryTestSuite) TestGetTopTokensByMarketCap() {
	// Create tokens with different market caps
	marketCaps := []int64{1000000, 5000000, 2000000, 8000000, 500000}
	for i, marketCap := range marketCaps {
		token := &models.Token{
			Address:     fmt.Sprintf("0x%040d", i),
			Symbol:      fmt.Sprintf("TEST%d", i),
			Name:        fmt.Sprintf("Test Token %d", i),
			Decimals:    18,
			TotalSupply: decimal.NewFromInt(1000000),
			MarketCap:   decimal.NewFromInt(marketCap),
			IsActive:    true,
		}
		err := suite.repo.Create(token)
		suite.NoError(err)
	}

	// Create inactive token with high market cap (should not be included)
	inactiveToken := &models.Token{
		Address:     "0x9999999999999999999999999999999999999999",
		Symbol:      "INACTIVE",
		Name:        "Inactive Token",
		Decimals:    18,
		TotalSupply: decimal.NewFromInt(1000000),
		MarketCap:   decimal.NewFromInt(10000000), // Highest market cap
		IsActive:    false,
	}
	err := suite.repo.Create(inactiveToken)
	suite.NoError(err)

	// Get top tokens by market cap
	topTokens, err := suite.repo.GetTopTokensByMarketCap(3)
	suite.NoError(err)
	suite.Len(topTokens, 3)

	// Verify order (highest market cap first) and all are active
	suite.True(topTokens[0].MarketCap.GreaterThanOrEqual(topTokens[1].MarketCap))
	suite.True(topTokens[1].MarketCap.GreaterThanOrEqual(topTokens[2].MarketCap))
	for _, token := range topTokens {
		suite.True(token.IsActive)
	}

	// Verify highest market cap token is TEST3 (8000000)
	suite.Equal("TEST3", topTokens[0].Symbol)
}

// TestTokenRepositoryTestSuite runs the test suite
func TestTokenRepositoryTestSuite(t *testing.T) {
	suite.Run(t, new(TokenRepositoryTestSuite))
}
