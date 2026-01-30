// WebSocket client for Go API

export interface WebSocketMessage {
  event: string
  payload: unknown
}

export interface PodLogPayload {
  podName: string
  logs: string
}

export interface DeploymentLogPayload {
  deploymentId: string
  type: string
  text: string
  timestamp: string
}

export interface JoinPodLogsPayload {
  serviceId: string
  podName: string
  namespace: string
  since?: string
}

export interface JoinDeploymentLogsPayload {
  deploymentId: string
}

export interface ErrorPayload {
  message: string
}

type EventHandler = (payload: unknown) => void

export class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private token: string
  private handlers: Map<string, EventHandler[]> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private shouldReconnect = true
  private pendingMessages: WebSocketMessage[] = []

  constructor(token: string) {
    this.token = token
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/api/socket'
    this.url = `${wsUrl}?token=${encodeURIComponent(token)}`
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      try {
        this.ws = new WebSocket(this.url)

        this.ws.onopen = () => {
          this.reconnectAttempts = 0
          this.emit('connect', {})

          // Send any pending messages
          while (this.pendingMessages.length > 0) {
            const msg = this.pendingMessages.shift()
            if (msg) this.send(msg.event, msg.payload)
          }

          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            console.log('[WebSocket] Raw message received:', event.data)
            const message: WebSocketMessage = JSON.parse(event.data)
            console.log('[WebSocket] Parsed message:', message.event, message.payload)
            this.emit(message.event, message.payload)
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error)
          }
        }

        this.ws.onclose = (event) => {
          this.emit('disconnect', { code: event.code, reason: event.reason })

          if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++
            setTimeout(() => {
              this.connect().catch(console.error)
            }, this.reconnectDelay * this.reconnectAttempts)
          }
        }

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          this.emit('connect_error', { message: 'WebSocket connection error' })
          reject(error)
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.handlers.clear()
    this.pendingMessages = []
  }

  send(event: string, payload: unknown): void {
    const message: WebSocketMessage = { event, payload }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      // Queue message if not connected yet
      this.pendingMessages.push(message)
    }
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, [])
    }
    this.handlers.get(event)!.push(handler)
  }

  off(event: string, handler?: EventHandler): void {
    if (!handler) {
      this.handlers.delete(event)
    } else {
      const handlers = this.handlers.get(event)
      if (handlers) {
        const index = handlers.indexOf(handler)
        if (index > -1) {
          handlers.splice(index, 1)
        }
      }
    }
  }

  private emit(event: string, payload: unknown): void {
    const handlers = this.handlers.get(event)
    if (handlers) {
      handlers.forEach(handler => handler(payload))
    }
  }

  // Helper methods for common operations
  joinPodLogs(payload: JoinPodLogsPayload): void {
    this.send('join_pod_logs', payload)
  }

  leavePodLogs(payload: JoinPodLogsPayload): void {
    this.send('leave_pod_logs', payload)
  }

  joinDeploymentLogs(payload: JoinDeploymentLogsPayload): void {
    this.send('join_deployment_logs', payload)
  }

  leaveDeploymentLogs(payload: JoinDeploymentLogsPayload): void {
    this.send('leave_deployment_logs', payload)
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

// Singleton instance creator
let wsClient: WebSocketClient | null = null

export function getWebSocketClient(token: string): WebSocketClient {
  if (!wsClient || !wsClient.isConnected) {
    wsClient = new WebSocketClient(token)
  }
  return wsClient
}

export function disconnectWebSocket(): void {
  if (wsClient) {
    wsClient.disconnect()
    wsClient = null
  }
}
