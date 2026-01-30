package websocket

import (
	"context"
	"encoding/json"
	"log"

	"github.com/deployra/deployra/api/internal/config"
	appredis "github.com/deployra/deployra/api/internal/redis"
	"github.com/redis/go-redis/v9"
)

// RedisMessage represents a message from Redis
type RedisMessage struct {
	RoomID string `json:"roomId"`
	Data   struct {
		Event   string      `json:"event"`
		Payload interface{} `json:"payload"`
	} `json:"data"`
}

// StartRedisSubscriber starts listening to the WebSocket Redis channel
func StartRedisSubscriber(cfg *config.Config) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisHost + ":" + cfg.RedisPort,
		Username: cfg.RedisUsername,
		Password: cfg.RedisPassword,
		DB:       0,
	})

	ctx := context.Background()

	// Test connection
	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("[WebSocket] Failed to connect to Redis for subscriber: %v", err)
		return
	}

	pubsub := client.Subscribe(ctx, appredis.ChannelWebSocket)
	defer pubsub.Close()

	log.Printf("[WebSocket] Subscribed to Redis channel: %s", appredis.ChannelWebSocket)

	hub := GetHub()

	for {
		msg, err := pubsub.ReceiveMessage(ctx)
		if err != nil {
			log.Printf("[WebSocket] Error receiving Redis message: %v", err)
			continue
		}

		var redisMsg RedisMessage
		if err := json.Unmarshal([]byte(msg.Payload), &redisMsg); err != nil {
			log.Printf("[WebSocket] Error parsing Redis message: %v", err)
			continue
		}

		if redisMsg.RoomID != "" && redisMsg.Data.Event != "" {
			hub.BroadcastToRoom(redisMsg.RoomID, redisMsg.Data.Event, redisMsg.Data.Payload)
			log.Printf("[WebSocket] Broadcasted event '%s' to room '%s'", redisMsg.Data.Event, redisMsg.RoomID)
		}
	}
}
