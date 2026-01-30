package redis

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/go-redis/redis/v8"
)

// Client represents a Redis client
type Client struct {
	client *redis.Client
	ctx    context.Context
}

// NewClient creates a new Redis client
func NewClient(redisAddr string, redisPassword string, redisDB int) (*Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: redisPassword,
		DB:       redisDB,
	})

	ctx := context.Background()

	// Ping Redis to ensure connectivity
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %v", err)
	}

	return &Client{
		client: client,
		ctx:    ctx,
	}, nil
}

// Close closes the Redis client
func (c *Client) Close() error {
	return c.client.Close()
}

// RecordServiceAccess records the last access time of a service
func (c *Client) RecordServiceAccess(namespace, serviceName string) {
	key := fmt.Sprintf("service:access:%s:%s", namespace, serviceName)
	now := time.Now().Unix()

	if err := c.client.Set(c.ctx, key, now, 0).Err(); err != nil {
		log.Printf("Error recording service access: %v", err)
	}
}

// GetTimestamp gets the timestamp value for a key
func (c *Client) GetTimestamp(key string) (int64, error) {
	// Get the timestamp from Redis
	val, err := c.client.Get(c.ctx, key).Result()
	if err == redis.Nil {
		// Key does not exist
		return 0, nil
	} else if err != nil {
		return 0, err
	}

	// Parse the timestamp
	timestamp, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid timestamp format: %v", err)
	}

	return timestamp, nil
}

// SetDeploymentStatus sets the status of a deployment
func (c *Client) SetDeploymentStatus(namespace, serviceName string, isActive bool) error {
	key := fmt.Sprintf("deployment:status:%s:%s", namespace, serviceName)
	status := "0"
	if isActive {
		status = "1"
	}

	return c.client.Set(c.ctx, key, status, 24*time.Hour).Err() // Set TTL to 24 hours
}

// GetDeploymentStatus gets the status of a deployment
func (c *Client) GetDeploymentStatus(namespace, serviceName string) (bool, bool, error) {
	key := fmt.Sprintf("deployment:status:%s:%s", namespace, serviceName)

	// Get the status for the deployment
	val, err := c.client.Get(c.ctx, key).Result()
	if err == redis.Nil {
		// Key does not exist
		return false, false, nil
	} else if err != nil {
		return false, false, err
	}

	// Parse the status
	isActive := val == "1"
	return true, isActive, nil
}

// GetString gets a string value from Redis
func (c *Client) GetString(key string) (string, error) {
	val, err := c.client.Get(c.ctx, key).Result()
	if err == redis.Nil {
		// Key does not exist
		return "", nil
	} else if err != nil {
		return "", err
	}

	return val, nil
}

// SetString sets a string value in Redis with optional TTL
func (c *Client) SetString(key string, value string, ttl time.Duration) error {
	return c.client.Set(c.ctx, key, value, ttl).Err()
}

// Exists checks if a key exists in Redis
func (c *Client) Exists(key string) (bool, error) {
	result, err := c.client.Exists(c.ctx, key).Result()
	if err != nil {
		return false, err
	}

	return result > 0, nil
}

// IsDeploymentInCrashLoop checks if a deployment is marked as being in CrashLoopBackOff
func (c *Client) IsDeploymentInCrashLoop(namespace, deploymentName string) (bool, error) {
	key := fmt.Sprintf("deployment:crashloop:%s:%s", namespace, deploymentName)
	return c.Exists(key)
}
