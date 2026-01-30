package proxy

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"strings"
	"sync"
	"time"

	"github.com/deployra/deployra/proxies/web/pkg/config"
	"github.com/deployra/deployra/proxies/web/pkg/kubernetes"
	"github.com/deployra/deployra/proxies/web/pkg/redis"
)

// Server represents the proxy server
type Server struct {
	config       *config.Config
	kubeClient   *kubernetes.Client
	redisClient  *redis.Client
	httpServer   *http.Server
	httpsServer  *http.Server
	certManager  *CertManager
	services     map[string]*kubernetes.ServiceInfo
	routingTable map[string]string
	routingLock  sync.RWMutex
	redirects    map[string]string
	logger       *AccessLogger
	dnsCache     *DNSCache // Cache for DNS resolutions
}

// NewServer creates a new proxy server
func NewServer(cfg *config.Config) (*Server, error) {
	// Create Kubernetes client
	kubeClient, err := kubernetes.NewClient(cfg.KubeConfigPath, cfg.LabelSelector)
	if err != nil {
		return nil, fmt.Errorf("failed to create Kubernetes client: %v", err)
	}

	// Create Redis client for scale-to-zero functionality
	redisClient, err := redis.NewClient(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		return nil, fmt.Errorf("failed to create Redis client: %v", err)
	}

	// Create certificate manager if HTTPS is enabled
	var certManager *CertManager
	if cfg.EnableHTTPS {
		// Setup wildcard configuration if enabled
		var wildcardCfg *WildcardConfig
		if cfg.EnableWildcard && cfg.WildcardDomain != "" && cfg.CloudflareAPIToken != "" {
			wildcardCfg = &WildcardConfig{
				Enable:             cfg.EnableWildcard,
				Domain:             cfg.WildcardDomain,
				CloudflareAPIToken: cfg.CloudflareAPIToken,
			}
			log.Printf("Wildcard certificate enabled for *.%s", cfg.WildcardDomain)
		}

		certManager, err = NewCertManager(cfg.Email, cfg.AcmeServerURL, kubeClient, redisClient, wildcardCfg)
		if err != nil {
			return nil, fmt.Errorf("failed to create certificate manager: %v", err)
		}
	}

	// Create server instance
	server := &Server{
		config:       cfg,
		kubeClient:   kubeClient,
		redisClient:  redisClient,
		certManager:  certManager,
		services:     make(map[string]*kubernetes.ServiceInfo),
		routingTable: make(map[string]string),
		logger:       NewAccessLogger(),
		dnsCache:     NewDNSCache(5 * time.Minute), // 5-minute TTL for DNS cache entries
		redirects:    make(map[string]string),
	}

	log.Printf("Web proxy initialized with DNS cache (5-minute TTL)")

	// Create HTTP server with websocket-compatible timeouts
	server.httpServer = &http.Server{
		Addr:         cfg.HTTPAddr,
		Handler:      server.httpHandler(),
		ReadTimeout:  time.Duration(cfg.WebSocketReadTimeout) * time.Second,  // Use longer timeout for WebSocket compatibility
		WriteTimeout: time.Duration(cfg.WebSocketWriteTimeout) * time.Second, // Use longer timeout for WebSocket compatibility
		IdleTimeout:  time.Duration(cfg.WebSocketReadTimeout) * time.Second,  // Keep connections alive longer
	}

	// Create HTTPS server if HTTPS is enabled
	if cfg.EnableHTTPS {
		server.httpsServer = &http.Server{
			Addr:         cfg.HTTPSAddr,
			Handler:      server.httpsHandler(),
			ReadTimeout:  time.Duration(cfg.WebSocketReadTimeout) * time.Second,  // Use longer timeout for WebSocket compatibility
			WriteTimeout: time.Duration(cfg.WebSocketWriteTimeout) * time.Second, // Use longer timeout for WebSocket compatibility
			IdleTimeout:  time.Duration(cfg.WebSocketReadTimeout) * time.Second,  // Keep connections alive longer
			TLSConfig: &tls.Config{
				GetCertificate: server.GetCertificate,
			},
		}
	}

	return server, nil
}

// GetCertificate implements the tls.Config.GetCertificate function
func (s *Server) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	// If HTTPS is not enabled, return an error
	if !s.config.EnableHTTPS {
		return nil, fmt.Errorf("HTTPS is disabled in configuration")
	}

	// Check redirect found
	redirectDomain, redirectFound := s.redirects[strings.ToLower(hello.ServerName)]
	if redirectFound {
		// Use the redirect domain to look up certificate
		log.Printf("Using %s certificate for %s", redirectDomain, hello.ServerName)
		return s.certManager.GetCertificate(hello)
	}

	// For all other domains, check if in routing table
	s.routingLock.RLock()
	_, exists := s.routingTable[hello.ServerName]
	s.routingLock.RUnlock()

	if !exists {
		return nil, fmt.Errorf("domain not managed by this proxy: %s", hello.ServerName)
	}

	return s.certManager.GetCertificate(hello)
}

// Start starts the proxy server
func (s *Server) Start(ctx context.Context) error {
	// Start Kubernetes watcher
	if err := s.kubeClient.StartWatching(s.handleServicesChanged); err != nil {
		log.Printf("Warning: Failed to start Kubernetes watcher: %v", err)
	} else {
		log.Println("Started Kubernetes service watcher")
	}

	// Start DNS cache cleanup in background
	go s.dnsCache.Cleanup(ctx)

	// Start HTTP server
	go func() {
		log.Printf("Starting HTTP server on %s", s.config.HTTPAddr)
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("HTTP server error: %v", err)
		}
	}()

	// Start HTTPS server if enabled
	if s.config.EnableHTTPS {
		go func() {
			log.Printf("Starting HTTPS server on %s", s.config.HTTPSAddr)
			if err := s.httpsServer.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
				log.Printf("HTTPS server error: %v", err)
			}
		}()
	} else {
		log.Println("HTTPS server is disabled by configuration")
	}

	// Wait for context cancellation to stop servers
	<-ctx.Done()
	log.Println("Shutting down servers...")

	// Stop Kubernetes watcher
	s.kubeClient.StopWatching()

	// Create shutdown context with timeout
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Shutdown servers
	if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	// Shutdown HTTPS server if it was enabled
	if s.config.EnableHTTPS && s.httpsServer != nil {
		if err := s.httpsServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("HTTPS server shutdown error: %v", err)
		}
	}

	// Close the Redis client
	if err := s.redisClient.Close(); err != nil {
		log.Printf("Redis client close error: %v", err)
	}

	return nil
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
			for _, domain := range info.Domains {
				s.routingTable[domain] = serviceKey
			}
		} else {
			log.Printf("Warning: Received nil ServiceInfo for Add action on service %s", serviceKey)
		}
	} else if action == kubernetes.Delete {
		if s.services != nil {
			delete(s.services, serviceKey)
		}

		// When deleting a service, info might be nil
		// Get the domains from the existing service info before deleting
		var domains []string
		if existingInfo, exists := s.services[serviceKey]; exists && existingInfo != nil {
			domains = existingInfo.Domains
		} else if info != nil {
			domains = info.Domains
		}

		// Delete routing table entries for all domains
		if s.routingTable != nil && len(domains) > 0 {
			for _, domain := range domains {
				delete(s.routingTable, domain)
			}
		}
	}

	s.routingLock.Unlock()
}

// httpHandler returns the HTTP handler for HTTP requests
func (s *Server) httpHandler() http.Handler {
	mux := http.NewServeMux()

	// Add health check endpoint
	mux.HandleFunc("/healthz", s.logger.WrapHandlerFunc("healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))

	// If HTTPS is enabled, handle ACME challenges and redirect to HTTPS
	if s.config.EnableHTTPS {
		// Handle ACME HTTP-01 challenge
		mux.HandleFunc("/.well-known/acme-challenge/", s.certManager.HTTPChallengeHandler)

		// Redirect other requests to HTTPS
		mux.HandleFunc("/", s.logger.WrapHandlerFunc("https-redirect", func(w http.ResponseWriter, r *http.Request) {
			host := r.Host
			target := "https://" + host + r.URL.Path
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusMovedPermanently)
		}))
	} else {
		// If HTTPS is disabled, handle all requests with the proxy handler directly
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			s.handleProxyRequest(w, r)
		})
	}

	return s.logger.Middleware(mux)
}

// httpsHandler returns the HTTPS handler
func (s *Server) httpsHandler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		s.handleProxyRequest(w, r)
	})

	return s.logger.Middleware(mux)
}

// handleProxyRequest handles proxying a request to the appropriate backend service
func (s *Server) handleProxyRequest(w http.ResponseWriter, r *http.Request) {
	// Start timer for request tracking
	start := time.Now()

	// Check redirect found
	redirectDomain, redirectFound := s.redirects[strings.ToLower(r.Host)]
	if redirectFound {
		targetURL := fmt.Sprintf("https://%s%s", redirectDomain, "/")
		log.Printf("301 Redirecting HTTP %s to %s", r.Host, targetURL)
		http.Redirect(w, r, targetURL, http.StatusMovedPermanently) // 301 redirect

		// Log the redirection
		duration := time.Since(start)
		s.logger.LogRequest(w, r, duration, "redirect")
		return
	}

	// Create a logging response writer
	lrw := NewLogResponseWriter(w)
	w = lrw

	// Store the host for later use
	host := r.Host

	var routingService *kubernetes.ServiceInfo

	// Find target service from the routing table
	s.routingLock.RLock()
	serviceKey, exists := s.routingTable[host]
	if exists {
		routingService = s.services[serviceKey]
	}
	s.routingLock.RUnlock()

	if !exists || routingService == nil {
		http.Error(w, "Service not found", http.StatusNotFound)
		return
	}
	deploymentName := routingService.ServiceID + "-deployment"

	// If service has ScaleToZero=true label and is scaled to zero, scale it up
	if routingService.ScaleToZeroEnabled {
		// Check if deployment is marked as being in CrashLoopBackOff
		inCrashLoop, err := s.redisClient.IsDeploymentInCrashLoop(routingService.Namespace, deploymentName)
		if err != nil {
			log.Printf("Error checking crashloop status in Redis: %v", err)
		}

		// If in crashloop, don't scale up automatically
		if inCrashLoop {
			log.Printf("Deployment %s/%s is marked as CrashLoopBackOff, not scaling up", routingService.Namespace, deploymentName)
			http.Error(w, "Service is currently unavailable due to errors. Please contact support.", http.StatusServiceUnavailable)

			// Log the crashloop error
			duration := time.Since(start)
			s.logger.LogRequest(w, r, duration, "crashloop-blocked")
			return
		}

		// Check if we have the deployment status cached in Redis first
		exists, isActive, err := s.redisClient.GetDeploymentStatus(routingService.Namespace, deploymentName)
		if err != nil {
			log.Printf("Error checking deployment status in Redis: %v", err)
		}

		// If not in Redis or shows inactive, check with Kubernetes and cache the result
		if !exists || !isActive {
			isDeploymentReady := s.kubeClient.IsDeploymentReady(routingService.Namespace, deploymentName)

			if !isDeploymentReady {
				log.Printf("Scaling up service %s/%s from zero", routingService.Namespace, deploymentName)

				err := s.kubeClient.ScaleUpDeployment(routingService.Namespace, deploymentName, 1)
				if err != nil {
					log.Printf("Error scaling up deployment: %v", err)
					http.Error(w, "Service is currently scaling up, please try again in a moment", http.StatusServiceUnavailable)

					// Log the scaling up error
					duration := time.Since(start)
					s.logger.LogRequest(w, r, duration, "scaling-up")
					return
				}

				// Wait for the service to be ready
				log.Printf("Waiting for service %s/%s to be ready", routingService.Namespace, deploymentName)

				// Simple polling mechanism to check if service is ready
				ready := false
				for i := 0; i < 30; i++ { // Try for up to 30 seconds
					if s.kubeClient.IsDeploymentReady(routingService.Namespace, deploymentName) {
						ready = true
						break
					}
					time.Sleep(1 * time.Second)
				}

				if !ready {
					log.Printf("Service %s/%s is not ready after waiting", routingService.Namespace, deploymentName)
					http.Error(w, "Service is starting up, please try again in a moment", http.StatusServiceUnavailable)

					// Log the startup error
					duration := time.Since(start)
					s.logger.LogRequest(w, r, duration, "starting-up")
					return
				}

				// Update the deployment status in Redis
				if err := s.redisClient.SetDeploymentStatus(routingService.Namespace, deploymentName, true); err != nil {
					log.Printf("Error setting deployment status in Redis: %v", err)
				}

				log.Printf("Service %s/%s is now ready", routingService.Namespace, deploymentName)
			} else {
				log.Printf("Service %s/%s is already ready", routingService.Namespace, deploymentName)
				// Update the deployment status in Redis
				if err := s.redisClient.SetDeploymentStatus(routingService.Namespace, deploymentName, true); err != nil {
					log.Printf("Error setting deployment status in Redis: %v", err)
				}
			}
		}
	}

	// Record service access time in Redis
	s.redisClient.RecordServiceAccess(routingService.Namespace, deploymentName)

	// Proxy the request to the target service using Kubernetes service discovery
	// Format: <service-name>.<namespace>.svc.cluster.local
	serviceDNS := fmt.Sprintf("%s.%s.svc.cluster.local", routingService.Name, routingService.Namespace)

	// Use DNS cache to resolve the hostname
	ips, err := s.dnsCache.Lookup(serviceDNS)
	if err != nil {
		log.Printf("Failed to resolve service DNS %s: %v", serviceDNS, err)
		http.Error(w, "Service unavailable", http.StatusServiceUnavailable)

		// Log the DNS resolution error
		duration := time.Since(start)
		s.logger.LogRequest(w, r, duration, "dns-error")
		return
	}

	// No IPs found
	if len(ips) == 0 {
		log.Printf("No IP addresses found for service %s", serviceDNS)
		http.Error(w, "Service unavailable", http.StatusServiceUnavailable)

		// Log the DNS resolution error
		duration := time.Since(start)
		s.logger.LogRequest(w, r, duration, "no-ips")
		return
	}

	// Use the first IP address
	serviceIP := ips[0].String()
	target := fmt.Sprintf("http://%s:%d", serviceIP, routingService.Port)
	upstream := fmt.Sprintf("%s:%d", serviceIP, routingService.Port)
	log.Printf("Proxying request to %s -> %s", host, target)

	// Create proxy director function that preserves original headers for WebSocket
	director := func(req *http.Request) {
		req.URL.Scheme = "http"
		req.URL.Host = upstream

		// Preserve original request headers that are important for WebSockets
		// Check if this is a WebSocket request
		if isWebSocket := isWebSocketRequest(req); isWebSocket {
			log.Printf("Setting up WebSocket headers for proxying to %s", upstream)

			// Ensure proper Connection header for WebSocket upgrade
			connection := req.Header.Get("Connection")
			if connection != "" {
				// Ensure Connection header contains "upgrade" (case-insensitive)
				connectionLower := strings.ToLower(connection)
				if !strings.Contains(connectionLower, "upgrade") {
					// Add upgrade to existing connection values
					req.Header.Set("Connection", connection+", upgrade")
				}
				// Keep the Connection header as-is if it already contains upgrade
			} else {
				// Set default Connection header for WebSocket
				req.Header.Set("Connection", "upgrade")
			}

			// Ensure Upgrade header is set to websocket
			upgrade := req.Header.Get("Upgrade")
			if upgrade == "" {
				req.Header.Set("Upgrade", "websocket")
			}

			// Preserve Origin header which is important for CORS
			if origin := req.Header.Get("Origin"); origin != "" {
				req.Header.Set("Origin", origin)
			}

			// Preserve all WebSocket-specific headers without modification
			// These headers are critical for the handshake and should not be altered
			wsHeaders := []string{
				"Sec-WebSocket-Key",
				"Sec-WebSocket-Version",
				"Sec-WebSocket-Extensions",
				"Sec-WebSocket-Protocol",
			}

			for _, header := range wsHeaders {
				if value := req.Header.Get(header); value != "" {
					req.Header.Set(header, value)
				}
			}
		}

		// Set the original host header
		req.Host = host
	}

	// Special handling for WebSocket connections
	isWebSocket := isWebSocketRequest(r)
	if isWebSocket {
		log.Printf("Detected WebSocket connection for %s, using enhanced transport settings", host)
	}

	// Create enhanced websocket transport with appropriate timeout settings for WebSocket connections
	var transport http.RoundTripper
	if isWebSocket {
		transport = &http.Transport{
			ResponseHeaderTimeout: time.Duration(s.config.WebSocketReadTimeout) * time.Second,
			IdleConnTimeout:       time.Duration(s.config.WebSocketReadTimeout) * time.Second,
			MaxIdleConnsPerHost:   100,              // Allow more idle connections per host
			MaxIdleConns:          1000,             // Allow more total idle connections
			TLSHandshakeTimeout:   10 * time.Second, // Reasonable timeout for TLS handshake
			ExpectContinueTimeout: 1 * time.Second,  // Timeout for 100-continue responses
			DisableCompression:    true,             // Disable compression for WebSockets
			DialContext: (&net.Dialer{
				Timeout:   30 * time.Second, // Connection timeout
				KeepAlive: 30 * time.Second, // TCP keepalive interval
			}).DialContext,
		}
	}

	proxy := &httputil.ReverseProxy{
		Director:  director,
		Transport: transport, // Set transport during initialization
		ModifyResponse: func(resp *http.Response) error {
			// For WebSocket upgrade responses, ensure headers are preserved
			if resp.StatusCode == http.StatusSwitchingProtocols {
				log.Printf("Handling WebSocket upgrade response")
			}
			return nil
		},
		ErrorHandler: func(rw http.ResponseWriter, req *http.Request, err error) {
			log.Printf("Proxy error: %v", err)
			rw.WriteHeader(http.StatusBadGateway)
		},
	}

	// Track the proxy completion time
	proxy.ServeHTTP(w, r)

	// Log the request with the specific upstream
	duration := time.Since(start)
	s.logger.LogRequest(w, r, duration, upstream)
}

// isWebSocketRequest checks if the request is a WebSocket handshake request
func isWebSocketRequest(r *http.Request) bool {
	// Check for the WebSocket protocol upgrade headers
	connection := strings.ToLower(r.Header.Get("Connection"))
	upgrade := strings.ToLower(r.Header.Get("Upgrade"))

	containsWebSocket := strings.Contains(connection, "upgrade") && strings.Contains(upgrade, "websocket")

	// Also check for socket.io specific path patterns
	isSocketIO := strings.Contains(r.URL.Path, "/socket.io/") && (strings.Contains(r.URL.Path, "/websocket") ||
		strings.Contains(r.URL.RawQuery, "transport=websocket") ||
		strings.Contains(r.URL.RawQuery, "transport=polling"))

	// Return true if either condition is met
	return containsWebSocket || isSocketIO
}
