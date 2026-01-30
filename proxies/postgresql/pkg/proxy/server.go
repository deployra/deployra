package proxy

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"

	"github.com/deployra/deployra/proxies/postgresql/pkg/config"
	"github.com/deployra/deployra/proxies/postgresql/pkg/kubernetes"
	"github.com/pires/go-proxyproto"
	"golang.org/x/sync/semaphore"
)

// Server is a proxy for PostgreSQL connections
type Server struct {
	config        *config.Config
	kubeClient    *kubernetes.Client
	services      map[string]*kubernetes.ServiceInfo
	listener      net.Listener
	proxyListener *proxyproto.Listener
	routingTable  map[string]string
	routingLock   sync.RWMutex
	connections   sync.WaitGroup
	connSem       *semaphore.Weighted // Semaphore to limit concurrent connections
	bufferPool    *BufferPool         // Pool of buffers for I/O operations
	dnsCache      *DNSCache           // Cache for DNS resolutions
}

// NewServer creates a new proxy server
func NewServer(cfg *config.Config) (*Server, error) {
	// Create Kubernetes client
	kubeClient, err := kubernetes.NewClient(cfg.KubeConfigPath, cfg.LabelSelector)
	if err != nil {
		return nil, fmt.Errorf("failed to create Kubernetes client: %v", err)
	}

	// Create server instance with connection limiting, buffer pool, and DNS cache
	server := &Server{
		config:       cfg,
		kubeClient:   kubeClient,
		services:     make(map[string]*kubernetes.ServiceInfo),
		routingTable: make(map[string]string),
		connSem:      semaphore.NewWeighted(int64(cfg.MaxConnections)),
		bufferPool:   NewBufferPool(cfg.ReadBufferSize),
		dnsCache:     NewDNSCache(5 * time.Minute), // 5-minute TTL for DNS cache entries
	}

	log.Printf("PostgreSQL proxy initialized with maximum %d concurrent connections and %d byte buffers",
		cfg.MaxConnections, cfg.ReadBufferSize)
	log.Printf("DNS cache enabled with 5-minute TTL")

	return server, nil
}

// Start starts the proxy server
func (s *Server) Start(ctx context.Context) error {
	// Create a context that we can use to ensure proper cleanup
	serverCtx, serverCancel := context.WithCancel(ctx)
	defer serverCancel() // Ensure all resources are cleaned up if we return early

	// Start DNS cache cleanup routine
	go s.dnsCache.Cleanup(serverCtx)

	// Start Kubernetes watcher
	if err := s.kubeClient.StartWatching(s.handleServicesChanged); err != nil {
		log.Printf("Warning: Failed to start Kubernetes watcher: %v", err)
	} else {
		log.Println("Started Kubernetes service watcher")
	}

	var err error
	s.listener, err = net.Listen("tcp", s.config.ListenAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %v", s.config.ListenAddr, err)
	}

	if s.config.UseProxyProto {
		proxyListener := &proxyproto.Listener{Listener: s.listener}
		s.proxyListener = proxyListener
	}

	log.Printf("PostgreSQL proxy listening on %s", s.config.ListenAddr)

	// Start connection handler
	go s.acceptConnections(ctx)

	// Wait for context cancellation to stop servers
	<-ctx.Done()
	log.Println("Shutting down servers...")

	// Create shutdown context with timeout - use Background() as parent since ctx is already cancelled
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel() // Ensure this is always called

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
		// When timeout is reached, we need to be more aggressive
		// This will propagate cancellation to all child connections
		serverCancel()
	}

	// Stop Kubernetes watcher
	s.kubeClient.StopWatching()

	// Close the listener
	if s.proxyListener != nil {
		s.proxyListener.Close()
	} else {
		s.listener.Close()
	}

	return nil
}

// acceptConnections accepts incoming connections
func (s *Server) acceptConnections(ctx context.Context) {
	for {
		var conn net.Conn
		var err error

		if s.proxyListener != nil {
			conn, err = s.proxyListener.Accept()
		} else {
			conn, err = s.listener.Accept()
		}

		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
				log.Printf("Failed to accept connection: %v", err)
				continue
			}
		}

		// Try to acquire a connection slot using our semaphore
		if !s.connSem.TryAcquire(1) {
			log.Printf("Connection limit reached (%d), rejecting connection from %s",
				s.config.MaxConnections, conn.RemoteAddr().String())
			conn.Close()
			continue
		}

		// Track connection in WaitGroup for graceful shutdown
		s.connections.Add(1)
		go func() {
			defer s.connSem.Release(1) // Release the semaphore when done
			defer s.connections.Done()
			s.handleConnection(ctx, conn)
		}()
	}
}

// handleServicesChanged is called when services change in Kubernetes
func (s *Server) handleServicesChanged(action kubernetes.ServiceInfoAction, serviceKey string, info *kubernetes.ServiceInfo) {
	log.Printf("Services changed, updating routing table...")

	// Update services map
	s.routingLock.Lock()
	defer s.routingLock.Unlock()

	if action == kubernetes.Add {
		if info != nil {
			s.services[serviceKey] = info
			for _, username := range info.Usernames {
				s.routingTable[username] = serviceKey
				log.Printf("Added route: %s -> %s", username, serviceKey)
			}
		} else {
			log.Printf("Warning: Received nil ServiceInfo for Add action on service %s", serviceKey)
		}
	} else if action == kubernetes.Delete {
		if s.services != nil {
			// When deleting a service, remove associated username routes
			if oldServiceInfo, exists := s.services[serviceKey]; exists && oldServiceInfo != nil {
				for _, username := range oldServiceInfo.Usernames {
					delete(s.routingTable, username)
					log.Printf("Removed route for username: %s", username)
				}
				delete(s.services, serviceKey)
			} else {
				// If we don't have the service info, clean up by iterating through routing table
				for username, key := range s.routingTable {
					if key == serviceKey {
						delete(s.routingTable, username)
						log.Printf("Removed route for username: %s", username)
					}
				}
			}
		}
	}

	// Debug logging
	log.Printf("Current routing table:")
	for username, serviceKey := range s.routingTable {
		if serviceInfo, ok := s.services[serviceKey]; ok {
			log.Printf("  %s -> %s/%s", username, serviceInfo.Namespace, serviceInfo.Name)
		}
	}
}

// handleConnection handles a PostgreSQL connection
func (s *Server) handleConnection(ctx context.Context, clientConn net.Conn) {
	// Create a cancellable context for this connection
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel() // Ensure context is always cancelled when function exits
	defer clientConn.Close()

	clientIP := clientConn.RemoteAddr().String()
	log.Printf("New connection from %s", clientIP)

	// Read the initial PostgreSQL startup message
	username, startupPacket, err := s.extractPostgreSQLUsername(clientConn)
	if err != nil {
		log.Printf("Error extracting username from PostgreSQL startup message: %v", err)
		return
	}

	// Find target service for username
	s.routingLock.RLock()
	serviceKey, exists := s.routingTable[username]
	s.routingLock.RUnlock()

	if !exists {
		log.Printf("No route found for connection from %s", clientIP)
		// Send error message to client
		s.sendErrorToClient(clientConn, fmt.Sprintf("No PostgreSQL service found for username: %s", username))
		return
	}

	// Lookup service info
	s.routingLock.RLock()
	serviceInfo, exists := s.services[serviceKey]
	s.routingLock.RUnlock()

	if !exists || serviceInfo == nil {
		log.Printf("Service info not found for key: %s", serviceKey)
		s.sendErrorToClient(clientConn, "Internal routing error")
		return
	}

	// Format service address for connection
	serviceDNS := fmt.Sprintf("%s.%s.svc.cluster.local", serviceInfo.Name, serviceInfo.Namespace)
	portStr := fmt.Sprintf("%d", serviceInfo.Port)

	log.Printf("Resolving service DNS: %s", serviceDNS)

	// Use DNS cache to resolve the hostname
	ips, err := s.dnsCache.Lookup(serviceDNS)
	if err != nil {
		log.Printf("Failed to resolve service DNS %s: %v", serviceDNS, err)
		s.sendErrorToClient(clientConn, fmt.Sprintf("Failed to resolve database address: %v", err))
		return
	}

	// No IPs found
	if len(ips) == 0 {
		log.Printf("No IP addresses found for service %s", serviceDNS)
		s.sendErrorToClient(clientConn, "Failed to resolve database address: no addresses found")
		return
	}

	// Use the first IP address
	address := net.JoinHostPort(ips[0].String(), portStr)
	log.Printf("Connecting to PostgreSQL server: %s (resolved from %s)", address, serviceDNS)

	// Connect using the resolved IP with context for cancellation
	dialer := &net.Dialer{Timeout: s.config.ConnectionTimeout}

	serverConn, err := dialer.DialContext(connCtx, "tcp", address)
	if err != nil {
		log.Printf("Failed to connect to PostgreSQL server %s: %v", address, err)
		s.sendErrorToClient(clientConn, fmt.Sprintf("Failed to connect to database: %v", err))
		return
	}
	defer serverConn.Close()

	// Forward the startup message to the server
	if _, err := serverConn.Write(startupPacket); err != nil {
		log.Printf("Failed to forward startup message: %v", err)
		return
	}

	// Proxy data between client and server
	errCh := make(chan error, 2)

	// Set up bidirectional proxy with buffer pool
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

	// Wait for either connection to close
	select {
	case err := <-errCh:
		if err != nil && err != io.EOF {
			log.Printf("Connection error: %v", err)
		}
	case <-connCtx.Done(): // Use connection-specific context here
		log.Printf("Connection closed due to server shutdown")
	}
}

// extractPostgreSQLUsername extracts the username from PostgreSQL startup message
func (s *Server) extractPostgreSQLUsername(clientConn net.Conn) (string, []byte, error) {
	// Set read deadline
	clientConn.SetReadDeadline(time.Now().Add(5 * time.Second))
	defer clientConn.SetReadDeadline(time.Time{})

	// Read message length (4 bytes)
	lengthBuf := make([]byte, 4)
	if _, err := io.ReadFull(clientConn, lengthBuf); err != nil {
		return "", nil, fmt.Errorf("failed to read message length: %v", err)
	}

	// Calculate message length (minus the length field itself)
	messageLength := int(lengthBuf[0])<<24 | int(lengthBuf[1])<<16 | int(lengthBuf[2])<<8 | int(lengthBuf[3])
	messageLength -= 4

	if messageLength <= 0 || messageLength > 8192 {
		return "", nil, fmt.Errorf("invalid message length: %d", messageLength)
	}

	// Read the protocol version (4 bytes)
	versionBuf := make([]byte, 4)
	if _, err := io.ReadFull(clientConn, versionBuf); err != nil {
		return "", nil, fmt.Errorf("failed to read protocol version: %v", err)
	}

	// Parse version
	version := int(versionBuf[0])<<24 | int(versionBuf[1])<<16 | int(versionBuf[2])<<8 | int(versionBuf[3])

	// Check if it's an SSL request (80877103)
	if version == 80877103 {
		log.Printf("Client requested SSL connection")
		
		// Send 'N' to indicate we don't support SSL
		_, err := clientConn.Write([]byte{"N"[0]})
		if err != nil {
			return "", nil, fmt.Errorf("failed to send SSL rejection: %v", err)
		}
		
		// Read the regular startup message that should follow
		return s.readStartupMessage(clientConn)
	}
	
	// Check that it's a standard startup message (version 196608)
	if version != 196608 {
		return "", nil, fmt.Errorf("unexpected protocol version: %d", version)
	}

	// Read the parameters (messageLength - 4 bytes)
	paramBuf := make([]byte, messageLength-4)
	if _, err := io.ReadFull(clientConn, paramBuf); err != nil {
		return "", nil, fmt.Errorf("failed to read parameters: %v", err)
	}

	// Combine all parts into complete message for later forwarding
	startupPacket := append(lengthBuf, versionBuf...)
	startupPacket = append(startupPacket, paramBuf...)

	// Parse parameters to find username
	var username string
	i := 0
	for i < len(paramBuf) {
		// Find parameter name (null-terminated)
		nameStart := i
		for i < len(paramBuf) && paramBuf[i] != 0 {
			i++
		}

		if i >= len(paramBuf) {
			break // Invalid format
		}

		paramName := string(paramBuf[nameStart:i])
		i++ // Skip null terminator

		// Find parameter value (null-terminated)
		valueStart := i
		for i < len(paramBuf) && paramBuf[i] != 0 {
			i++
		}

		if i >= len(paramBuf) {
			break // Invalid format
		}

		paramValue := string(paramBuf[valueStart:i])
		i++ // Skip null terminator

		// Check if this is the user parameter
		if paramName == "user" {
			username = paramValue
			break
		}
	}

	if username == "" {
		return "", nil, fmt.Errorf("username not found in startup message")
	}

	return username, startupPacket, nil
}

// readStartupMessage reads a standard PostgreSQL startup message after handling SSL negotiation
func (s *Server) readStartupMessage(clientConn net.Conn) (string, []byte, error) {
	// Read message length (4 bytes)
	lengthBuf := make([]byte, 4)
	if _, err := io.ReadFull(clientConn, lengthBuf); err != nil {
		return "", nil, fmt.Errorf("failed to read message length: %v", err)
	}

	// Calculate message length (minus the length field itself)
	messageLength := int(lengthBuf[0])<<24 | int(lengthBuf[1])<<16 | int(lengthBuf[2])<<8 | int(lengthBuf[3])
	messageLength -= 4

	if messageLength <= 0 || messageLength > 8192 {
		return "", nil, fmt.Errorf("invalid message length: %d", messageLength)
	}

	// Read the protocol version (4 bytes)
	versionBuf := make([]byte, 4)
	if _, err := io.ReadFull(clientConn, versionBuf); err != nil {
		return "", nil, fmt.Errorf("failed to read protocol version: %v", err)
	}

	// Check that it's a startup message (version 196608)
	version := int(versionBuf[0])<<24 | int(versionBuf[1])<<16 | int(versionBuf[2])<<8 | int(versionBuf[3])
	if version != 196608 {
		return "", nil, fmt.Errorf("unexpected protocol version after SSL negotiation: %d", version)
	}
	
	// Read the parameters (messageLength - 4 bytes)
	paramBuf := make([]byte, messageLength-4)
	if _, err := io.ReadFull(clientConn, paramBuf); err != nil {
		return "", nil, fmt.Errorf("failed to read parameters: %v", err)
	}

	// Combine all parts into complete message for later forwarding
	startupPacket := append(lengthBuf, versionBuf...)
	startupPacket = append(startupPacket, paramBuf...)

	// Parse parameters to find username
	var username string
	i := 0
	for i < len(paramBuf) {
		// Find parameter name (null-terminated)
		nameStart := i
		for i < len(paramBuf) && paramBuf[i] != 0 {
			i++
		}

		if i >= len(paramBuf) {
			break // Invalid format
		}

		paramName := string(paramBuf[nameStart:i])
		i++ // Skip null terminator

		// Find parameter value (null-terminated)
		valueStart := i
		for i < len(paramBuf) && paramBuf[i] != 0 {
			i++
		}

		if i >= len(paramBuf) {
			break // Invalid format
		}

		paramValue := string(paramBuf[valueStart:i])
		i++ // Skip null terminator

		// Check if this is the user parameter
		if paramName == "user" {
			username = paramValue
			break
		}
	}

	if username == "" {
		return "", nil, fmt.Errorf("username not found in startup message")
	}

	return username, startupPacket, nil
}

// sendErrorToClient sends a PostgreSQL error message to the client
func (s *Server) sendErrorToClient(conn net.Conn, message string) {
	// 'E' for error message
	errorMessage := []byte{'E'}

	// Add "severity" field ('S')
	errorMessage = append(errorMessage, 'S')
	errorMessage = append(errorMessage, "ERROR"...)
	errorMessage = append(errorMessage, 0) // null terminator

	// Add "code" field ('C')
	errorMessage = append(errorMessage, 'C')
	errorMessage = append(errorMessage, "28000"...) // 28000 = invalid_authorization_specification
	errorMessage = append(errorMessage, 0)          // null terminator

	// Add "message" field ('M')
	errorMessage = append(errorMessage, 'M')
	errorMessage = append(errorMessage, message...)
	errorMessage = append(errorMessage, 0) // null terminator

	// Add final null terminator to mark end of error
	errorMessage = append(errorMessage, 0)

	// Create packet header with length (includes length of message + 4 bytes for length itself)
	length := len(errorMessage) + 4
	header := []byte{
		byte(length >> 24 & 0xFF),
		byte(length >> 16 & 0xFF),
		byte(length >> 8 & 0xFF),
		byte(length & 0xFF),
	}

	// Combine header and message
	packet := append(header, errorMessage...)

	// Send error message
	conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	conn.Write(packet)
	conn.SetWriteDeadline(time.Time{})
}

// Wait waits for all connections to finish
func (s *Server) Wait() {
	s.connections.Wait()
}
