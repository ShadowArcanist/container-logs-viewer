"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { TrackedContainer, LogEntry, LogLevel } from "@/lib/types"

const API_BASE = "/api"

interface AddContainerRequest {
  name: string
  alias?: string
  maxPeriod?: number
  maxLines?: number
  serverName?: string
}

interface AddContainerResponse {
  container: TrackedContainer
  success: boolean
  message?: string
}

interface LogListResponse {
  logs: LogEntry[]
  hasMore: boolean
  total: number
}

interface ContainerListResponse {
  containers: TrackedContainer[]
}

interface WSMessage {
  type: string
  payload: LogEntry
}

export function useBackendAPI() {
  const [containers, setContainers] = useState<TrackedContainer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const fetchContainers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/containers`)
      if (!res.ok) throw new Error("Failed to fetch containers")
      const data: ContainerListResponse = await res.json()
      setContainers(data.containers)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch containers")
    }
  }, [])

  useEffect(() => {
    fetchContainers()
    setLoading(false)
  }, [fetchContainers])

  const addContainer = useCallback(
    async (name: string, alias?: string, maxPeriod?: number, maxLines?: number, serverName?: string): Promise<TrackedContainer | null> => {
      try {
        const req: AddContainerRequest = { name }
        if (alias) req.alias = alias
        if (maxPeriod) req.maxPeriod = maxPeriod
        if (maxLines) req.maxLines = maxLines
        if (serverName) req.serverName = serverName

        const res = await fetch(`${API_BASE}/containers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        })

        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || "Failed to add container")
        }

        const data: AddContainerResponse = await res.json()
        if (data.success) {
          setContainers((prev) => [...prev, data.container])
          return data.container
        }
        return null
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add container")
        return null
      }
    },
    [],
  )

  const removeContainer = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/containers/${id}`, {
          method: "DELETE",
        })

        if (!res.ok) throw new Error("Failed to remove container")

        setContainers((prev) => prev.filter((c) => c.id !== id))
        if (wsRef.current) {
          wsRef.current.close()
          wsRef.current = null
        }
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove container")
        return false
      }
    },
    [],
  )

  const getLogs = useCallback(
    async (containerId: string, limit = 100): Promise<LogEntry[]> => {
      try {
        const res = await fetch(`${API_BASE}/containers/${containerId}/logs?limit=${limit}`)
        if (!res.ok) throw new Error("Failed to fetch logs")
        const data: LogListResponse = await res.json()
        return data.logs
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch logs")
        return []
      }
    },
    [],
  )

  const streamLogs = useCallback(
    (containerId: string, onLog: (log: LogEntry) => void, onError?: (err: string) => void) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const wsUrl = `${protocol}//${window.location.host}${API_BASE}/ws/${containerId}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data)
          if (msg.type === "log") {
            onLog(msg.payload)
          } else if (msg.type === "error" && onError) {
            onError(msg.payload as unknown as string)
          }
        } catch {
          console.error("[frontend] Failed to parse WebSocket message")
        }
      }

      ws.onerror = () => {
        if (onError) onError("WebSocket error")
      }

      ws.onclose = () => {
        wsRef.current = null
      }

      return () => {
        ws.close()
        wsRef.current = null
      }
    },
    [],
  )

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    containers,
    loading,
    error,
    fetchContainers,
    addContainer,
    removeContainer,
    getLogs,
    streamLogs,
    disconnect,
  }
}
