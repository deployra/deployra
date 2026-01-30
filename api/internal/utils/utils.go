package utils

import (
	"math/rand"
	"regexp"
	"strings"
	"time"
)

const (
	lowercaseChars = "abcdefghijklmnopqrstuvwxyz"
	alphanumeric   = "abcdefghijklmnopqrstuvwxyz0123456789"
	passwordChars  = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

// GenerateShortID generates a 20-char ID (first char alphabetic, rest alphanumeric)
func GenerateShortID() string {
	result := make([]byte, 20)
	result[0] = lowercaseChars[rand.Intn(len(lowercaseChars))]
	for i := 1; i < 20; i++ {
		result[i] = alphanumeric[rand.Intn(len(alphanumeric))]
	}
	return string(result)
}

// GenerateSubdomain generates a unique subdomain from service name
func GenerateSubdomain(name string) string {
	base := strings.ToLower(name)
	reg := regexp.MustCompile(`[^a-z0-9]`)
	base = reg.ReplaceAllString(base, "-")
	reg = regexp.MustCompile(`-+`)
	base = reg.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")

	suffix := make([]byte, 8)
	for i := 0; i < 8; i++ {
		suffix[i] = lowercaseChars[rand.Intn(len(lowercaseChars))]
	}
	return base + "-" + string(suffix)
}

// GenerateRandomString generates a random alphanumeric string
func GenerateRandomString(length int) string {
	result := make([]byte, length)
	for i := 0; i < length; i++ {
		result[i] = alphanumeric[rand.Intn(len(alphanumeric))]
	}
	return string(result)
}

// GeneratePassword generates a 32-char password for databases and services
func GeneratePassword() string {
	result := make([]byte, 32)
	for i := 0; i < 32; i++ {
		result[i] = passwordChars[rand.Intn(len(passwordChars))]
	}
	return string(result)
}

// PtrValue returns the value of a pointer or a default value if nil
func PtrValue[T any](ptr *T, defaultValue T) T {
	if ptr == nil {
		return defaultValue
	}
	return *ptr
}

// Ptr returns a pointer to the given value
func Ptr[T any](v T) *T {
	return &v
}
