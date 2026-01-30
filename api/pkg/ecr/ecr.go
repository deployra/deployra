package ecr

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/ecr"
)

// AuthorizationToken represents an ECR authorization token
type AuthorizationToken struct {
	Token         string
	ProxyEndpoint string
}

// GetClient returns an ECR client configured with AWS credentials
func GetClient() (*ecr.Client, error) {
	region := os.Getenv("AWS_REGION")
	if region == "" {
		region = "us-east-1"
	}

	accessKeyID := os.Getenv("AWS_ACCESS_KEY_ID")
	secretAccessKey := os.Getenv("AWS_SECRET_ACCESS_KEY")

	if accessKeyID == "" || secretAccessKey == "" {
		return nil, fmt.Errorf("AWS credentials not configured")
	}

	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			accessKeyID,
			secretAccessKey,
			"",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	return ecr.NewFromConfig(cfg), nil
}

// GetAuthorizationToken gets an ECR authorization token
func GetAuthorizationToken() (*AuthorizationToken, error) {
	client, err := GetClient()
	if err != nil {
		return nil, err
	}

	result, err := client.GetAuthorizationToken(context.Background(), &ecr.GetAuthorizationTokenInput{})
	if err != nil {
		return nil, fmt.Errorf("failed to get authorization token: %w", err)
	}

	if len(result.AuthorizationData) == 0 {
		return nil, fmt.Errorf("no authorization data returned from ECR")
	}

	authData := result.AuthorizationData[0]
	if authData.AuthorizationToken == nil || authData.ProxyEndpoint == nil {
		return nil, fmt.Errorf("invalid authorization data returned from ECR")
	}

	// Decode the base64 encoded token
	decodedToken, err := base64.StdEncoding.DecodeString(*authData.AuthorizationToken)
	if err != nil {
		return nil, fmt.Errorf("failed to decode authorization token: %w", err)
	}

	// The token is in the format "username:password"
	parts := strings.SplitN(string(decodedToken), ":", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid authorization token format")
	}

	return &AuthorizationToken{
		Token:         parts[1], // password part
		ProxyEndpoint: *authData.ProxyEndpoint,
	}, nil
}

// DeleteRepository deletes an ECR repository for a service
func DeleteRepository(serviceID string) error {
	client, err := GetClient()
	if err != nil {
		return err
	}

	repositoryName := fmt.Sprintf("deployra/%s", serviceID)
	log.Printf("Deleting ECR repository: %s", repositoryName)

	_, err = client.DeleteRepository(context.Background(), &ecr.DeleteRepositoryInput{
		RepositoryName: &repositoryName,
		Force:          true,
	})
	if err != nil {
		// Check if repository not found (this is acceptable)
		if strings.Contains(err.Error(), "RepositoryNotFoundException") {
			log.Printf("ECR repository not found: %s", repositoryName)
			return nil
		}
		log.Printf("Error deleting ECR repository: %v", err)
		return err
	}

	log.Printf("Successfully deleted ECR repository: %s", repositoryName)
	return nil
}
