FROM golang:1.23-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum
COPY go.mod ./
COPY go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY *.go ./
COPY pkg/ ./pkg/

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -o web-proxy .

# Create a minimal runtime image
FROM alpine:latest

WORKDIR /app

# Install CA certificates for SSL
RUN apk --no-cache add ca-certificates

# Copy the binary from the builder stage
COPY --from=builder /app/web-proxy .

# Expose HTTP and HTTPS ports
EXPOSE 80 443

# Run the proxy
ENTRYPOINT ["/app/web-proxy"]
