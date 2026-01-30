package config

import (
	"encoding/json"
	"os"
)

// Config represents the application configuration
type Config struct {
	// HTTP server configuration
	HTTPAddr    string `json:"http_addr"`
	HTTPSAddr   string `json:"https_addr"`
	EnableHTTPS bool   `json:"enable_https"`

	// ACME (Let's Encrypt) configuration
	Email         string `json:"email"`
	AcmeServerURL string `json:"acme_server_url"`

	// Wildcard certificate configuration
	WildcardDomain     string `json:"wildcard_domain"`      // e.g., "deployra.app" for *.deployra.app
	CloudflareAPIToken string `json:"cloudflare_api_token"` // Cloudflare API token with DNS edit permissions
	EnableWildcard     bool   `json:"enable_wildcard"`      // Enable wildcard certificate

	// Kubernetes configuration
	KubeConfigPath string `json:"kube_config_path"`
	LabelSelector  string `json:"label_selector"`

	// Proxy settings
	ProxyReadTimeout      int `json:"proxy_read_timeout"`
	ProxyWriteTimeout     int `json:"proxy_write_timeout"`
	WebSocketReadTimeout  int `json:"websocket_read_timeout"`
	WebSocketWriteTimeout int `json:"websocket_write_timeout"`

	// Redis configuration for scale-to-zero feature
	RedisAddr     string `json:"redis_addr"`
	RedisPassword string `json:"redis_password"`
	RedisDB       int    `json:"redis_db"`

	// Scale-to-zero configuration
	IdleTimeoutMinutes   int `json:"idle_timeout_minutes"`
	CheckIntervalSeconds int `json:"check_interval_seconds"`
}

// DefaultConfig returns a default configuration
func DefaultConfig() *Config {
	return &Config{
		HTTPAddr:              ":80",
		HTTPSAddr:             ":443",
		EnableHTTPS:           true,
		AcmeServerURL:         "https://acme-v02.api.letsencrypt.org/directory",
		LabelSelector:         "managedBy=kubestrator,type=web",
		RedisAddr:             "redis:6379",
		RedisPassword:         "",
		RedisDB:               0,
		IdleTimeoutMinutes:    10, // Default 30 minutes for scale-to-zero
		CheckIntervalSeconds:  60, // Check every 60 seconds
		ProxyReadTimeout:      30,
		ProxyWriteTimeout:     30,
		WebSocketReadTimeout:  3600, // 1 hour for websockets
		WebSocketWriteTimeout: 3600, // 1 hour for websockets
		WildcardDomain:        "",
		CloudflareAPIToken:    "",
		EnableWildcard:        true,
	}
}

// Load loads configuration from file
func Load(configPath string) (*Config, error) {
	config := DefaultConfig()

	// If config path is provided, load from file
	if configPath != "" {
		file, err := os.Open(configPath)
		if err != nil {
			return nil, err
		}
		defer file.Close()

		decoder := json.NewDecoder(file)
		if err := decoder.Decode(config); err != nil {
			return nil, err
		}
	}

	return config, nil
}
