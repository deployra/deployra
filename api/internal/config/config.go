package config

import (
	"os"
	"sync"

	"github.com/joho/godotenv"
)

var (
	instance *Config
	once     sync.Once
)

type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string
	AppURL      string
	ApiURL      string

	// Encryption key for environment variables (must be exactly 32 bytes for AES-256)
	EncryptionKey string

	// GitHub
	GitHubClientID      string
	GitHubClientSecret  string
	GitHubAppID         string
	GitHubAppName       string
	GitHubAppPrivateKey string
	GitHubWebhookSecret string

	// AWS
	AWSRegion          string
	AWSAccessKeyID     string
	AWSSecretAccessKey string

	// Redis
	RedisHost     string
	RedisPort     string
	RedisUsername string
	RedisPassword string

	// Webhook API Key (for internal service authentication - builder, kronjob, kubestrator, kumonitor)
	WebhookApiKey string

	// CORS
	CorsOrigins string

	// App Domain (for subdomain suffix, e.g., "example.com" results in "*.example.com")
	AppDomain string
}

func Load() *Config {
	once.Do(func() {
		_ = godotenv.Load()

		instance = &Config{
			Port:                getEnv("PORT", "8080"),
			DatabaseURL:         getEnv("DATABASE_URL", ""),
			JWTSecret:           getEnv("JWT_SECRET", ""),
			AppURL:              getEnv("APP_URL", "http://localhost:3000"),
			ApiURL:              getEnv("API_URL", "http://localhost:8080/api"),
			EncryptionKey:       getEnv("ENCRYPTION_KEY", ""),
			GitHubClientID:      getEnv("GITHUB_CLIENT_ID", ""),
			GitHubClientSecret:  getEnv("GITHUB_CLIENT_SECRET", ""),
			GitHubAppID:         getEnv("GITHUB_APP_ID", ""),
			GitHubAppName:       getEnv("GITHUB_APP_NAME", ""),
			GitHubAppPrivateKey: getEnv("GITHUB_APP_PRIVATE_KEY", ""),
			GitHubWebhookSecret: getEnv("GITHUB_WEBHOOK_SECRET", ""),
			AWSRegion:           getEnv("AWS_REGION", "eu-west-1"),
			AWSAccessKeyID:      getEnv("AWS_ACCESS_KEY_ID", ""),
			AWSSecretAccessKey:  getEnv("AWS_SECRET_ACCESS_KEY", ""),
			RedisHost:           getEnv("REDIS_HOST", "localhost"),
			RedisPort:           getEnv("REDIS_PORT", "6379"),
			RedisUsername:       getEnv("REDIS_USERNAME", ""),
			RedisPassword:       getEnv("REDIS_PASSWORD", ""),
			WebhookApiKey:       getEnv("WEBHOOK_API_KEY", ""),
			CorsOrigins:         getEnv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"),
			AppDomain:           getEnv("APP_DOMAIN", ""),
		}
	})
	return instance
}

// Get returns the loaded config instance
func Get() *Config {
	return instance
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
