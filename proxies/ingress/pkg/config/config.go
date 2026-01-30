package config

import (
	"encoding/json"
	"os"
	"time"
)

// PortMapping defines a mapping from a local port to a Kubernetes service
type PortMapping struct {
	// Port is the local port to listen on
	Port int `json:"port"`

	// ServiceName is the Kubernetes service to forward to
	ServiceName string `json:"service_name"`

	// ServiceNamespace is the namespace of the Kubernetes service
	ServiceNamespace string `json:"service_namespace"`

	// ServicePort is the port on the Kubernetes service
	ServicePort int `json:"service_port"`
}

// Config holds the configuration for the Ingress Proxy
type Config struct {
	// IdleTimeout is the duration after which idle connections are closed
	IdleTimeout time.Duration `json:"idle_timeout"`

	// MaxConnections is the maximum number of connections to allow
	MaxConnections int `json:"max_connections"`

	// ConnectionTimeout is the duration after which connections are closed
	ConnectionTimeout time.Duration `json:"connection_timeout"`

	// ReadBufferSize is the size of the read buffer
	ReadBufferSize int `json:"read_buffer_size"`

	// WriteBufferSize is the size of the write buffer
	WriteBufferSize int `json:"write_buffer_size"`

	// ReadTimeout is the maximum duration for reading the entire request
	// ReadTimeout time.Duration `json:"read_timeout"`

	// WriteTimeout is the maximum duration for writing the entire response
	// WriteTimeout time.Duration `json:"write_timeout"`

	// PortMappings defines the TCP port to service mappings
	PortMappings []PortMapping `json:"port_mappings"`
}

// DefaultConfig returns a default configuration
func DefaultConfig() *Config {
	return &Config{
		IdleTimeout:       10 * time.Minute,
		MaxConnections:    1000000,
		ConnectionTimeout: 1 * time.Second,
		ReadBufferSize:    65536,
		WriteBufferSize:   65536,
		// ReadTimeout:       30 * time.Second,
		// WriteTimeout:      30 * time.Second,
		PortMappings: []PortMapping{
			{Port: 80, ServiceName: "web-proxy-service", ServiceNamespace: "system-apps", ServicePort: 80},
			{Port: 443, ServiceName: "web-proxy-service", ServiceNamespace: "system-apps", ServicePort: 443},
			{Port: 3306, ServiceName: "mysql-proxy-service", ServiceNamespace: "system-apps", ServicePort: 3306},
			{Port: 6379, ServiceName: "memory-proxy-service", ServiceNamespace: "system-apps", ServicePort: 6379},
			{Port: 5432, ServiceName: "postgresql-proxy-service", ServiceNamespace: "system-apps", ServicePort: 5432},
		},
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
