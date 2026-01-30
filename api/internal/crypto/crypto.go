package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"log"
	"sync"

	"github.com/deployra/deployra/api/internal/config"
)

var (
	gcm            cipher.AEAD
	once           sync.Once
	initError      error
	encryptEnabled bool
)

// Initialize sets up the encryption with the key from config
func Initialize() error {
	once.Do(func() {
		cfg := config.Get()
		if cfg.EncryptionKey == "" {
			log.Println("Warning: ENCRYPTION_KEY is not set. Environment variables and headers will be stored in plaintext.")
			encryptEnabled = false
			return
		}

		key := []byte(cfg.EncryptionKey)
		if len(key) != 32 {
			initError = errors.New("ENCRYPTION_KEY must be exactly 32 bytes for AES-256")
			encryptEnabled = false
			return
		}

		block, err := aes.NewCipher(key)
		if err != nil {
			initError = err
			encryptEnabled = false
			return
		}

		gcm, err = cipher.NewGCM(block)
		if err != nil {
			initError = err
			encryptEnabled = false
			return
		}

		encryptEnabled = true
		log.Println("Encryption enabled for environment variables and headers")
	})
	return initError
}

// IsEnabled returns whether encryption is enabled
func IsEnabled() bool {
	Initialize()
	return encryptEnabled
}

// Encrypt encrypts plaintext using AES-256-GCM
// If encryption is not enabled, returns plaintext as-is
func Encrypt(plaintext string) (string, error) {
	Initialize()
	if !encryptEnabled {
		return plaintext, nil
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decrypts ciphertext using AES-256-GCM
// If encryption is not enabled, returns ciphertext as-is (assumes it's plaintext)
func Decrypt(ciphertext string) (string, error) {
	Initialize()
	if !encryptEnabled {
		return ciphertext, nil
	}

	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext too short")
	}

	nonce, ciphertextBytes := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertextBytes, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

// EncryptEnvVars encrypts a slice of environment variables
func EncryptEnvVars(envVars []EnvironmentVariable) ([]EnvironmentVariable, error) {
	encrypted := make([]EnvironmentVariable, len(envVars))
	for i, v := range envVars {
		encryptedValue, err := Encrypt(v.Value)
		if err != nil {
			return nil, err
		}
		encrypted[i] = EnvironmentVariable{
			Key:   v.Key,
			Value: encryptedValue,
		}
	}
	return encrypted, nil
}

// DecryptEnvVars decrypts a slice of environment variables
func DecryptEnvVars(envVars []EnvironmentVariable) ([]EnvironmentVariable, error) {
	decrypted := make([]EnvironmentVariable, len(envVars))
	for i, v := range envVars {
		decryptedValue, err := Decrypt(v.Value)
		if err != nil {
			// If decryption fails, return plaintext (for backward compatibility with existing data)
			decrypted[i] = v
			continue
		}
		decrypted[i] = EnvironmentVariable{
			Key:   v.Key,
			Value: decryptedValue,
		}
	}
	return decrypted, nil
}

// EnvironmentVariable represents an environment variable
type EnvironmentVariable struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// EncryptHeaders encrypts header values in a map
func EncryptHeaders(headers map[string]string) (map[string]string, error) {
	if headers == nil {
		return nil, nil
	}
	encrypted := make(map[string]string, len(headers))
	for key, value := range headers {
		encryptedValue, err := Encrypt(value)
		if err != nil {
			return nil, err
		}
		encrypted[key] = encryptedValue
	}
	return encrypted, nil
}

// DecryptHeaders decrypts header values in a map
func DecryptHeaders(headers map[string]string) (map[string]string, error) {
	if headers == nil {
		return nil, nil
	}
	decrypted := make(map[string]string, len(headers))
	for key, value := range headers {
		decryptedValue, err := Decrypt(value)
		if err != nil {
			// If decryption fails, return plaintext (for backward compatibility)
			decrypted[key] = value
			continue
		}
		decrypted[key] = decryptedValue
	}
	return decrypted, nil
}
