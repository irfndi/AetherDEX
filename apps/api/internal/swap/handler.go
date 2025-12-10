package swap

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler handles HTTP requests for swap operations
type Handler struct {
	service Service
}

// NewHandler creates a new swap handler
func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}

// GetQuote handles POST /swap/quote requests
func (h *Handler) GetQuote(c *gin.Context) {
	var req SwapQuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "invalid request",
			"details": err.Error(),
		})
		return
	}

	quote, err := h.service.GetQuote(&req)
	if err != nil {
		// Determine appropriate status code based on error
		statusCode := http.StatusInternalServerError
		if err.Error() == "pool not found for token pair" ||
			err.Error() == "input token not found" ||
			err.Error() == "output token not found" {
			statusCode = http.StatusNotFound
		} else if err.Error() == "token addresses required" ||
			err.Error() == "cannot swap same token" ||
			err.Error() == "amount must be positive" {
			statusCode = http.StatusBadRequest
		} else if err.Error() == "insufficient liquidity" {
			statusCode = http.StatusUnprocessableEntity
		}

		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, quote)
}

// RegisterRoutes registers swap routes on the given router group
func (h *Handler) RegisterRoutes(router *gin.RouterGroup) {
	swap := router.Group("/swap")
	{
		swap.POST("/quote", h.GetQuote)
	}
}
