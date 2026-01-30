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
	Name               string
	Namespace          string
	ProjectID          string
	ServiceID          string
	Port               int32
	Domains            []string
	ScaleToZeroEnabled bool
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

// OK !!!
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

// OK !!
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

// watchAllNamespaces watches for service changes across all namespaces
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
				log.Printf("Loaded existing service: %s with domains: %v", serviceKey, info.Domains)
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
	scaleToZeroEnabled := service.Labels["scaleToZeroEnabled"]

	// If service type is not good,
	if serviceType != "web" {
		return "", nil, errors.New("unsupported service type")
	}

	// Extract domains from individual domain-N labels
	domains := []string{}
	for k, v := range service.Labels {
		if strings.HasPrefix(k, "domain-") && v != "" {
			domains = append(domains, v)
		}
	}

	// Create service info
	info := &ServiceInfo{
		Name:               name,
		Namespace:          service.Namespace,
		ProjectID:          projectID,
		ServiceID:          serviceID,
		Port:               80,
		Domains:            domains,
		ScaleToZeroEnabled: scaleToZeroEnabled == "true",
	}

	return serviceKey, info, nil
}

// GetServicesWithScaleToZero gets all services with scale-to-zero enabled
func (c *Client) GetServicesWithScaleToZero() ([]ServiceInfo, error) {
	// List all services with the label selector
	services, err := c.clientset.CoreV1().Services("").List(context.Background(), metav1.ListOptions{
		LabelSelector: c.labelSelector,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list services: %v", err)
	}

	var scaleToZeroServices []ServiceInfo

	// Filter services with scaleToZeroEnabled=true
	for _, service := range services.Items {
		// Skip services that don't match our selector
		name := service.Name
		namespace := service.Namespace

		// Check if service has our required labels
		projectID := service.Labels["project"]
		serviceID := service.Labels["service"]
		serviceType := service.Labels["type"]
		scaleToZeroEnabled := service.Labels["scaleToZeroEnabled"]

		// Skip services without required labels
		if projectID == "" || serviceID == "" || serviceType != "web" {
			continue
		}

		// Skip services without scaleToZeroEnabled=true
		if scaleToZeroEnabled != "true" {
			continue
		}

		// Extract domains from individual domain-N labels
		domains := []string{}
		for k, v := range service.Labels {
			if strings.HasPrefix(k, "domain-") && v != "" {
				domains = append(domains, v)
			}
		}

		// Create service info
		info := ServiceInfo{
			Name:               name,
			Namespace:          namespace,
			ProjectID:          projectID,
			ServiceID:          serviceID,
			Port:               80,
			Domains:            domains,
			ScaleToZeroEnabled: true,
		}

		scaleToZeroServices = append(scaleToZeroServices, info)
	}

	return scaleToZeroServices, nil
}

// ScaleUpDeployment scales a deployment up to the specified number of replicas
func (c *Client) ScaleUpDeployment(namespace, name string, replicas int32) error {

	// Get the deployment
	deployment, err := c.clientset.AppsV1().Deployments(namespace).Get(context.Background(), name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get deployment: %v", err)
	}

	// Update the deployment's replica count
	deployment.Spec.Replicas = &replicas

	// Update the deployment
	_, err = c.clientset.AppsV1().Deployments(namespace).Update(context.Background(), deployment, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to scale deployment: %v", err)
	}

	log.Printf("Scaled deployment %s/%s to %d replicas", namespace, name, replicas)
	return nil
}

// IsDeploymentReady checks if a deployment is ready (all replicas are available)
func (c *Client) IsDeploymentReady(namespace, name string) bool {
	// Get the deployment
	deployment, err := c.clientset.AppsV1().Deployments(namespace).Get(context.Background(), name, metav1.GetOptions{})
	if err != nil {
		log.Printf("Error getting deployment status: %v", err)
		return false
	}

	// Check if the deployment is ready
	return deployment.Status.ReadyReplicas >= 1 && deployment.Status.AvailableReplicas >= 1
}

// GetSecret retrieves a secret from Kubernetes
func (c *Client) GetSecret(namespace, name string) (*corev1.Secret, error) {
	return c.clientset.CoreV1().Secrets(namespace).Get(context.Background(), name, metav1.GetOptions{})
}

// CreateOrUpdateSecret creates or updates a secret in Kubernetes
func (c *Client) CreateOrUpdateSecret(namespace, name string, data map[string][]byte) error {
	// Try to get the secret first
	secret, err := c.GetSecret(namespace, name)

	if err == nil && secret != nil {
		// Secret exists, update it
		secret.Data = data
		_, err = c.clientset.CoreV1().Secrets(namespace).Update(context.Background(), secret, metav1.UpdateOptions{})
		return err
	}

	// Secret doesn't exist, create it
	secret = &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			Labels: map[string]string{
				"type": "certificate",
			},
		},
		Type: corev1.SecretTypeOpaque,
		Data: data,
	}

	_, err = c.clientset.CoreV1().Secrets(namespace).Create(context.Background(), secret, metav1.CreateOptions{})
	return err
}

// ListSecrets lists secrets in a namespace with optional label selector
func (c *Client) ListSecrets(namespace, labelSelector string) ([]corev1.Secret, error) {
	secrets, err := c.clientset.CoreV1().Secrets(namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: labelSelector,
	})

	if err != nil {
		return nil, err
	}

	return secrets.Items, nil
}
