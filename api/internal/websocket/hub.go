package websocket

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/gofiber/contrib/websocket"
)

// Client represents a connected WebSocket client
type Client struct {
	Conn   *websocket.Conn
	UserID string
	Rooms  map[string]bool
	mu     sync.Mutex
}

// Hub manages all WebSocket connections and rooms
type Hub struct {
	clients map[*Client]bool
	rooms   map[string]map[*Client]bool
	mu      sync.RWMutex
}

// Message represents a WebSocket message
type Message struct {
	Event   string          `json:"event"`
	Payload json.RawMessage `json:"payload"`
}

var (
	hub  *Hub
	once sync.Once
)

// GetHub returns the singleton Hub instance
func GetHub() *Hub {
	once.Do(func() {
		hub = &Hub{
			clients: make(map[*Client]bool),
			rooms:   make(map[string]map[*Client]bool),
		}
	})
	return hub
}

// Register adds a client to the hub
func (h *Hub) Register(client *Client) {
	h.mu.Lock()
	h.clients[client] = true
	h.mu.Unlock()
	log.Printf("[WebSocket] Client registered: %s", client.UserID)
}

// Unregister removes a client from the hub
func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.clients[client]; ok {
		for roomID := range client.Rooms {
			if room, exists := h.rooms[roomID]; exists {
				delete(room, client)
				if len(room) == 0 {
					delete(h.rooms, roomID)
				}
			}
		}
		delete(h.clients, client)
		if client.Conn != nil {
			client.Conn.Close()
		}
		log.Printf("[WebSocket] Client unregistered: %s", client.UserID)
	}
}

// JoinRoom adds a client to a room
func (h *Hub) JoinRoom(client *Client, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, exists := h.rooms[roomID]; !exists {
		h.rooms[roomID] = make(map[*Client]bool)
	}
	h.rooms[roomID][client] = true
	client.Rooms[roomID] = true
	log.Printf("[WebSocket] Client %s joined room: %s", client.UserID, roomID)
}

// LeaveRoom removes a client from a room
func (h *Hub) LeaveRoom(client *Client, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if room, exists := h.rooms[roomID]; exists {
		delete(room, client)
		if len(room) == 0 {
			delete(h.rooms, roomID)
		}
	}
	delete(client.Rooms, roomID)
	log.Printf("[WebSocket] Client %s left room: %s", client.UserID, roomID)
}

// BroadcastToRoom sends a message to all clients in a room
func (h *Hub) BroadcastToRoom(roomID, event string, payload interface{}) {
	h.mu.RLock()
	room, exists := h.rooms[roomID]
	if !exists {
		h.mu.RUnlock()
		return
	}
	// Copy clients to avoid holding lock during send
	clients := make([]*Client, 0, len(room))
	for client := range room {
		clients = append(clients, client)
	}
	h.mu.RUnlock()

	data, err := json.Marshal(map[string]interface{}{
		"event":   event,
		"payload": payload,
	})
	if err != nil {
		log.Printf("[WebSocket] Error marshaling message: %v", err)
		return
	}

	for _, client := range clients {
		client.mu.Lock()
		if client.Conn != nil {
			if err := client.Conn.WriteMessage(websocket.TextMessage, data); err != nil {
				log.Printf("[WebSocket] Error sending broadcast: %v", err)
			}
		}
		client.mu.Unlock()
	}
}

// IsClientConnected checks if a client is still registered
func (h *Hub) IsClientConnected(client *Client) bool {
	if client == nil {
		return false
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, exists := h.clients[client]
	return exists
}

// SendToClient sends a message directly to a client
func (h *Hub) SendToClient(client *Client, event string, payload interface{}) error {
	if client == nil {
		return fmt.Errorf("client is nil")
	}

	data, err := json.Marshal(map[string]interface{}{
		"event":   event,
		"payload": payload,
	})
	if err != nil {
		return err
	}

	client.mu.Lock()
	defer client.mu.Unlock()

	if client.Conn == nil {
		return fmt.Errorf("connection is nil")
	}

	return client.Conn.WriteMessage(websocket.TextMessage, data)
}
