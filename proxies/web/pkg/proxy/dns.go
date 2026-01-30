package proxy

import (
	"context"
	"net"
	"sync"
	"time"
)

// dnsEntry represents a cached DNS resolution result
type dnsEntry struct {
	ips      []net.IP
	expireAt time.Time
}

// DNSCache provides a cache for DNS resolutions
type DNSCache struct {
	cache map[string]*dnsEntry
	mutex sync.RWMutex
	ttl   time.Duration
}

// NewDNSCache creates a new DNS cache with the specified TTL
func NewDNSCache(ttl time.Duration) *DNSCache {
	return &DNSCache{
		cache: make(map[string]*dnsEntry),
		ttl:   ttl,
	}
}

// Lookup gets the IP addresses for a hostname, using the cache when possible
func (c *DNSCache) Lookup(hostname string) ([]net.IP, error) {
	// Try to get from cache first
	c.mutex.RLock()
	entry, exists := c.cache[hostname]
	c.mutex.RUnlock()

	// If we have a valid cache entry, return it
	if exists && time.Now().Before(entry.expireAt) {
		return entry.ips, nil
	}

	// Perform actual DNS resolution
	ips, err := net.LookupIP(hostname)
	if err != nil {
		return nil, err
	}

	// Cache the result
	c.mutex.Lock()
	c.cache[hostname] = &dnsEntry{
		ips:      ips,
		expireAt: time.Now().Add(c.ttl),
	}
	c.mutex.Unlock()

	return ips, nil
}

// Cleanup periodically removes expired entries from the cache
func (c *DNSCache) Cleanup(ctx context.Context) {
	ticker := time.NewTicker(c.ttl / 2)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.removeExpiredEntries()
		case <-ctx.Done():
			return
		}
	}
}

// removeExpiredEntries removes expired entries from the cache
func (c *DNSCache) removeExpiredEntries() {
	now := time.Now()

	c.mutex.Lock()
	defer c.mutex.Unlock()

	for hostname, entry := range c.cache {
		if now.After(entry.expireAt) {
			delete(c.cache, hostname)
		}
	}
}
