export type LogLevel = "INFO" | "WARN" | "DEBUG" | "ERROR" | "SYSTEM"

export interface TrackedContainer {
  id: string
  containerId: string
  containerName: string
  alias: string
  addedAt: number
  status: "running" | "stopped" | "exited" | "restarting" | "unknown"
  maxPeriod: number
  maxLines: number
  serverName: string
}

export interface LogEntry {
  id: string
  containerId: string
  timestamp: number
  message: string
}
