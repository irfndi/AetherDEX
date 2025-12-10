FROM golang:1.23-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git make build-base

# Copy go mod and sum files
COPY go.mod go.sum ./

# Download all dependencies
RUN go mod download

# Copy the source from the current directory
COPY . .

# Expose port 8080
EXPOSE 8080

# Command to run the executable
CMD ["go", "run", "cmd/api/main.go"]
