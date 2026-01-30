package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/deployra/deployra/proxies/web/pkg/config"
	"github.com/deployra/deployra/proxies/web/pkg/kubernetes"
	"github.com/deployra/deployra/proxies/web/pkg/proxy"
	"github.com/deployra/deployra/proxies/web/pkg/redis"
)

func main() {
	// Parse command line flags
	configPath := flag.String("config", "", "Path to config file")
	timerMode := flag.Bool("timer", false, "Run only the scale-to-zero checker timer, not the proxy")
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

	if *timerMode {
		// Run in scale-to-zero timer mode
		runScaleToZeroTimer(ctx, cfg)
	} else {
		// Run in normal proxy mode
		runProxyServer(ctx, cfg)
	}
}

// runProxyServer runs the proxy server
func runProxyServer(ctx context.Context, cfg *config.Config) {
	// Check for required configuration
	if cfg.Email == "" {
		log.Println("Warning: No email provided for ACME registration. Certificates will be requested without an email address.")
	}

	// Log configuration
	log.Printf("Starting proxy server...")
	log.Printf("Watching all namespaces for services with label selector: %s", cfg.LabelSelector)
	log.Printf("HTTP server listening on %s", cfg.HTTPAddr)
	if cfg.EnableHTTPS {
		log.Printf("HTTPS server listening on %s", cfg.HTTPSAddr)
		log.Printf("SSL certificates will be automatically generated for domains")
	} else {
		log.Printf("HTTPS server is disabled by configuration")
	}
	log.Printf("Nginx-like access logging enabled for all requests")

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

// runScaleToZeroTimer runs the scale-to-zero timer service
func runScaleToZeroTimer(ctx context.Context, cfg *config.Config) {
	log.Println("Starting scale-to-zero timer service...")
	log.Printf("Watching all namespaces for services with label selector: %s", cfg.LabelSelector)
	log.Printf("Idle timeout: %d minutes", cfg.IdleTimeoutMinutes)
	log.Printf("Check interval: %d seconds", cfg.CheckIntervalSeconds)

	// Create Kubernetes client
	kubeClient, err := kubernetes.NewClient(cfg.KubeConfigPath, cfg.LabelSelector)
	if err != nil {
		log.Fatalf("Failed to create Kubernetes client: %v", err)
	}

	// Create Redis client
	redisClient, err := redis.NewClient(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		log.Fatalf("Failed to create Redis client: %v", err)
	}
	defer redisClient.Close()

	// Create ticker for periodic checks
	ticker := time.NewTicker(time.Duration(cfg.CheckIntervalSeconds) * time.Second)
	defer ticker.Stop()

	// Run the timer service until context is canceled
	for {
		select {
		case <-ticker.C:
			checkIdleServices(cfg, kubeClient, redisClient)
		case <-ctx.Done():
			log.Println("Scale-to-zero timer service stopped")
			return
		}
	}
}

// checkIdleServices checks for idle services and scales them down if necessary
func checkIdleServices(cfg *config.Config, kubeClient *kubernetes.Client, redisClient *redis.Client) {
	log.Println("Checking for idle services...")

	// Get all services with scaleToZeroEnabled=true
	services, err := kubeClient.GetServicesWithScaleToZero()
	if err != nil {
		log.Printf("Error getting services: %v", err)
		return
	}

	log.Printf("Found %d services with scaleToZeroEnabled=true", len(services))

	// Calculate the idle duration
	idleDuration := time.Duration(cfg.IdleTimeoutMinutes) * time.Minute

	// Check each service
	for _, service := range services {

		deploymentName := service.ServiceID + "-deployment"

		// Get timestamp from Redis
		key := fmt.Sprintf("service:access:%s:%s", service.Namespace, deploymentName)
		val, err := redisClient.GetTimestamp(key)
		if err != nil {
			continue
		}

		// Skip services that have never been accessed
		// If val == 0, it means the service was never accessed (no requests yet)
		// We should not scale down services that have never been used
		if val == 0 {
			log.Printf("Service %s/%s has never been accessed, skipping scale down check",
				service.Namespace, deploymentName)
			continue
		}

		lastAccessTime := time.Unix(val, 0)
		idleTime := time.Since(lastAccessTime)

		// If the service has been idle for longer than the idle duration, scale it down
		if idleTime >= idleDuration {
			log.Printf("Scaling down service %s/%s (idle for %v)",
				service.Namespace, deploymentName, idleTime.Round(time.Second))

			// Check if deployment is already scaled down
			exists, isActive, err := redisClient.GetDeploymentStatus(service.Namespace, deploymentName)
			if err != nil {
				log.Printf("Error checking deployment status: %v", err)
				continue
			}

			// If service is already inactive, skip
			if exists && !isActive {
				continue
			}

			// Scale down the deployment
			if err := kubeClient.ScaleUpDeployment(service.Namespace, deploymentName, 0); err != nil {
				log.Printf("Error scaling down service %s/%s: %v", service.Namespace, deploymentName, err)
				continue
			}

			// Update the deployment status in Redis
			if err := redisClient.SetDeploymentStatus(service.Namespace, deploymentName, false); err != nil {
				log.Printf("Error updating deployment status in Redis: %v", err)
			}

			log.Printf("Successfully scaled down service %s/%s", service.Namespace, deploymentName)
			break
		} else {
			log.Printf("Service %s/%s is not idle for %v, skipping scaling down", service.Namespace, deploymentName, idleTime.Round(time.Second))
		}
	}
}
