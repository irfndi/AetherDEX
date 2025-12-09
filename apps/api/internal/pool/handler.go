package pool

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service Service
}

func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CreatePool(c *gin.Context) {
	var pool Pool
	if err := c.ShouldBindJSON(&pool); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.CreatePool(&pool); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, pool)
}

func (h *Handler) GetPool(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	pool, err := h.service.GetPoolByID(uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if pool == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "pool not found"})
		return
	}

	c.JSON(http.StatusOK, pool)
}

func (h *Handler) ListPools(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "10")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)

	pools, err := h.service.ListPools(limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, pools)
}

func (h *Handler) RegisterRoutes(router *gin.RouterGroup) {
	pools := router.Group("/pools")
	{
		pools.POST("", h.CreatePool)
		pools.GET("", h.ListPools)
		pools.GET("/:id", h.GetPool)
	}
}
