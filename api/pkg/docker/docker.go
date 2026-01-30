package docker

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var httpClient = &http.Client{
	Timeout: 10 * time.Second,
}

// ValidateImage checks if a Docker image exists on Docker Hub
func ValidateImage(imageURL, dockerUsername, dockerPassword string) (bool, error) {
	// Basic validation of image URL format
	validImagePattern := regexp.MustCompile(`^([a-zA-Z0-9.\-_]+\/)?([a-zA-Z0-9.\-_]+)(:([a-zA-Z0-9.\-_]+))?$`)
	if !validImagePattern.MatchString(imageURL) {
		return false, nil
	}

	// Parse image URL
	namespace, repository, tag := parseImageURL(imageURL)
	if repository == "" {
		return false, nil
	}

	// Build Docker Hub API URL
	var url string
	if namespace == "library" {
		url = fmt.Sprintf("https://registry.hub.docker.com/v2/repositories/library/%s/tags/%s", repository, tag)
	} else {
		url = fmt.Sprintf("https://registry.hub.docker.com/v2/repositories/%s/%s/tags/%s", namespace, repository, tag)
	}

	// Prepare headers
	headers := map[string]string{
		"Content-Type": "application/json",
	}

	// Authenticate if credentials provided
	if dockerUsername != "" && dockerPassword != "" {
		token, err := getDockerHubToken(dockerUsername, dockerPassword)
		if err != nil {
			return false, nil
		}
		headers["Authorization"] = "JWT " + token
	}

	// Make request
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return false, fmt.Errorf("failed to create request: %w", err)
	}

	for key, value := range headers {
		req.Header.Set(key, value)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	// Check response
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return false, nil
	}

	return resp.StatusCode == http.StatusOK, nil
}

// parseImageURL parses a Docker image URL and returns namespace, repository, and tag
func parseImageURL(imageURL string) (namespace, repository, tag string) {
	namespace = "library" // Default for official images
	tag = "latest"        // Default tag

	// Split tag
	if strings.Contains(imageURL, ":") {
		parts := strings.Split(imageURL, ":")
		imageURL = parts[0]
		tag = parts[1]
	}

	// Split namespace and repository
	if strings.Contains(imageURL, "/") {
		parts := strings.Split(imageURL, "/")
		if len(parts) > 2 {
			// Complex path not supported
			return "", "", ""
		}
		namespace = parts[0]
		repository = parts[1]
	} else {
		repository = imageURL
	}

	return namespace, repository, tag
}

// getDockerHubToken authenticates with Docker Hub and returns a token
func getDockerHubToken(username, password string) (string, error) {
	payload := map[string]string{
		"username": username,
		"password": password,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal credentials: %w", err)
	}

	req, err := http.NewRequest("POST", "https://hub.docker.com/v2/users/login/", bytes.NewBuffer(body))
	if err != nil {
		return "", fmt.Errorf("failed to create auth request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to authenticate: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("authentication failed with status: %d", resp.StatusCode)
	}

	var result struct {
		Token string `json:"token"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode auth response: %w", err)
	}

	return result.Token, nil
}
