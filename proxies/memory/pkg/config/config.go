package config

import (
	"encoding/json"
	"os"
	"time"
)

// Config holds the configuration for the Memory proxy
type Config struct {
	// ListenAddr is the address to listen for Memory connections
	ListenAddr string `json:"listen_addr"`

	// Kubeconfig is the path to the kubeconfig file
	KubeConfigPath string `json:"kube_config_path"`

	// MySQLLabelKey is the label key to identify MySQL services
	LabelSelector string `json:"label_selector"`

	// UseProxyProto is a flag to enable proxy protocol
	UseProxyProto bool `json:"use_proxy_proto"`

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
}

// DefaultConfig returns a default configuration
func DefaultConfig() *Config {
	return &Config{
		// KubeConfigPath:    "~/.kube/config",
		KubeConfigPath:    "",
		IdleTimeout:       10 * time.Minute,
		MaxConnections:    100,
		ConnectionTimeout: 5 * time.Second,
		ReadBufferSize:    32768,
		WriteBufferSize:   32768,
		// ReadTimeout:       30 * time.Second,
		// WriteTimeout:      30 * time.Second,
		ListenAddr:    ":6379",
		LabelSelector: "managedBy=kubestrator,type=memory",
		UseProxyProto: true,
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
