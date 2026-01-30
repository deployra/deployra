package proxy

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"

	"bytes"

	"github.com/deployra/deployra/proxies/mysql/pkg/config"
	"github.com/deployra/deployra/proxies/mysql/pkg/kubernetes"
	"github.com/pires/go-proxyproto"
	"golang.org/x/sync/semaphore"
)

// Server is a proxy for MySQL connections
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

	log.Printf("MySQL proxy initialized with maximum %d concurrent connections and %d byte buffers",
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

	log.Printf("MySQL proxy listening on %s", s.config.ListenAddr)

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

	if action == kubernetes.Add {
		// Add a nil check for info in the Add case as well
		if info != nil {
			s.services[serviceKey] = info
			for _, username := range info.Usernames {
				s.routingTable[username] = serviceKey
			}
		} else {
			log.Printf("Warning: Received nil ServiceInfo for Add action on service %s", serviceKey)
		}
	} else if action == kubernetes.Delete {
		if s.services != nil {
			delete(s.services, serviceKey)
		}

		// When deleting a service, info might be nil
		// Get the usernames from the existing service info before deleting
		var usernames []string
		if existingInfo, exists := s.services[serviceKey]; exists && existingInfo != nil {
			usernames = existingInfo.Usernames
		} else if info != nil {
			usernames = info.Usernames
		}

		// Delete routing table entries for all usernames
		if s.routingTable != nil && len(usernames) > 0 {
			for _, username := range usernames {
				delete(s.routingTable, username)
			}
		}
	}

	s.routingLock.Unlock()
}

// handleConnection handles a MySQL connection
func (s *Server) handleConnection(ctx context.Context, clientConn net.Conn) {
	// Create a cancellable context for this connection
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel() // Ensure context is always cancelled when function exits
	defer clientConn.Close()

	// Extract username from MySQL handshake
	username, clientHandshake, err := s.extractMySQLUsername(clientConn)
	if err != nil {
		log.Printf("Failed to extract username: %v", err)
		return
	}

	var routingService *kubernetes.ServiceInfo
	// Find target service from the routing table
	s.routingLock.RLock()

	serviceKey, routingFound := s.routingTable[username]
	if routingFound {
		service, serviceFound := s.services[serviceKey]
		if serviceFound {
			routingService = service
		}
	}

	s.routingLock.RUnlock()

	if routingService == nil {
		log.Printf("No route found for user: %s", username)
		return
	}

	// Connect to the target MySQL server using Kubernetes service discovery
	// Format: <service-name>.<namespace>.svc.cluster.local
	serviceDNS := fmt.Sprintf("%s.%s.svc.cluster.local",
		routingService.Name,
		routingService.Namespace)
	portStr := fmt.Sprintf("%d", routingService.Port)
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

	// Use the first IP address
	address := net.JoinHostPort(ips[0].String(), portStr)
	log.Printf("Connecting to MySQL service: %s (resolved from %s)", address, serviceDNS)

	// Connect using the resolved IP with context for cancellation
	dialer := &net.Dialer{Timeout: s.config.ConnectionTimeout}
	serverConn, err := dialer.DialContext(connCtx, "tcp", address)
	if err != nil {
		log.Printf("Failed to connect to MySQL service %s: %v", address, err)
		return
	}
	defer serverConn.Close()

	// Complete the handshake with the server
	if err := s.completeHandshake(clientConn, serverConn, clientHandshake); err != nil {
		log.Printf("Failed to complete handshake: %v", err)
		return
	}

	// Proxy data between client and server with optimized buffering
	log.Printf("Starting data proxy for MySQL connection from %s", clientConn.RemoteAddr())

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

// extractMySQLUsername extracts the username from a MySQL handshake
func (s *Server) extractMySQLUsername(clientConn net.Conn) (string, []byte, error) {
	// Set read deadline to prevent hanging
	clientConn.SetReadDeadline(time.Now().Add(5 * time.Second))
	defer clientConn.SetReadDeadline(time.Time{})

	// Send initial handshake packet to client
	initialHandshake := s.createInitialHandshake()

	// Write handshake to client
	if _, err := clientConn.Write(initialHandshake); err != nil {
		return "", nil, fmt.Errorf("failed to send initial handshake: %v", err)
	}

	// Read client authentication packet
	clientHeader := make([]byte, 4)
	if _, err := io.ReadFull(clientConn, clientHeader); err != nil {
		return "", nil, fmt.Errorf("failed to read client auth header: %v", err)
	}

	// Get packet length (first 3 bytes, little endian)
	clientPacketLen := int(clientHeader[0]) | int(clientHeader[1])<<8 | int(clientHeader[2])<<16

	// Read client auth packet
	clientPacket := make([]byte, clientPacketLen)
	if _, err := io.ReadFull(clientConn, clientPacket); err != nil {
		return "", nil, fmt.Errorf("failed to read client auth packet: %v", err)
	}

	// Parse MySQL client authentication packet
	// Format: https://dev.mysql.com/doc/internals/en/connection-phase-packets.html#packet-Protocol::HandshakeResponse41

	// Skip client capabilities, max packet size, and charset (4 + 4 + 1 = 9 bytes)
	offset := 9

	// Skip reserved bytes (23 bytes)
	offset += 23

	// Username is a null-terminated string
	usernameEnd := offset
	for usernameEnd < len(clientPacket) && clientPacket[usernameEnd] != 0 {
		usernameEnd++
	}

	if usernameEnd >= len(clientPacket) {
		return "", nil, fmt.Errorf("malformed packet: no null terminator for username")
	}

	username := string(clientPacket[offset:usernameEnd])

	// Combine header and packet for later use
	fullClientHandshake := append(clientHeader, clientPacket...)

	return username, fullClientHandshake, nil
}

// createInitialHandshake creates an initial handshake packet for MySQL protocol
func (s *Server) createInitialHandshake() []byte {
	// Create a basic MySQL initial handshake packet
	// Protocol version
	packet := []byte{10} // MySQL protocol version 10

	// Server version (null-terminated string)
	packet = append(packet, []byte("5.7.30-proxy\x00")...)

	// Thread ID (4 bytes)
	threadID := []byte{1, 0, 0, 0}
	packet = append(packet, threadID...)

	// Auth plugin data part 1 (8 bytes)
	authData1 := []byte("12345678")
	packet = append(packet, authData1...)

	// Filler (1 byte)
	packet = append(packet, 0)

	// Capability flags, lower 2 bytes
	packet = append(packet, 0xff, 0xf7)

	// Character set
	packet = append(packet, 0x33) // utf8_general_ci

	// Status flags
	packet = append(packet, 0x02, 0x00)

	// Capability flags, upper 2 bytes
	packet = append(packet, 0xff, 0x81)

	// Auth plugin data len
	packet = append(packet, 21)

	// Reserved (10 bytes)
	packet = append(packet, bytes.Repeat([]byte{0}, 10)...)

	// Auth plugin data part 2 (13 bytes)
	authData2 := []byte("901234567890\x00")
	packet = append(packet, authData2...)

	// Auth plugin name (null-terminated string)
	packet = append(packet, []byte("mysql_native_password\x00")...)

	// Create packet header (4 bytes)
	// First 3 bytes: packet length (little endian)
	packetLen := len(packet)
	header := []byte{
		byte(packetLen),
		byte(packetLen >> 8),
		byte(packetLen >> 16),
		0, // Packet sequence number
	}

	// Combine header and packet
	return append(header, packet...)
}

// completeHandshake completes the MySQL handshake with the server
func (s *Server) completeHandshake(clientConn, serverConn net.Conn, clientHandshake []byte) error {
	// Set read/write deadlines
	serverConn.SetReadDeadline(time.Now().Add(5 * time.Second))
	defer serverConn.SetReadDeadline(time.Time{})

	// Read initial handshake packet from server
	serverHeader := make([]byte, 4)
	if _, err := io.ReadFull(serverConn, serverHeader); err != nil {
		return fmt.Errorf("failed to read server handshake header: %v", err)
	}

	// Get packet length
	serverPacketLen := int(serverHeader[0]) | int(serverHeader[1])<<8 | int(serverHeader[2])<<16

	// Read server handshake packet
	serverPacket := make([]byte, serverPacketLen)
	if _, err := io.ReadFull(serverConn, serverPacket); err != nil {
		return fmt.Errorf("failed to read server handshake packet: %v", err)
	}

	// Forward the client auth packet to the server
	if _, err := serverConn.Write(clientHandshake); err != nil {
		return fmt.Errorf("failed to forward client auth packet to server: %v", err)
	}

	// Read server response to auth
	respHeader := make([]byte, 4)
	if _, err := io.ReadFull(serverConn, respHeader); err != nil {
		return fmt.Errorf("failed to read server auth response header: %v", err)
	}

	// Get packet length
	respPacketLen := int(respHeader[0]) | int(respHeader[1])<<8 | int(respHeader[2])<<16

	// Read response packet
	respPacket := make([]byte, respPacketLen)
	if _, err := io.ReadFull(serverConn, respPacket); err != nil {
		return fmt.Errorf("failed to read server auth response packet: %v", err)
	}

	// Forward server response to client
	if _, err := clientConn.Write(respHeader); err != nil {
		return fmt.Errorf("failed to forward server auth response header to client: %v", err)
	}
	if _, err := clientConn.Write(respPacket); err != nil {
		return fmt.Errorf("failed to forward server auth response packet to client: %v", err)
	}

	return nil
}

// Wait waits for all connections to finish
func (s *Server) Wait() {
	s.connections.Wait()
}
