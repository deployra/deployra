package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

type ServiceInfoAction int

const (
	Add ServiceInfoAction = iota
	Delete
)

// ServiceInfo contains information about a Kubernetes service
type ServiceInfo struct {
	Name      string
	Namespace string
	ProjectID string
	ServiceID string
	Port      int32
	Usernames []string
}

// ServiceChangeCallback is a function called when services change
type ServiceChangeCallback func(ServiceInfoAction, string, *ServiceInfo)

// Client represents a Kubernetes client
type Client struct {
	clientset      *kubernetes.Clientset
	labelSelector  string
	watchContext   context.Context
	watchCancel    context.CancelFunc
	watcherStarted bool
}

// NewClient creates a new Kubernetes client
func NewClient(kubeConfigPath, labelSelector string) (*Client, error) {
	var config *rest.Config
	var err error

	// Use provided kubeconfig or default path
	if kubeConfigPath == "" {
		// Try in-cluster config first
		config, err = rest.InClusterConfig()
		if err != nil {
			// Fall back to default kubeconfig location
			home := homedir.HomeDir()
			if home != "" {
				path := filepath.Join(home, ".kube", "config")
				config, err = clientcmd.BuildConfigFromFlags("", path)
				if err != nil {
					return nil, fmt.Errorf("failed to create Kubernetes client config: %v", err)
				}
			} else {
				return nil, fmt.Errorf("no kubeconfig found")
			}
		}
	} else {
		path := kubeConfigPath
		if strings.HasPrefix(path, "~/") {
			home := homedir.HomeDir()
			path = filepath.Join(home, path[2:])
		}

		// Use provided kubeconfig
		config, err = clientcmd.BuildConfigFromFlags("", path)
		if err != nil {
			return nil, fmt.Errorf("failed to create Kubernetes client config: %v", err)
		}
	}

	// Create clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create Kubernetes clientset: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &Client{
		clientset:      clientset,
		labelSelector:  labelSelector,
		watchContext:   ctx,
		watchCancel:    cancel,
		watcherStarted: false,
	}, nil
}

// StartWatching starts watching for service changes in all namespaces
func (c *Client) StartWatching(callback ServiceChangeCallback) error {
	if c.watcherStarted {
		return fmt.Errorf("watchers already started")
	}

	// Start watcher for all namespaces
	go c.watchServices(callback)

	c.watcherStarted = true
	return nil
}

// StopWatching stops all active watchers
func (c *Client) StopWatching() {
	if c.watchCancel != nil {
		c.watchCancel()
	}
	c.watcherStarted = false
}

// watchServices watches for service changes across all namespaces
// Uses List + Watch pattern to ensure no services are missed
func (c *Client) watchServices(callback ServiceChangeCallback) {
	log.Println("Starting to watch all namespaces for services with label selector:", c.labelSelector)

	for {
		// Check if context is cancelled
		select {
		case <-c.watchContext.Done():
			return
		default:
		}

		// Step 1: List all existing services first
		listOptions := metav1.ListOptions{
			LabelSelector: c.labelSelector,
		}

		services, err := c.clientset.CoreV1().Services("").List(c.watchContext, listOptions)
		if err != nil {
			log.Printf("Error listing services: %v, retrying in 5 seconds...", err)
			time.Sleep(5 * time.Second)
			continue
		}

		// Process all existing services
		log.Printf("Found %d existing services with label selector: %s", len(services.Items), c.labelSelector)
		for _, service := range services.Items {
			serviceKey, info, err := c.handleServiceChange(&service)
			if err == nil {
				callback(Add, serviceKey, info)
				log.Printf("Loaded existing service: %s", serviceKey)
			}
		}

		// Step 2: Start watching from the resource version we got from List
		listOptions.ResourceVersion = services.ResourceVersion
		log.Printf("Starting watch from resourceVersion: %s", services.ResourceVersion)

		watcher, err := c.clientset.CoreV1().Services("").Watch(c.watchContext, listOptions)
		if err != nil {
			log.Printf("Error creating watcher: %v, retrying in 5 seconds...", err)
			time.Sleep(5 * time.Second)
			continue
		}

		// Process watch events
		watchLoop := true
		for watchLoop {
			select {
			case <-c.watchContext.Done():
				watcher.Stop()
				return
			case event, ok := <-watcher.ResultChan():
				if !ok {
					log.Println("Watcher channel closed, will re-list and restart watcher...")
					watchLoop = false
					break
				}

				switch event.Type {
				case watch.Added, watch.Modified:
					if service, ok := event.Object.(*corev1.Service); ok {
						log.Printf("Service added or modified: %s", service.Name)
						serviceKey, info, err := c.handleServiceChange(service)
						if err == nil {
							callback(Add, serviceKey, info)
						}
					}
				case watch.Deleted:
					if service, ok := event.Object.(*corev1.Service); ok {
						log.Printf("Service deleted: %s", service.Name)
						serviceKey := fmt.Sprintf("%s/%s", service.Namespace, service.Name)
						callback(Delete, serviceKey, nil)
					}
				}
			}
		}

		watcher.Stop()
		log.Println("Restarting list + watch cycle after brief delay...")
		time.Sleep(5 * time.Second)
	}
}

// handleServiceChange processes a service change event
func (c *Client) handleServiceChange(service *corev1.Service) (string, *ServiceInfo, error) {
	// Extract service name
	name := service.Name

	// Create unique service key combining namespace and name
	serviceKey := fmt.Sprintf("%s/%s", service.Namespace, name)

	// Extract service metadata
	projectID := service.Labels["project"]
	serviceID := service.Labels["service"]
	serviceType := service.Labels["type"]

	// Check if service type is postgresql
	if serviceType != "postgresql" {
		return "", nil, errors.New("unsupported service type")
	}

	// Extract usernames from labels
	usernames := []string{}
	for k, v := range service.Labels {
		if strings.HasPrefix(k, "username-") && v != "" {
			usernames = append(usernames, v)
		}
	}

	// Find the PostgreSQL port
	var port int32 = 5432 // Default PostgreSQL port
	for _, servicePort := range service.Spec.Ports {
		if servicePort.Name == "postgresql" {
			port = servicePort.Port
			break
		}
	}

	// Create service info
	info := &ServiceInfo{
		Name:      name,
		Namespace: service.Namespace,
		ProjectID: projectID,
		ServiceID: serviceID,
		Port:      port,
		Usernames: usernames,
	}

	return serviceKey, info, nil
}
