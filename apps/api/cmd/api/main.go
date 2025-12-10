package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irfndi/AetherDEX/apps/api/internal/auth"
	"github.com/irfndi/AetherDEX/apps/api/internal/pool"
	"github.com/irfndi/AetherDEX/apps/api/internal/token"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		logrus.Warn("No .env file found")
	}

	// Initialize logger
	logrus.SetFormatter(&logrus.JSONFormatter{})
	logrus.SetLevel(logrus.InfoLevel)

	// Database connection
	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"),
		os.Getenv("DB_PORT"),
	)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		logrus.WithError(err).Warn("Failed to connect to database")
	}

	// Redis connection
	rdb := redis.NewClient(&redis.Options{
		Addr:     os.Getenv("REDIS_ADDR"),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       0,
	})

	// Test Redis connection
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		logrus.WithError(err).Warn("Failed to connect to Redis")
	}

	// Initialize Gin router
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	// Security middleware
	router.Use(auth.SecurityHeaders())
	router.Use(auth.SecureCORS())

	// Initialize auth middleware
	authMiddleware := auth.NewAuthMiddleware()

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "ok",
			"timestamp": time.Now().Unix(),
			"service":   "aetherdex-api",
		})
	})

	// API v1 routes
	v1 := router.Group("/api/v1")
	{
		v1.GET("/ping", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"message": "pong"})
		})

		// Protected route example (can be expanded)
		v1.GET("/protected", authMiddleware.RequireAuth(), func(c *gin.Context) {
			address, _ := c.Get("user_address")
			c.JSON(http.StatusOK, gin.H{
				"message": "Access granted",
				"user":    address,
			})
		})

		// Pool module initialization
		poolRepo := pool.NewPoolRepository(db)
		poolService := pool.NewService(poolRepo)
		poolHandler := pool.NewHandler(poolService)
		poolHandler.RegisterRoutes(v1)

		// Token module initialization
		tokenRepo := token.NewTokenRepository(db)
		tokenService := token.NewService(tokenRepo)
		tokenHandler := token.NewHandler(tokenService)
		tokenHandler.RegisterRoutes(v1)
	}

	// Server configuration
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: router,
	}

	// Start server in a goroutine
	go func() {
		logrus.WithField("port", port).Info("Starting AetherDEX API server")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logrus.WithError(err).Fatal("Failed to start server")
		}
	}()

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logrus.Info("Shutting down server...")

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logrus.WithError(err).Fatal("Server forced to shutdown")
	}

	// Close database connection
	if db != nil {
		if sqlDB, err := db.DB(); err == nil {
			sqlDB.Close()
		}
	}

	// Close Redis connection
	rdb.Close()

	logrus.Info("Server exited")
}
