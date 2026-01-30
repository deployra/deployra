package proxy

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/deployra/deployra/proxies/memory/pkg/config"
	"github.com/deployra/deployra/proxies/memory/pkg/kubernetes"
	"github.com/google/uuid"
	"github.com/pires/go-proxyproto"
	"golang.org/x/sync/semaphore"
)

// Server is a proxy for Memory (Valkey/Redis-compatible) connections
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

	// Create server instance
	server := &Server{
		config:       cfg,
		kubeClient:   kubeClient,
		services:     make(map[string]*kubernetes.ServiceInfo, 0),
		routingTable: make(map[string]string, 0),
		connSem:      semaphore.NewWeighted(int64(cfg.MaxConnections)),
		bufferPool:   NewBufferPool(cfg.ReadBufferSize),
		dnsCache:     NewDNSCache(5 * time.Minute), // 5-minute TTL for DNS cache entries
	}

	log.Printf("Memory proxy initialized with maximum %d concurrent connections and %d byte buffers",
		cfg.MaxConnections, cfg.ReadBufferSize)
	log.Printf("DNS cache enabled with 5-minute TTL")

	return server, nil
}

// Start starts the proxy server
func (s *Server) Start(ctx context.Context) error {

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

	log.Printf("Memory proxy listening on %s", s.config.ListenAddr)

	// Start connection handler
	go s.acceptConnections(ctx)

	// Wait for context cancellation to stop servers
	<-ctx.Done()
	log.Println("Shutting down servers...")

	// Create shutdown context with timeout
	shutdownCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

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

		s.connections.Add(1)
		go func() {
			defer s.connections.Done()
			defer s.connSem.Release(1) // Always release the semaphore slot when done
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

// handleConnection handles a memory service connection
func (s *Server) handleConnection(ctx context.Context, clientConn net.Conn) {
	// Create a connection-specific context that will be canceled when this function returns
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Start DNS cache cleanup in background if not already running
	go s.dnsCache.Cleanup(connCtx)

	defer clientConn.Close()

	connectionID := uuid.New().String()
	clientIP := clientConn.RemoteAddr().String()
	log.Printf("[%s] New connection from %s", connectionID, clientIP)

	// Set initial read deadline
	// clientConn.SetReadDeadline(time.Now().Add(s.config.ReadTimeout))

	// Extract username from the connection
	buffer := make([]byte, 1024)
	n, err := clientConn.Read(buffer)
	if err != nil {
		log.Printf("Failed to read from client connection: %v", err)
		return
	}

	// Parse the command
	command := string(buffer[:n])
	username := ""

	// Check if it's an AUTH or HELLO command
	// AUTH command format: *2\r\n$4\r\nAUTH\r\n$<len>\r\n<password>\r\n
	// or with username and password: *3\r\n$4\r\nAUTH\r\n$<len>\r\n<username>\r\n$<len>\r\n<password>\r\n
	// HELLO command format (RESP3): HELLO [protover [AUTH username password] [SETNAME clientname]]
	parts := splitCommand(command)

	if len(parts) >= 1 && strings.ToUpper(parts[0]) == "AUTH" {
		if len(parts) == 2 {
			// Simple AUTH with password only
			username = "default" // Use a default username for simple AUTH
		} else if len(parts) >= 3 {
			// AUTH with username and password
			username = parts[1]
		}
	} else if len(parts) >= 1 && strings.ToUpper(parts[0]) == "HELLO" {
		// HELLO command with optional AUTH: HELLO 3 AUTH username password
		for i, part := range parts {
			if strings.ToUpper(part) == "AUTH" {
				if i+1 < len(parts) && i+2 < len(parts) {
					// AUTH username password format
					username = parts[i+1]
				} else if i+1 < len(parts) {
					// AUTH password only format
					username = "default"
				}
				break
			}
		}
	}

	if username == "" {
		// If no AUTH command or couldn't extract username, use IP address as fallback
		remoteAddr := clientConn.RemoteAddr().String()
		username = remoteAddr
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
		return
	}

	// Connect to the target memory server using Kubernetes service discovery
	// Format: <service-name>.<namespace>.svc.cluster.local
	serviceDNS := fmt.Sprintf("%s.%s.svc.cluster.local", routingService.Name, routingService.Namespace)

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
	serverAddr := net.JoinHostPort(ips[0].String(), fmt.Sprintf("%d", routingService.Port))

	// Create connection to the memory server with timeout
	dialer := &net.Dialer{Timeout: s.config.ConnectionTimeout}
	serverConn, err := dialer.DialContext(connCtx, "tcp", serverAddr)
	if err != nil {
		log.Printf("Failed to connect to memory server %s: %v", serverAddr, err)
		return
	}
	defer serverConn.Close()

	// Forward the initial command to the server
	_, err = serverConn.Write(buffer[:n])
	if err != nil {
		log.Printf("Failed to forward initial command to memory server: %v", err)
		return
	}

	// Proxy data between client and server using buffer pool
	errCh := make(chan error, 2)

	// Client -> Server
	go func() {
		// Get buffer from pool
		buf := s.bufferPool.Get()
		defer s.bufferPool.Put(buf) // Return buffer to pool when done

		// Use CopyBuffer with pooled buffer
		_, err := io.CopyBuffer(serverConn, clientConn, *buf)
		errCh <- err
	}()

	// Server -> Client
	go func() {
		// Get buffer from pool
		buf := s.bufferPool.Get()
		defer s.bufferPool.Put(buf) // Return buffer to pool when done

		// Use CopyBuffer with pooled buffer
		_, err := io.CopyBuffer(clientConn, serverConn, *buf)
		errCh <- err
	}()

	// Wait for either connection to close or context cancellation
	select {
	case err := <-errCh:
		if err != nil && err != io.EOF {
			log.Printf("Connection error: %v", err)
		}
	case <-connCtx.Done():
		log.Printf("Connection closed due to server shutdown")
	}
}

// splitCommand splits a RESP protocol command into its parts
func splitCommand(command string) []string {
	parts := []string{}
	lines := splitLines(command)

	for i := 0; i < len(lines); i++ {
		// Skip the *n line and the $n lines
		if len(lines[i]) > 0 && (lines[i][0] == '*' || lines[i][0] == '$') {
			continue
		}

		// Add the actual command parts
		if len(lines[i]) > 0 {
			parts = append(parts, lines[i])
		}
	}

	return parts
}

// splitLines splits a string by CRLF
func splitLines(s string) []string {
	return strings.Split(s, "\r\n")
}

// Wait waits for all connections to finish
func (s *Server) Wait() {
	s.connections.Wait()
}
