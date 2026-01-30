package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/deployra/deployra/proxies/ingress/pkg/config"
	"github.com/deployra/deployra/proxies/ingress/pkg/proxy"
)

func main() {
	// Parse command line flags
	configPath := flag.String("config", "", "Path to config file")
	flag.Parse()

	// Load configuration
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Create context that listens for termination signals
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle graceful shutdown
	signalChan := make(chan os.Signal, 1)
	signal.Notify(signalChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-signalChan
		fmt.Println("Received termination signal, shutting down gracefully...")
		cancel()
	}()

	runProxyServer(ctx, cfg)
}

// runProxyServer runs the proxy server
func runProxyServer(ctx context.Context, cfg *config.Config) {
	// Log configuration
	log.Printf("Starting ingress proxy server...")
	
	// Log port mappings
	for _, mapping := range cfg.PortMappings {
		serviceDNS := fmt.Sprintf("%s.%s.svc.cluster.local", 
			mapping.ServiceName, 
			mapping.ServiceNamespace)
		log.Printf("Port mapping: %d -> %s:%d", 
			mapping.Port, 
			serviceDNS, 
			mapping.ServicePort)
	}

	// Create proxy server
	server, err := proxy.NewServer(cfg)
	if err != nil {
		log.Fatalf("Failed to create proxy server: %v", err)
	}

	// Start the server
	if err := server.Start(ctx); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
