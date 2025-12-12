package swap

import (
	"errors"

	"github.com/irfndi/AetherDEX/apps/api/internal/pool"
	"github.com/irfndi/AetherDEX/apps/api/internal/token"
	"github.com/shopspring/decimal"
)

// Fee denominator matches the smart contract (1,000,000 = 100% = 1e6)
const FeeDenominator = 1_000_000

// SwapQuoteRequest represents a request for a swap quote
type SwapQuoteRequest struct {
	TokenIn  string          `json:"token_in" binding:"required"`
	TokenOut string          `json:"token_out" binding:"required"`
	AmountIn decimal.Decimal `json:"amount_in" binding:"required"`
	Slippage decimal.Decimal `json:"slippage"` // Optional, default 0.5%
}

// SwapQuoteResponse represents the response for a swap quote
type SwapQuoteResponse struct {
	AmountOut    decimal.Decimal `json:"amount_out"`
	MinAmountOut decimal.Decimal `json:"min_amount_out"`
	PriceImpact  decimal.Decimal `json:"price_impact"`
	Fee          decimal.Decimal `json:"fee"`
	FeeRate      decimal.Decimal `json:"fee_rate"`
	Route        []RouteHop      `json:"route"`
	TokenIn      TokenInfo       `json:"token_in"`
	TokenOut     TokenInfo       `json:"token_out"`
}

// RouteHop represents a hop in the swap route
type RouteHop struct {
	PoolID   string `json:"pool_id"`
	TokenIn  string `json:"token_in"`
	TokenOut string `json:"token_out"`
}

// TokenInfo represents token information in the quote
type TokenInfo struct {
	Address  string `json:"address"`
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Decimals uint8  `json:"decimals"`
}

// Service defines swap service operations
type Service interface {
	GetQuote(req *SwapQuoteRequest) (*SwapQuoteResponse, error)
}

type service struct {
	poolService  pool.Service
	tokenService token.Service
}

// NewService creates a new swap service
func NewService(poolService pool.Service, tokenService token.Service) Service {
	return &service{
		poolService:  poolService,
		tokenService: tokenService,
	}
}

// GetQuote calculates a swap quote for the given parameters
// This mirrors the getAmountsOut logic from AetherRouter.sol
func (s *service) GetQuote(req *SwapQuoteRequest) (*SwapQuoteResponse, error) {
	if req.TokenIn == "" || req.TokenOut == "" {
		return nil, errors.New("token addresses required")
	}
	if req.TokenIn == req.TokenOut {
		return nil, errors.New("cannot swap same token")
	}
	if req.AmountIn.IsZero() || req.AmountIn.IsNegative() {
		return nil, errors.New("amount must be positive")
	}

	// Set default slippage (0.5%)
	slippage := req.Slippage
	if slippage.IsZero() {
		slippage = decimal.NewFromFloat(0.005)
	}

	// Find the pool for this token pair
	poolData, err := s.poolService.GetPoolByTokens(req.TokenIn, req.TokenOut)
	if err != nil {
		return nil, errors.New("pool not found for token pair")
	}
	if poolData == nil {
		return nil, errors.New("pool not found for token pair")
	}

	// Get token info
	tokenInData, err := s.tokenService.GetTokenByAddress(req.TokenIn)
	if err != nil || tokenInData == nil {
		return nil, errors.New("input token not found")
	}
	tokenOutData, err := s.tokenService.GetTokenByAddress(req.TokenOut)
	if err != nil || tokenOutData == nil {
		return nil, errors.New("output token not found")
	}

	// Determine reserves based on token order
	var reserveIn, reserveOut decimal.Decimal
	if poolData.Token0 == req.TokenIn {
		reserveIn = poolData.Reserve0
		reserveOut = poolData.Reserve1
	} else {
		reserveIn = poolData.Reserve1
		reserveOut = poolData.Reserve0
	}

	if reserveIn.IsZero() || reserveOut.IsZero() {
		return nil, errors.New("insufficient liquidity")
	}

	// Calculate amount out using the same formula as AetherRouter.sol
	// amountInWithFee = amountIn * (feeDenominator - feeRate)
	// amountOut = (amountInWithFee * reserveOut) / (reserveIn * feeDenominator + amountInWithFee)
	feeRateBps := poolData.FeeRate.Mul(decimal.NewFromInt(FeeDenominator)).IntPart() // Convert to bps
	feeDenom := decimal.NewFromInt(FeeDenominator)
	feeRate := decimal.NewFromInt(feeRateBps)

	amountInWithFee := req.AmountIn.Mul(feeDenom.Sub(feeRate))
	numerator := amountInWithFee.Mul(reserveOut)
	denominator := reserveIn.Mul(feeDenom).Add(amountInWithFee)

	if denominator.IsZero() {
		return nil, errors.New("calculation error: zero denominator")
	}

	amountOut := numerator.Div(denominator)

	// Calculate fee amount
	feeAmount := req.AmountIn.Mul(poolData.FeeRate)

	// Calculate price impact
	// Price impact = (initial price - final price) / initial price
	// Initial price = reserveOut / reserveIn
	// Final price = (reserveOut - amountOut) / (reserveIn + amountIn)
	initialPrice := reserveOut.Div(reserveIn)
	newReserveIn := reserveIn.Add(req.AmountIn)
	newReserveOut := reserveOut.Sub(amountOut)
	finalPrice := newReserveOut.Div(newReserveIn)
	priceImpact := initialPrice.Sub(finalPrice).Div(initialPrice).Abs()

	// Calculate minimum amount out with slippage
	minAmountOut := amountOut.Mul(decimal.NewFromInt(1).Sub(slippage))

	return &SwapQuoteResponse{
		AmountOut:    amountOut.Round(18),
		MinAmountOut: minAmountOut.Round(18),
		PriceImpact:  priceImpact.Mul(decimal.NewFromInt(100)).Round(4), // as percentage
		Fee:          feeAmount.Round(18),
		FeeRate:      poolData.FeeRate,
		Route: []RouteHop{
			{
				PoolID:   poolData.PoolID,
				TokenIn:  req.TokenIn,
				TokenOut: req.TokenOut,
			},
		},
		TokenIn: TokenInfo{
			Address:  tokenInData.Address,
			Symbol:   tokenInData.Symbol,
			Name:     tokenInData.Name,
			Decimals: tokenInData.Decimals,
		},
		TokenOut: TokenInfo{
			Address:  tokenOutData.Address,
			Symbol:   tokenOutData.Symbol,
			Name:     tokenOutData.Name,
			Decimals: tokenOutData.Decimals,
		},
	}, nil
}
