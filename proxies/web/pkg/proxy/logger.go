package proxy

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

// AccessLogger is a struct that represents an Nginx-like access logger
type AccessLogger struct {
	// Standard logger
	logger *log.Logger
}

// NewAccessLogger creates a new access logger
func NewAccessLogger() *AccessLogger {
	return &AccessLogger{
		logger: log.Default(),
	}
}

// LogResponseWriter is a wrapper for http.ResponseWriter that captures the status code and response size
type LogResponseWriter struct {
	http.ResponseWriter
	statusCode int
	size       int
}

// NewLogResponseWriter creates a new LogResponseWriter
func NewLogResponseWriter(w http.ResponseWriter) *LogResponseWriter {
	return &LogResponseWriter{
		ResponseWriter: w,
		statusCode:     http.StatusOK, // Default status code
	}
}

// WriteHeader captures the status code
func (lrw *LogResponseWriter) WriteHeader(code int) {
	lrw.statusCode = code
	lrw.ResponseWriter.WriteHeader(code)
}

// Write captures the response size
func (lrw *LogResponseWriter) Write(b []byte) (int, error) {
	size, err := lrw.ResponseWriter.Write(b)
	lrw.size += size
	return size, err
}

// Hijack implements the http.Hijacker interface for WebSocket support
func (lrw *LogResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := lrw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("the ResponseWriter doesn't support hijacking")
	}
	return hijacker.Hijack()
}

// GetClientIP extracts the client IP from the request
func GetClientIP(r *http.Request) string {
	// Check for X-Forwarded-For header first
	xForwardedFor := r.Header.Get("X-Forwarded-For")
	if xForwardedFor != "" {
		// Extract the first IP in the list
		ips := strings.Split(xForwardedFor, ",")
		return strings.TrimSpace(ips[0])
	}

	// Check for X-Real-IP header
	xRealIP := r.Header.Get("X-Real-IP")
	if xRealIP != "" {
		return xRealIP
	}

	// Use RemoteAddr as fallback
	return strings.Split(r.RemoteAddr, ":")[0]
}

// LogRequest logs a request in Nginx-like format
func (al *AccessLogger) LogRequest(w http.ResponseWriter, r *http.Request, duration time.Duration, upstream string) {
	lrw, ok := w.(*LogResponseWriter)
	if !ok {
		// If we didn't use our wrapper, we can't get status code and size
		al.logger.Printf("%s - %s \"%s %s %s\" - - \"unknown\" \"%s\" %s",
			GetClientIP(r),
			r.Host,
			r.Method,
			r.RequestURI,
			r.Proto,
			r.UserAgent(),
			upstream,
		)
		return
	}

	// Calculate duration in milliseconds
	durationMs := float64(duration.Nanoseconds()) / 1e6

	// Format log line in Nginx-like format
	// IP - [time] "METHOD PATH HTTP/VERSION" STATUS SIZE "REFERER" "USER-AGENT" RT=duration UPSTREAM=upstream
	logLine := fmt.Sprintf("%s - \"%s %s %s\" %d %d \"%s\" \"%s\" rt=%.2fms upstream=%s",
		GetClientIP(r),
		r.Method,
		r.RequestURI,
		r.Proto,
		lrw.statusCode,
		lrw.size,
		r.Referer(),
		r.UserAgent(),
		durationMs,
		upstream,
	)

	// Add host information
	if r.Host != "" {
		logLine = fmt.Sprintf("%s host=%s", logLine, r.Host)
	}

	al.logger.Println(logLine)
}

// Middleware creates a middleware that logs requests
func (al *AccessLogger) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Create response writer wrapper
		lrw := NewLogResponseWriter(w)

		// Process request
		next.ServeHTTP(lrw, r)

		// Calculate duration
		duration := time.Since(start)

		// Log request
		al.LogRequest(lrw, r, duration, "-")
	})
}

// WrapHandlerFunc wraps an http.HandlerFunc with logging
func (al *AccessLogger) WrapHandlerFunc(upstream string, handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Create response writer wrapper
		lrw := NewLogResponseWriter(w)

		// Process request
		handler(lrw, r)

		// Calculate duration
		duration := time.Since(start)

		// Log request
		al.LogRequest(lrw, r, duration, upstream)
	}
}
