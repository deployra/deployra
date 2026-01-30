package kubernetes

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Pod represents a Kubernetes pod
type Pod struct {
	Name     string `json:"name"`
	Status   string `json:"status"`
	Ready    string `json:"ready"`
	Restarts int32  `json:"restarts"`
	Age      string `json:"age"`
}

var clientset *kubernetes.Clientset

// GetClient returns a Kubernetes clientset
func GetClient() (*kubernetes.Clientset, error) {
	if clientset != nil {
		return clientset, nil
	}

	var config *rest.Config
	var err error

	// Check for KUBECONFIG_CONTENT environment variable
	if kubeConfigContent := os.Getenv("KUBECONFIG_CONTENT"); kubeConfigContent != "" {
		// Create a temporary file to load the config from
		tmpFile, err := os.CreateTemp("", "kubeconfig-")
		if err != nil {
			return nil, fmt.Errorf("failed to create temp file: %w", err)
		}
		defer os.Remove(tmpFile.Name())

		if _, err := tmpFile.WriteString(kubeConfigContent); err != nil {
			return nil, fmt.Errorf("failed to write kubeconfig: %w", err)
		}
		tmpFile.Close()

		config, err = clientcmd.BuildConfigFromFlags("", tmpFile.Name())
		if err != nil {
			return nil, fmt.Errorf("failed to build config from kubeconfig content: %w", err)
		}
	} else if kubeConfigPath := os.Getenv("KUBECONFIG_PATH"); kubeConfigPath != "" {
		// Load from KUBECONFIG_PATH
		config, err = clientcmd.BuildConfigFromFlags("", kubeConfigPath)
		if err != nil {
			return nil, fmt.Errorf("failed to build config from kubeconfig path: %w", err)
		}
	} else {
		// Try in-cluster config first, then fall back to default kubeconfig
		config, err = rest.InClusterConfig()
		if err != nil {
			// Fall back to default kubeconfig location
			kubeconfig := os.Getenv("HOME") + "/.kube/config"
			config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
			if err != nil {
				return nil, fmt.Errorf("failed to build config: %w", err)
			}
		}
	}

	clientset, err = kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	return clientset, nil
}

// GetPodsForService returns all pods for a specific service
func GetPodsForService(projectID, serviceID string) ([]Pod, error) {
	client, err := GetClient()
	if err != nil {
		return nil, err
	}

	namespace := projectID
	labelSelector := fmt.Sprintf("service=%s", serviceID)

	podList, err := client.CoreV1().Pods(namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: labelSelector,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	var pods []Pod
	for _, pod := range podList.Items {
		if pod.Name == "" {
			continue
		}

		containerStatuses := pod.Status.ContainerStatuses

		// Calculate ready count
		readyCount := 0
		for _, status := range containerStatuses {
			if status.Ready {
				readyCount++
			}
		}

		// Get restarts
		var restarts int32 = 0
		if len(containerStatuses) > 0 {
			restarts = containerStatuses[0].RestartCount
		}

		// Calculate age
		age := "Unknown"
		if !pod.CreationTimestamp.IsZero() {
			age = formatAge(time.Since(pod.CreationTimestamp.Time))
		}

		// Determine status
		status := string(pod.Status.Phase)
		if len(containerStatuses) > 0 {
			cs := containerStatuses[0]
			if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
				status = cs.State.Waiting.Reason
			} else if cs.State.Terminated != nil && cs.State.Terminated.Reason != "" {
				status = cs.State.Terminated.Reason
			}
		}

		// Skip pending pods
		if status == "Pending" {
			continue
		}

		pods = append(pods, Pod{
			Name:     pod.Name,
			Status:   status,
			Ready:    fmt.Sprintf("%d/%d", readyCount, len(containerStatuses)),
			Restarts: restarts,
			Age:      age,
		})
	}

	return pods, nil
}

// GetPodLogs returns logs for a specific pod
func GetPodLogs(projectID, serviceID, podName string) (string, error) {
	client, err := GetClient()
	if err != nil {
		return "", err
	}

	namespace := projectID
	tailLines := int64(1000)

	req := client.CoreV1().Pods(namespace).GetLogs(podName, &corev1.PodLogOptions{
		TailLines:  &tailLines,
		Timestamps: true,
	})

	podLogs, err := req.Stream(context.Background())
	if err != nil {
		return "", fmt.Errorf("failed to get logs stream: %w", err)
	}
	defer podLogs.Close()

	logs, err := io.ReadAll(podLogs)
	if err != nil {
		return "", fmt.Errorf("failed to read logs: %w", err)
	}

	if len(logs) == 0 {
		return "No logs available", nil
	}

	return string(logs), nil
}

// StreamPodLogs streams logs for a specific pod
func StreamPodLogs(projectID, serviceID, podName string, sinceTime *time.Time, writer io.Writer) error {
	client, err := GetClient()
	if err != nil {
		return err
	}

	namespace := projectID

	opts := &corev1.PodLogOptions{
		Follow:     true,
		Timestamps: true,
	}

	if sinceTime == nil {
		tailLines := int64(10000)
		opts.TailLines = &tailLines
	} else {
		sinceTimeMeta := metav1.NewTime(*sinceTime)
		opts.SinceTime = &sinceTimeMeta
	}

	req := client.CoreV1().Pods(namespace).GetLogs(podName, opts)

	podLogs, err := req.Stream(context.Background())
	if err != nil {
		return fmt.Errorf("failed to get logs stream: %w", err)
	}
	defer podLogs.Close()

	// Copy logs to writer
	_, err = io.Copy(writer, podLogs)
	if err != nil && err != io.EOF {
		return fmt.Errorf("failed to stream logs: %w", err)
	}

	return nil
}

// formatAge formats a duration into a human-readable age string
func formatAge(d time.Duration) string {
	days := int(d.Hours() / 24)
	if days > 0 {
		return fmt.Sprintf("%dd", days)
	}

	hours := int(d.Hours())
	if hours > 0 {
		return fmt.Sprintf("%dh", hours)
	}

	minutes := int(d.Minutes())
	return fmt.Sprintf("%dm", minutes)
}

// CreateOrUpdateSecret creates or updates a Kubernetes secret
func CreateOrUpdateSecret(name, namespace, secretType string, data map[string][]byte) error {
	client, err := GetClient()
	if err != nil {
		return err
	}

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Type: corev1.SecretType(secretType),
		Data: data,
	}

	// Try to get existing secret
	_, err = client.CoreV1().Secrets(namespace).Get(context.Background(), name, metav1.GetOptions{})
	if err != nil {
		// Secret doesn't exist, create it
		_, err = client.CoreV1().Secrets(namespace).Create(context.Background(), secret, metav1.CreateOptions{})
		if err != nil {
			return fmt.Errorf("failed to create secret: %w", err)
		}
		return nil
	}

	// Secret exists, update it
	_, err = client.CoreV1().Secrets(namespace).Update(context.Background(), secret, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to update secret: %w", err)
	}

	return nil
}

// CreateDockerConfigSecret creates a docker config secret for container registry authentication
func CreateDockerConfigSecret(name, namespace, registryURL, username, password string) error {
	// Build docker config JSON
	dockerConfig := map[string]interface{}{
		"auths": map[string]interface{}{
			registryURL: map[string]interface{}{
				"username": username,
				"password": password,
				"auth":     encodeBase64(username + ":" + password),
				"email":    "not-used@example.com",
			},
		},
	}

	dockerConfigJSON, err := json.Marshal(dockerConfig)
	if err != nil {
		return fmt.Errorf("failed to marshal docker config: %w", err)
	}

	return CreateOrUpdateSecret(name, namespace, "kubernetes.io/dockerconfigjson", map[string][]byte{
		".dockerconfigjson": dockerConfigJSON,
	})
}

// CreateECRSecret creates an ECR docker config secret
func CreateECRSecret(name, namespace, registryURL, token string) error {
	return CreateDockerConfigSecret(name, namespace, registryURL, "AWS", token)
}

// encodeBase64 encodes a string to base64
func encodeBase64(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}

// StreamPodLogsReader returns a ReadCloser for streaming pod logs
func StreamPodLogsReader(ctx context.Context, namespace, podName string, sinceSeconds *int64) (io.ReadCloser, error) {
	client, err := GetClient()
	if err != nil {
		return nil, err
	}

	opts := &corev1.PodLogOptions{
		Follow:     true,
		Timestamps: true,
	}

	if sinceSeconds != nil {
		opts.SinceSeconds = sinceSeconds
	} else {
		tailLines := int64(1000)
		opts.TailLines = &tailLines
	}

	req := client.CoreV1().Pods(namespace).GetLogs(podName, opts)
	return req.Stream(ctx)
}
