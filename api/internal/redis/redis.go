package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/deployra/deployra/api/internal/config"
	"github.com/redis/go-redis/v9"
)

// Queue names
const (
	QueueBuilder    = "builder-queue"
	QueueDeployment = "deployment-queue"
)

// Redis channels
const (
	ChannelBuilderCancel  = "builder:cancel"
	ChannelCronJobAdded   = "cronjob:added"
	ChannelCronJobUpdated = "cronjob:updated"
	ChannelCronJobDeleted = "cronjob:deleted"
	ChannelWebSocket = "websocket"
)

var (
	client *redis.Client
	once   sync.Once
)

// Initialize sets up the Redis client and tests the connection
func Initialize(cfg *config.Config) error {
	var initErr error
	once.Do(func() {
		client = redis.NewClient(&redis.Options{
			Addr:     fmt.Sprintf("%s:%s", cfg.RedisHost, cfg.RedisPort),
			Username: cfg.RedisUsername,
			Password: cfg.RedisPassword,
			DB:       0,
		})

		// Test connection
		ctx := context.Background()
		if err := client.Ping(ctx).Err(); err != nil {
			initErr = fmt.Errorf("failed to connect to Redis: %w", err)
		}
	})
	return initErr
}

// GetClient returns the Redis client
func GetClient() *redis.Client {
	return client
}

// RemoveDeploymentFromQueue removes a deployment from the queue
func RemoveDeploymentFromQueue(ctx context.Context, queue string, deploymentID string) (bool, error) {
	// Use Lua script for atomicity and efficiency
	luaScript := `
		local queueKey = KEYS[1]
		local deploymentId = ARGV[1]
		local removed = 0
		local items = redis.call('LRANGE', queueKey, 0, -1)

		for i, item in ipairs(items) do
			local success, job = pcall(function() return cjson.decode(item) end)
			if success and job.deploymentId == deploymentId then
				redis.call('LREM', queueKey, 1, item)
				removed = 1
				break
			end
		end

		return removed
	`

	result, err := client.Eval(ctx, luaScript, []string{queue}, deploymentID).Int()
	if err != nil {
		return false, fmt.Errorf("failed to remove deployment from queue: %w", err)
	}

	return result == 1, nil
}

// PublishBuilderCancellation publishes a cancellation signal to builders
func PublishBuilderCancellation(ctx context.Context, deploymentID string) error {
	message, err := json.Marshal(map[string]string{"deploymentId": deploymentID})
	if err != nil {
		return fmt.Errorf("failed to marshal cancellation message: %w", err)
	}

	return client.Publish(ctx, ChannelBuilderCancel, message).Err()
}

// PublishWebSocketMessage publishes a message to the WebSocket channel
func PublishWebSocketMessage(ctx context.Context, roomID string, data interface{}) error {
	message, err := json.Marshal(map[string]interface{}{
		"roomId": roomID,
		"data":   data,
	})
	if err != nil {
		return fmt.Errorf("failed to marshal websocket message: %w", err)
	}

	return client.Publish(ctx, ChannelWebSocket, message).Err()
}

// BuilderJob represents a job for the builder queue
type BuilderJob struct {
	DeploymentID         string                 `json:"deploymentId"`
	ServiceID            string                 `json:"serviceId"`
	CommitSha            string                 `json:"commitSha"`
	Branch               string                 `json:"branch"`
	RepositoryName       string                 `json:"repositoryName"`
	RuntimeFilePath      *string                `json:"runtimeFilePath,omitempty"`
	GitProvider          *BuilderGitProvider    `json:"gitProvider,omitempty"`
	EnvironmentVariables []EnvironmentVariable  `json:"environmentVariables,omitempty"`
	Ports                []Port                 `json:"ports,omitempty"`
}

type BuilderGitProvider struct {
	Type           string                `json:"type"`
	InstallationID *string               `json:"installationId,omitempty"`
	GithubAccount  *BuilderGithubAccount `json:"githubAccount,omitempty"`
	URL            *string               `json:"url,omitempty"`
	Username       *string               `json:"username,omitempty"`
	Password       *string               `json:"password,omitempty"`
}

type BuilderGithubAccount struct {
	Username    string `json:"username"`
	AccessToken string `json:"accessToken"`
}

// DeploymentJob represents a job for the deployment queue
type DeploymentJob struct {
	Type                 string              `json:"type"`
	ServiceType          string              `json:"serviceType"`
	DeploymentID         *string             `json:"deploymentId,omitempty"`
	ServiceID            string              `json:"serviceId"`
	ProjectID            string              `json:"projectId"`
	OrganizationID       string              `json:"organizationId"`
	ContainerRegistry    ContainerRegistry   `json:"containerRegistry"`
	EnvironmentVariables []EnvironmentVariable `json:"environmentVariables,omitempty"`
	AutoScalingEnabled   bool                `json:"autoScalingEnabled"`
	Scaling              *Scaling            `json:"scaling,omitempty"`
	Resources            *Resources          `json:"resources,omitempty"`
	ReadinessProbe       *Probe              `json:"readinessProbe,omitempty"`
	LivenessProbe        *Probe              `json:"livenessProbe,omitempty"`
	Storage              *Storage            `json:"storage,omitempty"`
	Credentials          *Credentials        `json:"credentials,omitempty"`
	Ports                []Port              `json:"ports,omitempty"`
	Domains              []string            `json:"domains,omitempty"`
	ScaleToZeroEnabled   bool                `json:"scaleToZeroEnabled"`
	Command              []string            `json:"command,omitempty"`
}

type EnvironmentVariable struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type Port struct {
	ServicePort   int `json:"servicePort"`
	ContainerPort int `json:"containerPort"`
}

type ContainerRegistry struct {
	Type     string `json:"type"`
	ImageUri string `json:"imageUri"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

type Scaling struct {
	Replicas                       int  `json:"replicas"`
	MinReplicas                    int  `json:"minReplicas"`
	MaxReplicas                    int  `json:"maxReplicas"`
	TargetCPUUtilizationPercentage int  `json:"targetCPUUtilizationPercentage"`
}

type Resources struct {
	Requests *ResourceLimits `json:"requests,omitempty"`
	Limits   *ResourceLimits `json:"limits,omitempty"`
}

type ResourceLimits struct {
	CPU    string `json:"cpu,omitempty"`
	Memory string `json:"memory,omitempty"`
}

type Probe struct {
	HTTPGet             *HTTPGet `json:"httpGet,omitempty"`
	InitialDelaySeconds int      `json:"initialDelaySeconds"`
	PeriodSeconds       int      `json:"periodSeconds"`
}

type HTTPGet struct {
	Path string `json:"path"`
	Port int    `json:"port"`
}

type Storage struct {
	Size         string `json:"size"`
	StorageClass string `json:"storageClass"`
}

type Credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Database string `json:"database"`
}

// AddToBuilderQueue adds a job to the builder queue
func AddToBuilderQueue(ctx context.Context, job BuilderJob) error {
	data, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("failed to marshal builder job: %w", err)
	}

	return client.RPush(ctx, QueueBuilder, data).Err()
}

// AddToDeploymentQueue adds a job to the deployment queue
func AddToDeploymentQueue(ctx context.Context, job DeploymentJob) error {
	data, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("failed to marshal deployment job: %w", err)
	}

	return client.RPush(ctx, QueueDeployment, data).Err()
}

// AcquireLock tries to acquire a distributed lock with optional TTL (default 30 seconds)
func AcquireLock(ctx context.Context, key string, ttlSeconds ...int) (bool, error) {
	ttl := 30
	if len(ttlSeconds) > 0 && ttlSeconds[0] > 0 {
		ttl = ttlSeconds[0]
	}

	result, err := client.SetNX(ctx, key, "1", time.Duration(ttl)*time.Second).Result()
	if err != nil {
		return false, fmt.Errorf("failed to acquire lock: %w", err)
	}

	return result, nil
}

// ReleaseLock releases a distributed lock
func ReleaseLock(ctx context.Context, key string) error {
	return client.Del(ctx, key).Err()
}

// CronJobEvent represents a cronjob event payload for Redis
type CronJobEvent struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Schedule  string            `json:"schedule"`
	Path      string            `json:"path"`
	Headers   map[string]string `json:"headers,omitempty"`
	Enabled   bool              `json:"enabled"`
	ServiceID string            `json:"serviceId"`
	ProjectID string            `json:"projectId"`
}

// CronJobDeleteEvent represents a cronjob deletion event payload
type CronJobDeleteEvent struct {
	ID        string `json:"id"`
	ServiceID string `json:"serviceId"`
	ProjectID string `json:"projectId"`
}

// PublishCronJobAdded publishes a cronjob added event with full payload
func PublishCronJobAdded(ctx context.Context, cronJob CronJobEvent) error {
	message, err := json.Marshal(cronJob)
	if err != nil {
		return fmt.Errorf("failed to marshal cronjob added message: %w", err)
	}

	return client.Publish(ctx, ChannelCronJobAdded, message).Err()
}

// PublishCronJobUpdated publishes a cronjob updated event with full payload
func PublishCronJobUpdated(ctx context.Context, cronJob CronJobEvent) error {
	message, err := json.Marshal(cronJob)
	if err != nil {
		return fmt.Errorf("failed to marshal cronjob updated message: %w", err)
	}

	return client.Publish(ctx, ChannelCronJobUpdated, message).Err()
}

// PublishCronJobDeleted publishes a cronjob deleted event
func PublishCronJobDeleted(ctx context.Context, event CronJobDeleteEvent) error {
	message, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal cronjob deleted message: %w", err)
	}

	return client.Publish(ctx, ChannelCronJobDeleted, message).Err()
}

// ControllerJob represents a job for controlling services (scale-up, scale-down, etc.)
type ControllerJob struct {
	Type      string `json:"type"`
	ServiceID string `json:"serviceId"`
	ProjectID string `json:"projectId"`
	Action    string `json:"action"`
}

// AddToControllerQueue adds a controller job to the deployment queue
func AddToControllerQueue(ctx context.Context, job ControllerJob) error {
	data, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("failed to marshal controller job: %w", err)
	}

	return client.RPush(ctx, QueueDeployment, data).Err()
}
