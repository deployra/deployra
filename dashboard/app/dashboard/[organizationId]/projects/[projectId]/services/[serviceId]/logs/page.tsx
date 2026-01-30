"use client"

import { useEffect, useState, useRef } from "react"
import { useParams } from "next/navigation"
import { Loader2, ScrollText } from "lucide-react"
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'

import { PageHeader } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getServicePods, getToken } from "@/lib/api"
import { PodInfo } from "@/lib/models"
import { WebSocketClient, PodLogPayload, ErrorPayload } from "@/lib/websocket"

import 'xterm/css/xterm.css'

export default function ServiceLogsPage() {
  const params = useParams()
  const [pods, setPods] = useState<PodInfo[]>([])
  const [selectedPod, setSelectedPod] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminalInstance = useRef<Terminal | null>(null)
  const fitAddon = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocketClient | null>(null)
  const lastTimestampRef = useRef<string | null>(null)
  const isInitialLoadRef = useRef(true)

  // Fetch pods on mount
  useEffect(() => {
    const fetchPods = async () => {
      try {
        setLoading(true)
        const response = await getServicePods(params.serviceId as string)
        setPods(response)
        if (response.length > 0 && !selectedPod) {
          setSelectedPod(response[0].name)
        }
      } catch (error) {
        console.error("Error fetching pods:", error)
      } finally {
        setLoading(false)
        isInitialLoadRef.current = false
      }
    }

    fetchPods()
  }, [params.serviceId])

  // Initialize terminal and start stream when pod is selected
  useEffect(() => {
    if (loading || !selectedPod || !terminalRef.current || terminalInstance.current) return

    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
      },
      convertEol: true,
      scrollback: 10000,
    })

    const fit = new FitAddon()
    terminal.loadAddon(fit)
    fitAddon.current = fit

    terminal.loadAddon(new WebLinksAddon())
    terminal.open(terminalRef.current)
    terminalInstance.current = terminal
    fit.fit()

    startStream(selectedPod)

    return () => {
      if (wsRef.current) {
        wsRef.current.disconnect()
        wsRef.current = null
      }
      if (terminalInstance.current) {
        terminalInstance.current.dispose()
        terminalInstance.current = null
      }
    }
  }, [loading, params.serviceId])

  useEffect(() => {
    const handleResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit()
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const extractLastTimestamp = (logContent: string) => {
    const timestampRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/
    const lines = logContent.trim().split("\n")

    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1]
      const timestampMatch = lastLine.match(timestampRegex)

      if (timestampMatch) {
        lastTimestampRef.current = timestampMatch[1]
      }
    }
  }

  const startStream = (podName: string) => {
    if (!podName || !terminalInstance.current) return

    if (wsRef.current) {
      wsRef.current.disconnect()
      wsRef.current = null
    }

    try {
      terminalInstance.current.clear()

      const token = getToken()
      if (!token) {
        terminalInstance.current.writeln("\x1b[31mError: Authentication token not found. Please log in again.\x1b[0m")
        return
      }

      const ws = new WebSocketClient(token)
      wsRef.current = ws

      ws.on("connect", () => {
        terminalInstance.current?.clear()
        terminalInstance.current?.writeln("\x1b[32mConnected to log stream. Fetching logs...\x1b[0m")

        ws.joinPodLogs({
          podName,
          namespace: params.projectId as string,
          serviceId: params.serviceId as string,
          since: lastTimestampRef.current || undefined,
        })
      })

      ws.on("disconnect", () => {
        terminalInstance.current?.writeln("\x1b[31mDisconnected from log stream\x1b[0m")
      })

      ws.on("connect_error", (payload) => {
        const error = payload as ErrorPayload
        console.error("WebSocket connection error:", error)
        terminalInstance.current?.writeln(`\x1b[31mConnection error: ${error.message}\x1b[0m`)
      })

      ws.on("pod_log", (payload) => {
        const logData = payload as PodLogPayload

        if (logData.podName && logData.podName !== selectedPod) {
          return
        }

        if (logData.logs && typeof logData.logs === "string") {
          terminalInstance.current?.write(logData.logs)
          extractLastTimestamp(logData.logs)
        }
      })

      ws.on("error", (payload) => {
        const error = payload as ErrorPayload
        console.error("Error from WebSocket server:", error)
        terminalInstance.current?.writeln(`\x1b[31mError: ${error.message || "Unknown error"}\x1b[0m`)
      })

      ws.on("logs_complete", () => {
        terminalInstance.current?.writeln("\x1b[36m--- End of logs, waiting for new logs ---\x1b[0m")
      })

      ws.connect().catch((error) => {
        console.error("Failed to connect:", error)
        terminalInstance.current?.writeln(`\x1b[31mFailed to connect to log stream\x1b[0m`)
      })
    } catch (error) {
      console.error("Error starting log stream:", error)
      terminalInstance.current?.writeln(`\x1b[31mError starting log stream: ${(error as Error).message}\x1b[0m`)
    }
  }

  const handlePodChange = (podName: string) => {
    setSelectedPod(podName)

    if (terminalInstance.current) {
      terminalInstance.current.clear()
      startStream(podName)
    }
  }

  return (
    <div className="flex flex-col h-full max-w-full">
      <div className="mb-4">
        <PageHeader
          icon={ScrollText}
          title="Logs"
          description="View console logs for your service"
        />

        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-2">
            <Select
              disabled={loading || pods.length === 0}
              value={selectedPod}
              onValueChange={handlePodChange}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Select a pod" />
              </SelectTrigger>
              <SelectContent>
                {pods.map((pod) => (
                  <SelectItem key={pod.name} value={pod.name}>
                    {pod.name.split('-')[pod.name.split('-').length - 1]} ({pod.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-4 flex-1">
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-full mb-2" />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div ref={terminalRef} className="flex-1 bg-black rounded-md overflow-hidden" />
        </div>
      )}
    </div>
  )
}
