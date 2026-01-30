package proxy

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/deployra/deployra/proxies/ingress/pkg/config"
	"golang.org/x/sync/semaphore"
)

// Buffer pooling is implemented in buffer_pool.go
// DNS caching is implemented in dns.go

// Server is a proxy for TCP connections
type Server struct {
	config       *config.Config
	listeners    map[int]net.Listener
	connections  sync.WaitGroup
	portMappings map[int]*config.PortMapping // Maps port to target service for efficient lookup
	healthServer *http.Server                // HTTP server for health checks
	connSem      *semaphore.Weighted         // Semaphore to limit concurrent connections
	bufferPool   *BufferPool                 // Pool of buffers for I/O operations
	dnsCache     *DNSCache                   // Cache for DNS resolutions
}

// NewServer creates a new proxy server
func NewServer(cfg *config.Config) (*Server, error) {
	// Create port to service mapping for more efficient lookup
	portMappings := make(map[int]*config.PortMapping)
	for _, mapping := range cfg.PortMappings {
		// Store a pointer to the mapping in the config
		mappingCopy := mapping // Make a copy to avoid pointer issues
		portMappings[mapping.Port] = &mappingCopy
	}

	// Create server instance with connection limiting semaphore, buffer pool, and DNS cache
	server := &Server{
		config:       cfg,
		listeners:    make(map[int]net.Listener),
		portMappings: portMappings,
		connSem:      semaphore.NewWeighted(int64(cfg.MaxConnections)),
		bufferPool:   NewBufferPool(cfg.ReadBufferSize),
		dnsCache:     NewDNSCache(5 * time.Minute), // 5-minute TTL for DNS cache entries
	}

	log.Printf("Proxy server initialized with maximum %d concurrent connections and %d byte buffers",
		cfg.MaxConnections, cfg.ReadBufferSize)
	log.Printf("DNS cache enabled with 5-minute TTL")
	return server, nil
}

// Start starts the proxy server
func (s *Server) Start(ctx context.Context) error {
	// Start DNS cache cleanup routine
	go s.dnsCache.Cleanup(ctx)

	// Start health check server
	if err := s.startHealthServer(ctx); err != nil {
		return fmt.Errorf("failed to start health server: %v", err)
	}

	// Start listeners for each port mapping
	for _, mapping := range s.config.PortMappings {
		port := mapping.Port
		if err := s.startListener(ctx, port); err != nil {
			return fmt.Errorf("failed to start listener on port %d: %v", port, err)
		}
	}

	// Wait for context cancellation to stop servers
	<-ctx.Done()
	log.Println("Shutting down servers...")

	// Create shutdown context with timeout
	shutdownCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// Shutdown health check server
	if s.healthServer != nil {
		if err := s.healthServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("Error shutting down health server: %v", err)
		}
	}

	// Wait for active connections to close or timeout
	done := make(chan struct{})
	go func() {
		s.connections.Wait()
		close(done)
	}()

	// Wait for active connections to close or timeout
	select {
	case <-done:
		log.Println("All connections closed. Graceful shutdown complete.")
	case <-shutdownCtx.Done():
		log.Println("Shutdown timeout reached. Some connections may still be open.")
	}

	// Close all listeners
	for port, listener := range s.listeners {
		log.Printf("Closing listener on port %d", port)
		listener.Close()
	}

	return nil
}

// startHealthServer starts an HTTP server for health checks
func (s *Server) startHealthServer(ctx context.Context) error {
	mux := http.NewServeMux()

	// Register health check handler
	mux.HandleFunc("/healtz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Create HTTP server
	s.healthServer = &http.Server{
		Addr:    ":8088",
		Handler: mux,
	}

	// Start HTTP server in a goroutine
	go func() {
		log.Printf("Starting health check server on :8088")

		// Start server with standard listener
		if err := s.healthServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("Health check server error: %v", err)
		}
	}()

	return nil
}

// startListener starts a listener on the specified port
func (s *Server) startListener(ctx context.Context, port int) error {
	// Skip the health check port, as it's handled by the HTTP server
	if port == 8088 {
		return nil
	}

	addr := fmt.Sprintf(":%d", port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %v", addr, err)
	}

	s.listeners[port] = listener

	log.Printf("Proxy listening on port %d", port)

	// Start connection handler
	go s.acceptConnections(ctx, port)

	return nil
}

// acceptConnections accepts incoming connections
func (s *Server) acceptConnections(ctx context.Context, port int) {
	listener := s.listeners[port]

	for {
		conn, err := listener.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
				log.Printf("Failed to accept connection on port %d: %v", port, err)
				continue
			}
		}

		// Apply TCP optimizations if possible
		if tcpConn, ok := conn.(*net.TCPConn); ok {
			if err := tcpConn.SetKeepAlive(true); err != nil {
				log.Printf("Warning: Failed to set keep alive: %v", err)
			}
			if err := tcpConn.SetKeepAlivePeriod(3 * time.Minute); err != nil {
				log.Printf("Warning: Failed to set keep alive period: %v", err)
			}
			if err := tcpConn.SetNoDelay(true); err != nil {
				log.Printf("Warning: Failed to set TCP no delay: %v", err)
			}
		}

		// Try to acquire a connection slot using our semaphore
		if !s.connSem.TryAcquire(1) {
			log.Printf("Connection limit reached (%d), rejecting connection from %s", s.config.MaxConnections, conn.RemoteAddr().String())
			conn.Close()
			continue
		}

		// Track connection in WaitGroup for graceful shutdown
		s.connections.Add(1)
		go func() {
			defer s.connSem.Release(1) // Release the semaphore when done
			defer s.connections.Done()
			s.handleConnection(ctx, conn, port)
		}()
	}
}

// handleConnection handles a TCP connection
func (s *Server) handleConnection(ctx context.Context, clientConn net.Conn, sourcePort int) {
	// Create a cancellable context for this connection
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel() // Ensure context is always cancelled when function exits
	defer clientConn.Close()

	clientAddr := clientConn.RemoteAddr().String()
	log.Printf("New connection from %s on port %d", clientAddr, sourcePort)

	// Get target service directly from the mapping
	targetService, exists := s.portMappings[sourcePort]
	if !exists {
		log.Printf("Error: No mapping found for port %d", sourcePort)
		return
	}

	// Build the Kubernetes service DNS name
	// Format: <service-name>.<namespace>.svc.cluster.local
	serviceDNS := fmt.Sprintf("%s.%s.svc.cluster.local",
		targetService.ServiceName,
		targetService.ServiceNamespace)

	// Format service address for connection
	portStr := fmt.Sprintf("%d", targetService.ServicePort)
	log.Printf("Resolving service DNS: %s", serviceDNS)

	// Use DNS cache to resolve the hostname
	ips, err := s.dnsCache.Lookup(serviceDNS)
	if err != nil {
		log.Printf("Failed to resolve service DNS %s: %v", serviceDNS, err)
		return
	}

	// No IPs found
	if len(ips) == 0 {
		log.Printf("No IP addresses found for service %s", serviceDNS)
		return
	}

	// Use the first IP address (typically what would happen with normal DNS resolution)
	address := net.JoinHostPort(ips[0].String(), portStr)
	log.Printf("Connecting to %s (resolved from %s)", address, serviceDNS)

	// Connect using the resolved IP
	dialer := &net.Dialer{Timeout: s.config.ConnectionTimeout}

	// Use context for connection cancellation
	serverConn, err := dialer.DialContext(connCtx, "tcp", address)
	if err != nil {
		log.Printf("Failed to connect to target service %s: %v", address, err)
		return
	}
	defer serverConn.Close()

	// Apply TCP optimizations to server connection
	if tcpConn, ok := serverConn.(*net.TCPConn); ok {
		if err := tcpConn.SetKeepAlive(true); err != nil {
			log.Printf("Warning: Failed to set keep alive on server connection: %v", err)
		}
		if err := tcpConn.SetKeepAlivePeriod(3 * time.Minute); err != nil {
			log.Printf("Warning: Failed to set keep alive period on server connection: %v", err)
		}
		if err := tcpConn.SetNoDelay(true); err != nil {
			log.Printf("Warning: Failed to set TCP no delay on server connection: %v", err)
		}
	}

	log.Printf("Connected to %s from %s", address, clientAddr)

	// Use buffer pool and CopyBuffer for more efficient data transfer
	errCh := make(chan error, 2)

	// Client -> Server data flow
	go func() {
		// Get buffer from pool
		buf := s.bufferPool.Get()
		defer s.bufferPool.Put(buf) // Return buffer to pool when done

		// Use CopyBuffer with pooled buffer
		_, err := io.CopyBuffer(serverConn, clientConn, *buf)
		errCh <- err
	}()

	// Server -> Client data flow
	go func() {
		// Get buffer from pool
		buf := s.bufferPool.Get()
		defer s.bufferPool.Put(buf) // Return buffer to pool when done

		// Use CopyBuffer with pooled buffer
		_, err := io.CopyBuffer(clientConn, serverConn, *buf)
		errCh <- err
	}()

	// Wait for the first error or context cancellation
	select {
	case err := <-errCh:
		if err != nil && !isConnectionClosed(err) {
			log.Printf("Connection error: %v", err)
		}
	case <-connCtx.Done(): // Use connection-specific context here
		log.Printf("Connection closed due to server shutdown")
	}

	log.Printf("Connection from %s closed", clientAddr)
}

// isConnectionClosed returns true if the error indicates a closed connection
func isConnectionClosed(err error) bool {
	return err == io.EOF || strings.Contains(err.Error(), "use of closed network connection")
}
