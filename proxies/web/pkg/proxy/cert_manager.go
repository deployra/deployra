package proxy

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/deployra/deployra/proxies/web/pkg/kubernetes"
	"github.com/deployra/deployra/proxies/web/pkg/redis"
	"github.com/go-acme/lego/v4/certcrypto"
	"github.com/go-acme/lego/v4/certificate"
	"github.com/go-acme/lego/v4/challenge/http01"
	"github.com/go-acme/lego/v4/lego"
	"github.com/go-acme/lego/v4/providers/dns/cloudflare"
	"github.com/go-acme/lego/v4/registration"
)

// User implements the ACME User interface
type User struct {
	Email        string
	Registration *registration.Resource
	key          *ecdsa.PrivateKey
}

func (u *User) GetEmail() string {
	return u.Email
}

func (u *User) GetRegistration() *registration.Resource {
	return u.Registration
}

func (u *User) GetPrivateKey() crypto.PrivateKey {
	return u.key
}

// CertManager handles SSL certificate generation and renewal
type CertManager struct {
	email         string
	acmeServerURL string
	client        *lego.Client
	dnsClient     *lego.Client // Separate client for DNS-01 challenge (wildcard)
	user          *User
	certificates  map[string]*tls.Certificate
	certLock      sync.RWMutex
	httpHandler   http.Handler
	kubeClient    *kubernetes.Client
	redisClient   *redis.Client
	httpProvider  *customHTTP01Provider

	// Wildcard certificate configuration
	wildcardDomain   string           // e.g., "deployra.app"
	wildcardCert     *tls.Certificate // Cached wildcard certificate
	enableWildcard   bool
	wildcardObtainMu sync.Mutex       // Mutex to prevent concurrent wildcard certificate requests
	wildcardObtaining bool            // Flag to indicate if wildcard certificate is being obtained
}

// WildcardConfig holds wildcard certificate configuration
type WildcardConfig struct {
	Enable             bool
	Domain             string // e.g., "deployra.app" for *.deployra.app
	CloudflareAPIToken string
}

// NewCertManager creates a new certificate manager
func NewCertManager(email, acmeServerURL string, kubeClient *kubernetes.Client, redisClient *redis.Client, wildcardCfg *WildcardConfig) (*CertManager, error) {
	// Create user private key
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate private key: %v", err)
	}

	// Create user
	user := &User{
		Email: email,
		key:   privateKey,
	}

	// Create LEGO config for HTTP-01 challenge
	config := lego.NewConfig(user)
	config.CADirURL = acmeServerURL
	config.Certificate.KeyType = certcrypto.EC256

	// Create LEGO client for HTTP-01 challenge
	client, err := lego.NewClient(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create LEGO client: %v", err)
	}

	// Create a custom HTTP provider that doesn't start its own server
	httpProvider := &customHTTP01Provider{
		challengeResponses: make(map[string]string),
	}

	err = client.Challenge.SetHTTP01Provider(httpProvider)
	if err != nil {
		return nil, fmt.Errorf("failed to set HTTP challenge provider: %v", err)
	}

	// Create custom HTTP challenge handler
	challengeHandler := http.FileServer(http.Dir("."))

	// Register user
	reg, err := client.Registration.Register(registration.RegisterOptions{TermsOfServiceAgreed: true})
	if err != nil {
		return nil, fmt.Errorf("failed to register user: %v", err)
	}
	user.Registration = reg

	// Create manager
	manager := &CertManager{
		email:         email,
		acmeServerURL: acmeServerURL,
		client:        client,
		user:          user,
		certificates:  make(map[string]*tls.Certificate),
		httpHandler:   challengeHandler,
		kubeClient:    kubeClient,
		redisClient:   redisClient,
		httpProvider:  httpProvider,
	}

	// Setup wildcard certificate support if enabled
	if wildcardCfg != nil && wildcardCfg.Enable && wildcardCfg.CloudflareAPIToken != "" {
		manager.enableWildcard = true
		manager.wildcardDomain = wildcardCfg.Domain

		// Create separate client for DNS-01 challenge
		dnsClient, err := manager.createDNSClient(wildcardCfg.CloudflareAPIToken)
		if err != nil {
			log.Printf("Warning: Failed to create DNS client for wildcard: %v. Falling back to HTTP-01 only.", err)
			manager.enableWildcard = false
		} else {
			manager.dnsClient = dnsClient
			log.Printf("Wildcard certificate support enabled for *.%s", wildcardCfg.Domain)
		}
	}

	// Load existing certificates
	if err := manager.loadCertificates(); err != nil {
		log.Printf("Failed to load certificates: %v", err)
	}

	// Load wildcard certificate if enabled
	if manager.enableWildcard {
		if err := manager.loadWildcardCertificate(); err != nil {
			log.Printf("Wildcard certificate not found, will obtain on first request: %v", err)
		}
	}

	// Start renewal goroutine
	go manager.startRenewalLoop()

	return manager, nil
}

// createDNSClient creates a LEGO client with Cloudflare DNS-01 provider
func (m *CertManager) createDNSClient(cloudflareAPIToken string) (*lego.Client, error) {
	// Set Cloudflare API token as environment variable (required by lego)
	os.Setenv("CF_DNS_API_TOKEN", cloudflareAPIToken)

	// Create new config for DNS client
	config := lego.NewConfig(m.user)
	config.CADirURL = m.acmeServerURL
	config.Certificate.KeyType = certcrypto.EC256

	// Create LEGO client
	dnsClient, err := lego.NewClient(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create DNS LEGO client: %v", err)
	}

	// Create Cloudflare DNS provider
	cfProvider, err := cloudflare.NewDNSProvider()
	if err != nil {
		return nil, fmt.Errorf("failed to create Cloudflare DNS provider: %v", err)
	}

	// Set DNS-01 challenge provider
	err = dnsClient.Challenge.SetDNS01Provider(cfProvider)
	if err != nil {
		return nil, fmt.Errorf("failed to set DNS challenge provider: %v", err)
	}

	return dnsClient, nil
}

// HTTPChallengeHandler handles ACME HTTP challenge requests
func (m *CertManager) HTTPChallengeHandler(w http.ResponseWriter, r *http.Request) {
	// Check if this is an ACME challenge request
	if strings.HasPrefix(r.URL.Path, "/.well-known/acme-challenge/") {
		// Get the token from the path
		token := strings.TrimPrefix(r.URL.Path, "/.well-known/acme-challenge/")
		challengePath := http01.ChallengePath(token)

		// Look up the key authorization
		m.httpProvider.lock.RLock()
		keyAuth, exists := m.httpProvider.challengeResponses[challengePath]
		m.httpProvider.lock.RUnlock()

		if exists {
			log.Printf("Serving challenge token for path: %s", r.URL.Path)
			w.Header().Set("Content-Type", "text/plain")
			w.Write([]byte(keyAuth))
			return
		}

		// Fall back to file-based challenge if not found in memory
		m.httpHandler.ServeHTTP(w, r)
	} else {
		http.NotFound(w, r)
	}
}

// GetCertificate implements the tls.Config.GetCertificate function
func (m *CertManager) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	domain := hello.ServerName

	// If wildcard is enabled and domain matches, use wildcard certificate
	if m.enableWildcard && m.isWildcardSubdomain(domain) {
		cert, err := m.getWildcardCertificate()
		if err == nil && cert != nil {
			return cert, nil
		}
		log.Printf("Wildcard certificate not available for %s, falling back to individual cert: %v", domain, err)
	}

	// Check for cached certificate in memory
	m.certLock.RLock()
	cert, ok := m.certificates[domain]
	m.certLock.RUnlock()

	if ok {
		// Check if certificate is valid
		if reason := m.isCertificateValidWithReason(cert, domain); reason == "" {
			return cert, nil
		} else {
			log.Printf("Memory cached certificate for %s is invalid: %s", domain, reason)
		}
	}

	// Try to get from Redis cache
	certPEM, keyPEM, err := m.getCertificateFromCache(domain)
	if err == nil && certPEM != "" && keyPEM != "" {
		// Load certificate from cache
		certData, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
		if err == nil {
			cert := &certData
			if reason := m.isCertificateValidWithReason(cert, domain); reason == "" {
				// Store in memory cache
				m.certLock.Lock()
				m.certificates[domain] = cert
				m.certLock.Unlock()
				return cert, nil
			} else {
				log.Printf("Redis cached certificate for %s is invalid: %s", domain, reason)
			}
		}
	}

	// Try to get from Kubernetes secret (fallback before requesting new cert)
	cert, err = m.getCertificateFromKubernetesSecret(domain)
	if err == nil && cert != nil {
		if reason := m.isCertificateValidWithReason(cert, domain); reason == "" {
			// Store in memory cache
			m.certLock.Lock()
			m.certificates[domain] = cert
			m.certLock.Unlock()
			log.Printf("Loaded valid certificate for %s from Kubernetes secret", domain)
			return cert, nil
		} else {
			log.Printf("Kubernetes secret certificate for %s is invalid: %s", domain, reason)
		}
	} else if err != nil {
		log.Printf("No certificate found in Kubernetes secret for %s: %v", domain, err)
	}

	// Obtain/renew certificate (only if not found anywhere or all are invalid)
	log.Printf("Requesting new certificate for %s (no valid certificate found in any cache)", domain)
	if err := m.EnsureCertificate(domain); err != nil {
		return nil, err
	}

	// Get the certificate
	m.certLock.RLock()
	cert = m.certificates[domain]
	m.certLock.RUnlock()

	if cert == nil {
		return nil, fmt.Errorf("certificate not found for domain: %s", domain)
	}

	return cert, nil
}

// isWildcardSubdomain checks if a domain is a subdomain of the wildcard domain
func (m *CertManager) isWildcardSubdomain(domain string) bool {
	if m.wildcardDomain == "" {
		return false
	}
	// Check if domain ends with .wildcardDomain
	// e.g., "app.deployra.app" matches "deployra.app"
	// but "deployra.app" itself does not (wildcard only covers subdomains)
	suffix := "." + m.wildcardDomain
	return strings.HasSuffix(domain, suffix)
}

// getWildcardCertificate returns the wildcard certificate, obtaining it if necessary
func (m *CertManager) getWildcardCertificate() (*tls.Certificate, error) {
	m.certLock.RLock()
	cert := m.wildcardCert
	m.certLock.RUnlock()

	// Check if we have a valid wildcard certificate
	if cert != nil && m.isCertificateValid(cert) {
		return cert, nil
	}

	// Try to load from cache or obtain new one
	if err := m.ensureWildcardCertificate(); err != nil {
		return nil, err
	}

	m.certLock.RLock()
	cert = m.wildcardCert
	m.certLock.RUnlock()

	return cert, nil
}

// loadWildcardCertificate loads the wildcard certificate from Kubernetes secret
func (m *CertManager) loadWildcardCertificate() error {
	wildcardKey := fmt.Sprintf("*.%s", m.wildcardDomain)
	secretName := fmt.Sprintf("cert-wildcard-%s", strings.ReplaceAll(m.wildcardDomain, ".", "-"))

	secret, err := m.kubeClient.GetSecret("system-apps", secretName)
	if err != nil {
		return fmt.Errorf("wildcard certificate secret not found: %v", err)
	}

	certPEM, certOK := secret.Data["cert.pem"]
	keyPEM, keyOK := secret.Data["key.pem"]

	if !certOK || !keyOK {
		return fmt.Errorf("invalid wildcard certificate secret: missing cert.pem or key.pem")
	}

	certData, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return fmt.Errorf("failed to load wildcard certificate: %v", err)
	}

	cert := &certData
	if !m.isCertificateValid(cert) {
		return fmt.Errorf("wildcard certificate is invalid or expired")
	}

	m.certLock.Lock()
	m.wildcardCert = cert
	m.certLock.Unlock()

	// Also cache in Redis
	m.storeCertificateInCache(wildcardKey, string(certPEM), string(keyPEM))

	log.Printf("Loaded wildcard certificate for *.%s", m.wildcardDomain)
	return nil
}

// ensureWildcardCertificate ensures we have a valid wildcard certificate
func (m *CertManager) ensureWildcardCertificate() error {
	wildcardKey := fmt.Sprintf("*.%s", m.wildcardDomain)

	// First try to load from Kubernetes secret (no lock needed for read)
	if err := m.loadWildcardCertificate(); err == nil {
		return nil
	}

	// Try to get from Redis cache
	certPEM, keyPEM, err := m.getCertificateFromCache(wildcardKey)
	if err == nil && certPEM != "" && keyPEM != "" {
		certData, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
		if err == nil {
			cert := &certData
			if m.isCertificateValid(cert) {
				m.certLock.Lock()
				m.wildcardCert = cert
				m.certLock.Unlock()
				log.Printf("Loaded wildcard certificate from Redis cache for *.%s", m.wildcardDomain)
				return nil
			}
		}
	}

	// Acquire lock to prevent concurrent certificate requests
	m.wildcardObtainMu.Lock()

	// Double-check if certificate was obtained while waiting for lock
	m.certLock.RLock()
	if m.wildcardCert != nil && m.isCertificateValid(m.wildcardCert) {
		m.certLock.RUnlock()
		m.wildcardObtainMu.Unlock()
		return nil
	}
	m.certLock.RUnlock()

	// Check if another goroutine is already obtaining the certificate
	if m.wildcardObtaining {
		m.wildcardObtainMu.Unlock()
		return fmt.Errorf("wildcard certificate is being obtained by another request, please retry")
	}

	// Mark that we're obtaining the certificate
	m.wildcardObtaining = true
	m.wildcardObtainMu.Unlock()

	// Ensure we clear the obtaining flag when done
	defer func() {
		m.wildcardObtainMu.Lock()
		m.wildcardObtaining = false
		m.wildcardObtainMu.Unlock()
	}()

	// Need to obtain new wildcard certificate
	if m.dnsClient == nil {
		return fmt.Errorf("DNS client not available for wildcard certificate")
	}

	// Check rate limit
	if m.isRateLimited(wildcardKey) {
		return fmt.Errorf("wildcard domain is rate limited")
	}

	log.Printf("Obtaining wildcard certificate for *.%s", m.wildcardDomain)

	// Request wildcard certificate (need both wildcard and base domain)
	request := certificate.ObtainRequest{
		Domains: []string{
			fmt.Sprintf("*.%s", m.wildcardDomain),
			m.wildcardDomain, // Include base domain too
		},
		Bundle: true,
	}

	certificates, err := m.dnsClient.Certificate.Obtain(request)
	if err != nil {
		if strings.Contains(err.Error(), "urn:ietf:params:acme:error:rateLimited") {
			retryAfterStr := extractRetryAfter(err.Error())
			m.setRateLimitCooldown(wildcardKey, retryAfterStr)
			log.Printf("Rate limit hit for wildcard domain: %v", err)
		}
		return fmt.Errorf("failed to obtain wildcard certificate: %v", err)
	}

	// Load certificate
	certData, err := tls.X509KeyPair(certificates.Certificate, certificates.PrivateKey)
	if err != nil {
		return fmt.Errorf("failed to load wildcard certificate: %v", err)
	}

	// Store in memory
	m.certLock.Lock()
	m.wildcardCert = &certData
	m.certLock.Unlock()

	// Store in Kubernetes secret
	secretName := fmt.Sprintf("cert-wildcard-%s", strings.ReplaceAll(m.wildcardDomain, ".", "-"))
	secretData := map[string][]byte{
		"cert.pem": certificates.Certificate,
		"key.pem":  certificates.PrivateKey,
	}

	err = m.kubeClient.CreateOrUpdateSecret("system-apps", secretName, secretData)
	if err != nil {
		log.Printf("Failed to store wildcard certificate in Kubernetes: %v", err)
	}

	// Store in Redis cache
	m.storeCertificateInCache(wildcardKey, string(certificates.Certificate), string(certificates.PrivateKey))

	log.Printf("Wildcard certificate obtained for *.%s", m.wildcardDomain)
	return nil
}

// getCertificateFromKubernetesSecret retrieves a certificate from Kubernetes secret
func (m *CertManager) getCertificateFromKubernetesSecret(domain string) (*tls.Certificate, error) {
	secretName := fmt.Sprintf("cert-%s", strings.ReplaceAll(domain, ".", "-"))

	secret, err := m.kubeClient.GetSecret("system-apps", secretName)
	if err != nil {
		return nil, err
	}

	certPEM, certOK := secret.Data["cert.pem"]
	keyPEM, keyOK := secret.Data["key.pem"]

	if !certOK || !keyOK {
		return nil, fmt.Errorf("invalid certificate secret for %s: missing cert.pem or key.pem", domain)
	}

	certData, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to load certificate for %s: %v", domain, err)
	}

	// Update Redis cache with the certificate from K8s
	m.storeCertificateInCache(domain, string(certPEM), string(keyPEM))

	return &certData, nil
}

// EnsureCertificate makes sure a certificate exists for the given domain
func (m *CertManager) EnsureCertificate(domain string) error {
	// Check if we already have a valid certificate
	m.certLock.RLock()
	cert, ok := m.certificates[domain]
	m.certLock.RUnlock()

	if ok && m.isCertificateValid(cert) {
		return nil
	}

	// Check if domain is in rate limit cooldown
	if m.isRateLimited(domain) {
		log.Printf("Domain %s is currently rate limited, skipping certificate request", domain)
		return fmt.Errorf("domain %s is rate limited", domain)
	}

	log.Printf("Obtaining certificate for %s", domain)

	// Request certificate
	request := certificate.ObtainRequest{
		Domains: []string{domain},
		Bundle:  true,
	}

	certificates, err := m.client.Certificate.Obtain(request)
	if err != nil {
		// Check if this is a rate limit error
		if strings.Contains(err.Error(), "urn:ietf:params:acme:error:rateLimited") {
			// Extract retry time if available
			retryAfterStr := extractRetryAfter(err.Error())
			m.setRateLimitCooldown(domain, retryAfterStr)
			log.Printf("Rate limit hit for domain %s: %v", domain, err)
			return fmt.Errorf("rate limited: %v", err)
		}
		return fmt.Errorf("failed to obtain certificate: %v", err)
	}

	// Load certificate
	certData, err := tls.X509KeyPair(certificates.Certificate, certificates.PrivateKey)
	if err != nil {
		return fmt.Errorf("failed to load certificate: %v", err)
	}

	// Store certificate in memory
	m.certLock.Lock()
	m.certificates[domain] = &certData
	m.certLock.Unlock()

	// Store certificate in Kubernetes secret
	secretName := fmt.Sprintf("cert-%s", strings.ReplaceAll(domain, ".", "-"))
	secretData := map[string][]byte{
		"cert.pem": certificates.Certificate,
		"key.pem":  certificates.PrivateKey,
	}

	err = m.kubeClient.CreateOrUpdateSecret("system-apps", secretName, secretData)
	if err != nil {
		log.Printf("Failed to store certificate in Kubernetes: %v", err)
	}

	// Store certificate in Redis cache
	m.storeCertificateInCache(domain, string(certificates.Certificate), string(certificates.PrivateKey))

	log.Printf("Certificate obtained for %s", domain)
	return nil
}

// loadCertificates loads existing certificates from Kubernetes secrets
func (m *CertManager) loadCertificates() error {
	// List all certificate secrets
	secrets, err := m.kubeClient.ListSecrets("system-apps", "type=certificate")
	if err != nil {
		return fmt.Errorf("failed to list certificate secrets: %v", err)
	}

	// Process certificate secrets
	for _, secret := range secrets {
		// Extract domain from secret name
		secretName := secret.Name
		if !strings.HasPrefix(secretName, "cert-") {
			continue
		}

		domainDashed := strings.TrimPrefix(secretName, "cert-")
		domain := strings.ReplaceAll(domainDashed, "-", ".")

		certPEM, certOK := secret.Data["cert.pem"]
		keyPEM, keyOK := secret.Data["key.pem"]

		if !certOK || !keyOK {
			log.Printf("Invalid certificate secret for %s: missing cert.pem or key.pem", domain)
			continue
		}

		// Load certificate
		certData, err := tls.X509KeyPair(certPEM, keyPEM)
		if err != nil {
			log.Printf("Failed to load certificate for %s: %v", domain, err)
			continue
		}

		// Create a pointer to the certificate
		cert := &certData

		// Check if certificate is valid
		if m.isCertificateValid(cert) {
			log.Printf("Loaded certificate for %s", domain)
			m.certLock.Lock()
			m.certificates[domain] = cert
			m.certLock.Unlock()

			// Store in Redis cache
			m.storeCertificateInCache(domain, string(certPEM), string(keyPEM))
		} else {
			log.Printf("Certificate for %s is invalid or nearing expiration", domain)
		}
	}

	log.Printf("Loaded %d certificates", len(m.certificates))
	return nil
}

// isCertificateValid checks if a certificate is valid and not nearing expiration
func (m *CertManager) isCertificateValid(cert *tls.Certificate) bool {
	return m.isCertificateValidWithReason(cert, "") == ""
}

// isCertificateValidWithReason checks certificate validity and returns the reason if invalid
// Returns empty string if valid, otherwise returns the reason for invalidity
func (m *CertManager) isCertificateValidWithReason(cert *tls.Certificate, domain string) string {
	if cert == nil {
		return "certificate is nil"
	}

	if len(cert.Certificate) == 0 {
		return "certificate chain is empty"
	}

	// Parse certificate
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return fmt.Sprintf("failed to parse certificate: %v", err)
	}

	now := time.Now()

	// Check if already expired
	if now.After(leaf.NotAfter) {
		if domain != "" {
			log.Printf("Certificate for %s has EXPIRED on %s", domain, leaf.NotAfter.Format("2006-01-02 15:04:05"))
		}
		return fmt.Sprintf("certificate expired on %s", leaf.NotAfter.Format("2006-01-02 15:04:05"))
	}

	// Check if expiring within 30 days
	expiryThreshold := leaf.NotAfter.Add(-30 * 24 * time.Hour)
	if now.After(expiryThreshold) {
		daysLeft := int(leaf.NotAfter.Sub(now).Hours() / 24)
		if domain != "" {
			log.Printf("Certificate for %s is expiring soon (%d days left, expires on %s)", domain, daysLeft, leaf.NotAfter.Format("2006-01-02"))
		}
		return fmt.Sprintf("certificate expiring in %d days (on %s)", daysLeft, leaf.NotAfter.Format("2006-01-02"))
	}

	return "" // Valid
}

// startRenewalLoop starts a loop to periodically check for certificates that need renewal
func (m *CertManager) startRenewalLoop() {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		log.Println("Checking certificates for renewal...")
		m.renewCertificates()
	}
}

// renewCertificates renews certificates that are nearing expiration
func (m *CertManager) renewCertificates() {
	// Renew wildcard certificate if enabled and needed
	if m.enableWildcard {
		m.certLock.RLock()
		wildcardCert := m.wildcardCert
		m.certLock.RUnlock()

		if wildcardCert == nil || !m.isCertificateValid(wildcardCert) {
			log.Printf("Renewing wildcard certificate for *.%s", m.wildcardDomain)
			// Clear the cached cert to force re-obtain
			m.certLock.Lock()
			m.wildcardCert = nil
			m.certLock.Unlock()

			if err := m.ensureWildcardCertificate(); err != nil {
				log.Printf("Failed to renew wildcard certificate: %v", err)
			} else {
				log.Printf("Wildcard certificate renewed for *.%s", m.wildcardDomain)
			}
		}
	}

	// Get individual certificates to renew
	m.certLock.RLock()
	domains := make([]string, 0, len(m.certificates))
	for domain, cert := range m.certificates {
		if !m.isCertificateValid(cert) {
			domains = append(domains, domain)
		}
	}
	m.certLock.RUnlock()

	// Renew individual certificates
	for _, domain := range domains {
		// Skip if this domain can use wildcard
		if m.enableWildcard && m.isWildcardSubdomain(domain) {
			log.Printf("Skipping renewal for %s (covered by wildcard)", domain)
			continue
		}

		log.Printf("Renewing certificate for %s", domain)
		if err := m.EnsureCertificate(domain); err != nil {
			log.Printf("Failed to renew certificate for %s: %v", domain, err)
		} else {
			log.Printf("Certificate renewed for %s", domain)
		}
	}
}

// getCertificateFromCache retrieves a certificate from Redis cache
func (m *CertManager) getCertificateFromCache(domain string) (string, string, error) {
	certKey := fmt.Sprintf("cert:%s:cert", domain)
	keyKey := fmt.Sprintf("cert:%s:key", domain)

	certPEM, err := m.redisClient.GetString(certKey)
	if err != nil {
		return "", "", err
	}

	keyPEM, err := m.redisClient.GetString(keyKey)
	if err != nil {
		return "", "", err
	}

	return certPEM, keyPEM, nil
}

// storeCertificateInCache stores a certificate in Redis cache
func (m *CertManager) storeCertificateInCache(domain, certPEM, keyPEM string) {
	certKey := fmt.Sprintf("cert:%s:cert", domain)
	keyKey := fmt.Sprintf("cert:%s:key", domain)

	// Cache with TTL of 85 days (Let's Encrypt certificates are valid for 90 days)
	// This ensures the cache doesn't expire before the certificate needs renewal
	ttl := 85 * 24 * time.Hour

	if err := m.redisClient.SetString(certKey, certPEM, ttl); err != nil {
		log.Printf("Failed to cache certificate for %s: %v", domain, err)
	}

	if err := m.redisClient.SetString(keyKey, keyPEM, ttl); err != nil {
		log.Printf("Failed to cache certificate key for %s: %v", domain, err)
	}
}

// isRateLimited checks if a domain is currently rate limited
func (m *CertManager) isRateLimited(domain string) bool {
	key := fmt.Sprintf("cert:%s:ratelimit", domain)

	// Check if rate limit key exists in Redis
	exists, err := m.redisClient.Exists(key)
	if err != nil {
		log.Printf("Error checking rate limit status: %v", err)
		return false
	}

	return exists
}

// setRateLimitCooldown marks a domain as rate limited with a cooldown period
func (m *CertManager) setRateLimitCooldown(domain, retryAfterStr string) {
	key := fmt.Sprintf("cert:%s:ratelimit", domain)

	// Default cooldown of 1 hour if we can't parse the retry time
	cooldown := 1 * time.Hour

	// Try to parse the retry time from the error message
	if retryAfterStr != "" {
		retryTime, err := time.Parse("2006-01-02 15:04:05 MST", retryAfterStr)
		if err == nil {
			// Calculate duration until retry time
			now := time.Now()
			if retryTime.After(now) {
				cooldown = retryTime.Sub(now)
			}
		}
	}

	// Store rate limit status in Redis with appropriate TTL
	if err := m.redisClient.SetString(key, "rate_limited", cooldown); err != nil {
		log.Printf("Failed to set rate limit status for %s: %v", domain, err)
	}

	log.Printf("Domain %s set as rate limited for %v", domain, cooldown)
}

// extractRetryAfter extracts the retry after time from a rate limit error message
func extractRetryAfter(errMsg string) string {
	// Example: "retry after 2025-04-14 23:30:12 UTC"
	retryAfterIndex := strings.Index(errMsg, "retry after ")
	if retryAfterIndex == -1 {
		return ""
	}

	// Extract the date part
	retryAfterStr := errMsg[retryAfterIndex+len("retry after "):]

	// Find the end of the date (usually before a colon or end of string)
	endIndex := strings.Index(retryAfterStr, ":")
	if endIndex != -1 {
		// Include the time part
		endIndex = strings.Index(retryAfterStr[endIndex+1:], ":")
		if endIndex != -1 {
			// Include seconds
			secondsEndIndex := strings.Index(retryAfterStr[endIndex+1:], " ")
			if secondsEndIndex != -1 {
				endIndex += secondsEndIndex + 2 // +1 for the previous slice, +1 for the space
			} else {
				endIndex = len(retryAfterStr)
			}
		} else {
			endIndex = len(retryAfterStr)
		}
	} else {
		endIndex = len(retryAfterStr)
	}

	return strings.TrimSpace(retryAfterStr[:endIndex])
}

// Add custom HTTP01 provider that doesn't start its own server
type customHTTP01Provider struct {
	challengeResponses map[string]string
	lock               sync.RWMutex
}

func (p *customHTTP01Provider) Present(domain, token, keyAuth string) error {
	p.lock.Lock()
	defer p.lock.Unlock()

	challengePath := http01.ChallengePath(token)
	p.challengeResponses[challengePath] = keyAuth
	log.Printf("Challenge token stored for %s", domain)
	return nil
}

func (p *customHTTP01Provider) CleanUp(domain, token, keyAuth string) error {
	p.lock.Lock()
	defer p.lock.Unlock()

	challengePath := http01.ChallengePath(token)
	delete(p.challengeResponses, challengePath)
	log.Printf("Challenge token cleaned for %s", domain)
	return nil
}
