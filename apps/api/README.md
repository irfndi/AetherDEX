# AetherDEX Backend

The Go backend services for AetherDEX - a next-generation decentralized exchange.

## Architecture

This backend follows a microservices architecture with the following structure:

- `cmd/api/` - Main API server entry point
- `cmd/migrate/` - Database migration tools
- `cmd/worker/` - Background job workers
- `internal/` - Private application code
- `pkg/` - Public packages that can be imported
- `api/` - API definitions and handlers
- `configs/` - Configuration files for different environments
- `migrations/` - Database migration files

## Dependencies

- **Gin** - HTTP web framework
- **GORM** - ORM library with PostgreSQL driver
- **Redis** - Caching and session storage
- **JWT** - Authentication tokens
- **go-ethereum** - Ethereum blockchain interaction
- **Gorilla WebSocket** - Real-time communication
- **Logrus** - Structured logging
- **Testify** - Testing framework

## Setup

1. **Prerequisites**
   ```bash
   # Ensure Go 1.21+ is installed
   go version
   
   # Install PostgreSQL and Redis
   brew install postgresql redis
   ```

2. **Environment Configuration**
   ```bash
   # Copy the example environment file
   cp .env.example .env
   
   # Edit .env with your configuration
   nano .env
   ```

3. **Install Dependencies**
   ```bash
   # From the backend directory
   go mod tidy
   ```

4. **Database Setup**
   ```bash
   # Start PostgreSQL
   brew services start postgresql
   
   # Create database
   createdb aetherdex_dev
   ```

5. **Redis Setup**
   ```bash
   # Start Redis
   brew services start redis
   ```

## Running the Application

### Development Mode
```bash
# Start the API server
go run cmd/api/main.go

# The server will start on http://localhost:8080
```

### Production Mode
```bash
# Build the application
go build -o bin/api cmd/api/main.go

# Run the binary
./bin/api
```

## API Endpoints

- `GET /health` - Health check endpoint
- `GET /api/v1/ping` - Simple ping endpoint

## Testing

```bash
# Run all tests
go test ./...

# Run tests with coverage
go test -cover ./...

# Run specific package tests
go test ./internal/handlers
```

## Environment Variables

See `.env.example` for all available configuration options.

## Development

### Code Structure
- Follow Go best practices and conventions
- Use dependency injection for better testability
- Implement proper error handling and logging
- Write comprehensive tests for all functionality

### Adding New Features
1. Create handlers in `internal/handlers/`
2. Define models in `internal/models/`
3. Implement services in `internal/services/`
4. Add routes in `api/v1/`
5. Write tests for all new functionality

## Deployment

The backend is designed to be deployed as containerized microservices. Docker configurations and deployment scripts will be added in future updates