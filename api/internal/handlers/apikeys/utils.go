package apikeys

import "fmt"

func maskKey(key string) string {
	if len(key) < 12 {
		return key
	}
	return fmt.Sprintf("%s...%s", key[:8], key[len(key)-4:])
}
