"use client"

import { useState, useEffect, useCallback, useRef, useReducer } from "react"
import { LogStream } from "@/components/network/log-stream"
import { LogSearch } from "@/components/network/log-search"
import { LogFiltersPopover } from "@/components/network/log-filters-popover"
import { AddContainerDialog } from "@/components/network/add-container-dialog"
import { ContainerList } from "@/components/network/container-list"
import { ContainerSelector } from "@/components/network/container-selector"
import { EditContainerDialog } from "@/components/network/edit-container-dialog"
import type { TrackedContainer, LogEntry, LogLevel } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Pipette, Tags, Clock, Pause, Play, RefreshCw, ArrowUpDown, GitPullRequestDraft, Download, Copy, Plus, Server, Activity, Box, Code2 } from "lucide-react"

const STORAGE_KEY = "container-logger"

interface Settings {
  showHighlights: boolean
  showBadges: boolean
  showTimestamps: boolean
  logLimit: number
  logHeightLines: number
}

const defaultSettings: Settings = {
  showHighlights: true,
  showBadges: true,
  showTimestamps: true,
  logLimit: 200,
  logHeightLines: 20,
}

interface LogState {
  logs: LogEntry[]
  filteredLogs: LogEntry[]
  activeFilters: Set<LogLevel>
  searchQuery: string
  isPaused: boolean
  sortOrder: "desc" | "asc"
  followLogs: boolean
}

type LogAction =
  | { type: "ADD_LOG"; log: LogEntry }
  | { type: "SET_LOGS"; logs: LogEntry[] }
  | { type: "FORCE_ADD_LOG"; log: LogEntry }
  | { type: "FORCE_SET_LOGS"; logs: LogEntry[] }
  | { type: "TOGGLE_FILTER"; level: LogLevel }
  | { type: "CLEAR_FILTERS" }
  | { type: "SET_FILTERS"; filters: Set<LogLevel> }
  | { type: "SET_SEARCH"; query: string }
  | { type: "TOGGLE_PAUSE" }
  | { type: "CLEAR_LOGS" }
  | { type: "TOGGLE_SORT" }
  | { type: "TOGGLE_FOLLOW" }

function getLogLevel(message: string): "INFO" | "WARN" | "DEBUG" | "ERROR" | "SYSTEM" {
	const msg = message.toUpperCase()
	if (msg.includes("[SYSTEM]")) {
		return "SYSTEM"
	}
	if (/\b(ERR|ERROR)\b/.test(msg)) {
		return "ERROR"
	}
	if (/\b(WARN|WARNING)\b/.test(msg)) {
		return "WARN"
	}
	if (/\b(DEBUG|DBG)\b/.test(msg)) {
		return "DEBUG"
	}
	return "INFO"
}
const STORAGE_FILTERS_KEY = "container-logger-filters"
const STORAGE_SEARCH_KEY = "container-logger-search"

function filterLogs(logs: LogEntry[], filters: Set<LogLevel>, searchQuery: string, sortOrder: "desc" | "asc" = "desc"): LogEntry[] {
  let filtered = logs

  if (filters.size > 0 && filters.size < 5) {
    filtered = filtered.filter((l) => {
      const level = getLogLevel(l.message)
      return filters.has(level)
    })
  }

  if (searchQuery) {
    const query = searchQuery.toLowerCase()
    filtered = filtered.filter(
      (l) =>
        l.message.toLowerCase().includes(query),
    )
  }

  return filtered.sort((a, b) => sortOrder === "desc" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp)
}

function logReducer(state: LogState, action: LogAction): LogState {
  switch (action.type) {
    case "SET_LOGS": {
      if (state.isPaused) return state

      const filteredLogs = filterLogs(action.logs, state.activeFilters, state.searchQuery, state.sortOrder)
      return { ...state, logs: action.logs, filteredLogs }
    }
    case "FORCE_ADD_LOG": {
      const newLogsArray = [action.log, ...state.logs]
      const seenIds = new Set<string>()
      const deduplicatedLogs = newLogsArray.filter(l => {
        if (seenIds.has(l.id)) return false
        seenIds.add(l.id)
        return true
      })
      const newLogs = deduplicatedLogs.slice(0, 10000)
      const filteredLogs = filterLogs(newLogs, state.activeFilters, state.searchQuery, state.sortOrder)
      return { ...state, logs: newLogs, filteredLogs }
    }
    case "FORCE_SET_LOGS": {
      const filteredLogs = filterLogs(action.logs, state.activeFilters, state.searchQuery, state.sortOrder)
      return { ...state, logs: action.logs, filteredLogs }
    }
    case "ADD_LOG": {
      if (state.isPaused) return state

      const newLogsArray = [action.log, ...state.logs]
      const seenIds = new Set<string>()
      const deduplicatedLogs = newLogsArray.filter(l => {
        if (seenIds.has(l.id)) return false
        seenIds.add(l.id)
        return true
      })
      const newLogs = deduplicatedLogs.slice(0, 10000)
      const filteredLogs = filterLogs(newLogs, state.activeFilters, state.searchQuery, state.sortOrder)
      return { ...state, logs: newLogs, filteredLogs }
    }
    case "TOGGLE_FILTER": {
      const newFilters = new Set(state.activeFilters)
      if (newFilters.has(action.level)) {
        newFilters.delete(action.level)
      } else {
        newFilters.add(action.level)
      }
      try {
        localStorage.setItem(STORAGE_FILTERS_KEY, JSON.stringify(Array.from(newFilters)))
      } catch {}
      const filteredLogs = filterLogs(state.logs, newFilters, state.searchQuery, state.sortOrder)
      return { ...state, activeFilters: newFilters, filteredLogs }
    }
    case "CLEAR_FILTERS": {
      try {
        localStorage.removeItem(STORAGE_FILTERS_KEY)
      } catch {}
      const allLevels = new Set<LogLevel>(["INFO", "WARN", "DEBUG", "ERROR", "SYSTEM"])
      const filteredLogs = filterLogs(state.logs, allLevels, state.searchQuery, state.sortOrder)
      return { ...state, activeFilters: allLevels, filteredLogs }
    }
    case "SET_FILTERS": {
      try {
        localStorage.setItem(STORAGE_FILTERS_KEY, JSON.stringify(Array.from(action.filters)))
      } catch {}
      const filteredLogs = filterLogs(state.logs, action.filters, state.searchQuery, state.sortOrder)
      return { ...state, activeFilters: action.filters, filteredLogs }
    }
    case "SET_SEARCH": {
      try {
        localStorage.setItem(STORAGE_SEARCH_KEY, action.query)
      } catch {}
      const filteredLogs = filterLogs(state.logs, state.activeFilters, action.query, state.sortOrder)
      return { ...state, searchQuery: action.query, filteredLogs }
    }
    case "TOGGLE_PAUSE": {
      return { ...state, isPaused: !state.isPaused }
    }
    case "CLEAR_LOGS": {
      return { ...state, logs: [], filteredLogs: [] }
    }
    case "TOGGLE_SORT": {
      const newSortOrder = state.sortOrder === "desc" ? "asc" : "desc"
      const sortedFilteredLogs = [...state.filteredLogs].sort((a, b) =>
        newSortOrder === "desc" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp,
      )
      return { ...state, sortOrder: newSortOrder, filteredLogs: sortedFilteredLogs }
    }
    case "TOGGLE_FOLLOW": {
      return { ...state, followLogs: !state.followLogs }
    }
    default:
      return state
  }
}

export default function NetworkAnalyzerPage() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [syntaxHighlight, setSyntaxHighlight] = useState(() => {
    try {
      const saved = localStorage.getItem("syntax-highlight")
      return saved !== null ? JSON.parse(saved) : true
    } catch {
      return true
    }
  })
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingContainer, setEditingContainer] = useState<TrackedContainer | null>(null)
  const [activeTab, setActiveTab] = useState("logs")

  const [containers, setContainers] = useState<TrackedContainer[]>([])
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const containersWsRef = useRef<WebSocket | null>(null)
  const logWsRef = useRef<WebSocket | null>(null)
  const logWsContainerIdRef = useRef<string | null>(null)
  const logWsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logWsRetryRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const containersPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const containersControllerRef = useRef<AbortController | null>(null)
  const logsPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logsControllerRef = useRef<AbortController | null>(null)
  const [containersWsStatus, setContainersWsStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected")
  const [logsWsStatus, setLogsWsStatus] = useState<"not-connected" | "polling" | "connecting" | "ws-connected">("not-connected")

  const [state, dispatch] = useReducer(logReducer, {
    logs: [],
    filteredLogs: [],
    activeFilters: new Set<LogLevel>(["INFO", "WARN", "DEBUG", "ERROR", "SYSTEM"]),
    searchQuery: "",
    isPaused: false,
    sortOrder: "desc",
    followLogs: false,
  })

  useEffect(() => {
    try {
      const savedFilters = localStorage.getItem(STORAGE_FILTERS_KEY)
      if (savedFilters) {
        const parsed = JSON.parse(savedFilters) as LogLevel[]
        const filters = new Set<LogLevel>(parsed)
        if (!filters.has("SYSTEM")) {
          filters.add("SYSTEM")
        }
        dispatch({ type: "SET_SEARCH", query: localStorage.getItem(STORAGE_SEARCH_KEY) || "" })
        dispatch({ type: "SET_FILTERS", filters })
      }
    } catch {}
  }, [])

  const fetchContainers = useCallback(async () => {
    try {
      const res = await fetch("/api/containers")
      if (!res.ok) return
      const data = await res.json()
      setContainers(data.containers || [])
    } catch (err) {
      console.error("[frontend] Failed to fetch containers:", err)
    }
  }, [])

  useEffect(() => {
    fetchContainers()
  }, [fetchContainers])

  const containersRetryRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopContainersWs = useCallback(() => {
    if (containersWsRef.current) {
      containersWsRef.current.close()
      containersWsRef.current = null
    }
    setContainersWsStatus("disconnected")
  }, [])

  const startContainersWs = useCallback(() => {
    if (containersWsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    stopContainersWs()
    setContainersWsStatus("connecting")

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//${window.location.host}/api/ws/containers`

    const ws = new WebSocket(wsUrl)
    containersWsRef.current = ws

    const wsTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close()
      }
    }, 5000)

    ws.onopen = () => {
      clearTimeout(wsTimeout)
      setContainersWsStatus("connected")
      if (containersPollingRef.current) {
        clearInterval(containersPollingRef.current)
        containersPollingRef.current = null
      }
      if (containersControllerRef.current) {
        containersControllerRef.current.abort()
        containersControllerRef.current = null
      }
      if (containersRetryRef.current) {
        clearInterval(containersRetryRef.current)
        containersRetryRef.current = null
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === "containers") {
          setContainers(msg.containers || [])
        }
      } catch {
        console.error("[frontend] Failed to parse containers message")
      }
    }

    ws.onerror = () => {
    }

    ws.onclose = () => {
      clearTimeout(wsTimeout)
      containersWsRef.current = null
      setContainersWsStatus("disconnected")

      if (containersPollingRef.current) return

      containersControllerRef.current = new AbortController()
      containersPollingRef.current = setInterval(async () => {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000)

          const res = await fetch("/api/containers", { signal: controller.signal })
          clearTimeout(timeoutId)

          if (!res.ok) return
          const data = await res.json()
          setContainers(data.containers || [])
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return
        }
      }, 5000)

      if (containersRetryRef.current) return

      containersRetryRef.current = setInterval(() => {
        if (containersWsRef.current?.readyState === WebSocket.OPEN) {
          if (containersRetryRef.current) {
            clearInterval(containersRetryRef.current)
            containersRetryRef.current = null
          }
          return
        }
        startContainersWs()
      }, 10000)
    }
  }, [stopContainersWs])

  const stopContainersPolling = useCallback(() => {
    if (containersPollingRef.current) {
      clearInterval(containersPollingRef.current)
      containersPollingRef.current = null
    }
    if (containersControllerRef.current) {
      containersControllerRef.current.abort()
      containersControllerRef.current = null
    }
  }, [])

  const stopLogsPolling = useCallback(() => {
    if (logsPollingRef.current) {
      clearInterval(logsPollingRef.current)
      logsPollingRef.current = null
    }
    if (logsControllerRef.current) {
      logsControllerRef.current.abort()
      logsControllerRef.current = null
    }
  }, [])

  const startLogsPolling = useCallback((containerId: string) => {
    stopLogsPolling()
    setLogsWsStatus("polling")

    logsControllerRef.current = new AbortController()

    logsPollingRef.current = setInterval(async () => {
      if (state.isPaused) return

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)

        const res = await fetch(`/api/containers/${containerId}/logs?limit=${settings.logLimit}`, { signal: controller.signal })
        clearTimeout(timeoutId)

        if (!res.ok) return
        const data = await res.json()
        dispatch({ type: "SET_LOGS", logs: data.logs || [] })
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return
      }
    }, 2000)
  }, [stopLogsPolling, settings.logLimit])

  const stopLogWs = useCallback(() => {
    if (logWsRef.current) {
      logWsRef.current.close()
      logWsRef.current = null
      logWsContainerIdRef.current = null
    }
    if (logWsTimeoutRef.current) {
      clearTimeout(logWsTimeoutRef.current)
      logWsTimeoutRef.current = null
    }
    if (logWsRetryRef.current) {
      clearInterval(logWsRetryRef.current)
      logWsRetryRef.current = null
    }
    setLogsWsStatus("polling")
  }, [])

  const startLogWs = useCallback((containerId: string) => {
    if (logWsRef.current && logWsContainerIdRef.current === containerId) {
      if (logWsRef.current.readyState === WebSocket.OPEN) {
        return
      }
      logWsRef.current.close()
    }

    stopLogWs()
    setLogsWsStatus("connecting")
    logWsContainerIdRef.current = containerId

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//${window.location.host}/api/ws/${containerId}?limit=${settings.logLimit}`

    const ws = new WebSocket(wsUrl)
    logWsRef.current = ws

    ws.onopen = async () => {
      setLogsWsStatus("ws-connected")
      if (logWsTimeoutRef.current) {
        clearTimeout(logWsTimeoutRef.current)
        logWsTimeoutRef.current = null
      }
      if (logsPollingRef.current) {
        clearInterval(logsPollingRef.current)
        logsPollingRef.current = null
      }
      if (logsControllerRef.current) {
        logsControllerRef.current.abort()
        logsControllerRef.current = null
      }
      if (logWsRetryRef.current) {
        clearInterval(logWsRetryRef.current)
        logWsRetryRef.current = null
      }

      try {
        const res = await fetch(`/api/containers/${containerId}/logs?limit=${settings.logLimit}`)
        if (res.ok) {
          const data = await res.json()
          dispatch({ type: "FORCE_SET_LOGS", logs: data.logs || [] })
        }
      } catch (err) {
        console.error("[frontend] Failed to fetch initial logs:", err)
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === "log") {
          dispatch({ type: "ADD_LOG", log: {
            id: msg.payload.id || `${msg.payload.containerId}-${msg.payload.timestamp}`,
            containerId: msg.payload.containerId,
            timestamp: typeof msg.payload.timestamp === "number"
              ? msg.payload.timestamp
              : new Date(msg.payload.timestamp).getTime(),
            message: msg.payload.message,
          }})
        } else if (msg.type === "logs_batch") {
          dispatch({ type: "FORCE_SET_LOGS", logs: msg.payload.map((l: any) => ({
            id: l.id || `${l.containerId}-${l.timestamp}`,
            containerId: l.containerId,
            timestamp: typeof l.timestamp === "number" ? l.timestamp : new Date(l.timestamp).getTime(),
            message: l.message,
          })) })
        } else if (msg.type === "container_swapped") {
          fetchContainers()
          toast({
            title: "Container swapped",
            description: `Container switched to ${msg.newContainerName}`,
          })
        }
      } catch (err) {
        console.error("[frontend] Failed to parse log message:", err, "Data:", event.data)
      }
    }

    ws.onerror = () => {
    }

    ws.onclose = (event) => {
      if (logWsRef.current === ws) {
        logWsRef.current = null
        logWsContainerIdRef.current = null
      }

      if (state.isPaused) return

      if (logsPollingRef.current) return

      startLogsPolling(containerId)

      if (logWsRetryRef.current) return

      logWsRetryRef.current = setInterval(() => {
        if (logWsRef.current?.readyState === WebSocket.OPEN) {
          if (logWsRetryRef.current) {
            clearInterval(logWsRetryRef.current)
            logWsRetryRef.current = null
          }
          return
        }
        startLogWs(containerId)
      }, 10000)
    }

    logWsTimeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close()
        startLogsPolling(containerId)
      }
    }, 5000)
  }, [stopLogWs, startLogsPolling])

  useEffect(() => {
    startContainersWs()

    return () => {
      stopContainersWs()
      if (containersPollingRef.current) {
        clearInterval(containersPollingRef.current)
        containersPollingRef.current = null
      }
      if (containersControllerRef.current) {
        containersControllerRef.current.abort()
        containersControllerRef.current = null
      }
      if (containersRetryRef.current) {
        clearInterval(containersRetryRef.current)
        containersRetryRef.current = null
      }
    }
  }, [startContainersWs, stopContainersWs])

  useEffect(() => {
    if (selectedContainerId) {
      dispatch({ type: "CLEAR_LOGS" })
      startLogWs(selectedContainerId)
    } else {
      stopLogWs()
      dispatch({ type: "CLEAR_LOGS" })
      setLogsWsStatus("not-connected")
    }

    return () => {
      stopLogWs()
      stopLogsPolling()
    }
  }, [selectedContainerId, startLogWs, stopLogWs, stopLogsPolling])

  useEffect(() => {
    if (state.isPaused) {
      stopLogWs()
      stopLogsPolling()
    } else if (selectedContainerId) {
      startLogWs(selectedContainerId)
    }
  }, [state.isPaused, selectedContainerId, startLogWs, stopLogWs, stopLogsPolling])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Settings>
        setSettings((prev) => ({ ...prev, ...parsed }))
      }
    } catch {
    }
  }, [])

  const updateSettings = (updates: Partial<Settings>) => {
    setSettings((prev) => {
      const newSettings = { ...prev, ...updates }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings))
      return newSettings
    })
  }

  useEffect(() => {
    try {
      localStorage.setItem("syntax-highlight", JSON.stringify(syntaxHighlight))
    } catch {
    }
  }, [syntaxHighlight])

  const toggleTimestamps = useCallback(() => {
    const newVal = !settings.showTimestamps
    updateSettings({ showTimestamps: newVal })
    toast({
      title: newVal ? "Timestamps shown" : "Timestamps hidden",
      description: newVal ? "Log timestamps are now visible" : "Log timestamps are now hidden",
    })
  }, [settings.showTimestamps, toast])

  const toggleHighlights = useCallback(() => {
    const newVal = !settings.showHighlights
    updateSettings({ showHighlights: newVal })
    toast({
      title: newVal ? "Highlights enabled" : "Highlights disabled",
      description: newVal ? "Log level highlights are now visible" : "Log level highlights are now hidden",
    })
  }, [settings.showHighlights, toast])

  const toggleBadges = useCallback(() => {
    const newVal = !settings.showBadges
    updateSettings({ showBadges: newVal })
    toast({
      title: newVal ? "Badges shown" : "Badges hidden",
      description: newVal ? "Log level badges are now visible" : "Log level badges are now hidden",
    })
  }, [settings.showBadges, toast])

  const toggleSyntaxHighlight = useCallback(() => {
    const newVal = !syntaxHighlight
    setSyntaxHighlight(newVal)
    toast({
      title: newVal ? "Syntax highlighting enabled" : "Syntax highlighting disabled",
      description: newVal ? "Log syntax highlighting is now active" : "Log syntax highlighting is now disabled",
    })
  }, [syntaxHighlight, toast])

  const handleAddContainer = async (containerId: string, containerName: string, alias: string, maxPeriod: number, maxLines: number, serverName: string) => {
    const id = await addContainer(containerName || containerId, alias, maxPeriod, maxLines, serverName)
    if (id) {
      selectContainer(id)
      fetchContainers()
      toast({
        title: "Container added",
        description: `Now tracking ${alias}`,
      })
    } else {
      toast({
        title: "Error",
        description: "Failed to add container",
        variant: "destructive",
      })
    }
  }

  const handleRemoveContainer = async (id: string) => {
    const container = containers.find((c) => c.id === id)
    const success = await removeContainer(id)
    if (success) {
      fetchContainers()
      if (selectedContainerId === id) {
        selectContainer(null)
      }
      toast({
        title: "Container removed",
        description: `Stopped tracking ${container?.alias || "container"}`,
      })
    }
  }

  const handleEditContainer = (container: TrackedContainer) => {
    setEditingContainer(container)
    setEditDialogOpen(true)
  }

  const handleSaveContainer = useCallback(
    async (id: string, updates: { containerName: string; alias: string; serverName: string; maxPeriod: number; maxLines: number }) => {
      try {
        const res = await fetch(`/api/containers/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        })

        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || "Failed to update container")
        }

        fetchContainers()
        toast({
          title: "Container updated",
          description: `${updates.alias} has been updated`,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update container")
      }
    },
    [fetchContainers, toast],
  )

  const selectContainer = useCallback((id: string | null) => {
    setSelectedContainerId(id)
    dispatch({ type: "CLEAR_LOGS" })
  }, [])

  const toggleFilter = useCallback((level: LogLevel) => {
    dispatch({ type: "TOGGLE_FILTER", level })
  }, [])

  const clearFilters = useCallback(() => {
    dispatch({ type: "CLEAR_FILTERS" })
  }, [])

  const setSearchQuery = useCallback((query: string) => {
    dispatch({ type: "SET_SEARCH", query })
  }, [])

  const togglePause = useCallback(() => {
    dispatch({ type: "TOGGLE_PAUSE" })
    const newPaused = !state.isPaused
    toast({
      title: newPaused ? "Streaming paused" : "Streaming resumed",
      description: newPaused ? "Log streaming has been paused" : "Log streaming has been resumed",
    })
  }, [state.isPaused, toast])

  const refreshLogs = useCallback(async () => {
    if (selectedContainerId) {
      try {
        const res = await fetch(`/api/containers/${selectedContainerId}/logs?limit=${settings.logLimit}`)
        if (res.ok) {
          const data = await res.json()
          dispatch({ type: "FORCE_SET_LOGS", logs: data.logs || [] })
          toast({
            title: "Logs refreshed",
            description: `Loaded ${data.logs?.length || 0} logs`,
          })
        }
      } catch (err) {
        console.error("[frontend] Failed to refresh logs:", err)
        toast({
          title: "Refresh failed",
          description: "Failed to load logs",
          variant: "destructive",
        })
      }
    }
  }, [selectedContainerId, settings.logLimit, toast])

  const toggleSort = useCallback(() => {
    dispatch({ type: "TOGGLE_SORT" })
    toast({
      title: `Sort ${state.sortOrder === "desc" ? "ascending" : "descending"}`,
      description: `Logs are now sorted ${state.sortOrder === "desc" ? "ascending" : "descending"}`,
    })
  }, [state.sortOrder, toast])

  const toggleFollow = useCallback(() => {
    dispatch({ type: "TOGGLE_FOLLOW" })
    toast({
      title: state.followLogs ? "Auto-scroll disabled" : "Auto-scroll enabled",
      description: state.followLogs ? "Logs will no longer auto-scroll" : "Logs will auto-scroll to newest",
    })
  }, [state.followLogs, toast])

  const addContainer = useCallback(
    async (name: string, alias?: string, maxPeriod?: number, maxLines?: number, serverName?: string): Promise<string | null> => {
      try {
        const req: AddContainerRequest = { name }
        if (alias) req.alias = alias
        if (maxPeriod) req.maxPeriod = maxPeriod
        if (maxLines) req.maxLines = maxLines
        if (serverName) req.serverName = serverName

        const res = await fetch("/api/containers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        })

        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || "Failed to add container")
        }

        const data = await res.json()
        if (data.success) {
          return data.container.id
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
        const res = await fetch(`/api/containers/${id}`, { method: "DELETE" })
        if (!res.ok) throw new Error("Failed to remove container")
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove container")
        return false
      }
    },
    [],
  )

  return (
    <div className="min-h-screen text-foreground p-4 md:p-6 bg-background">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Box className="w-6 h-6 text-green-500" />
              Container Log Viewer
            </h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Containers: </span>
                <span className={`w-2 h-2 rounded-full ${containersWsStatus === "connected" ? "bg-green-500" : containersWsStatus === "connecting" ? "bg-yellow-500 animate-pulse" : "bg-blue-500 animate-pulse"}`} />
                <span>{containersWsStatus === "connected" ? "WebSocket" : containersWsStatus === "connecting" ? "Connecting" : "Polling"}</span>
              </div>
              <span className="text-white/20">|</span>
              <div className="flex items-center gap-2">
                <span>Logs: </span>
                <span className={`w-2 h-2 rounded-full ${logsWsStatus === "ws-connected" ? "bg-green-500" : logsWsStatus === "connecting" ? "bg-yellow-500 animate-pulse" : logsWsStatus === "not-connected" ? "bg-red-500" : "bg-blue-500 animate-pulse"}`} />
                <span>{logsWsStatus === "ws-connected" ? "WebSocket" : logsWsStatus === "connecting" ? "Connecting" : logsWsStatus === "not-connected" ? "Not connected" : "Polling"}</span>
              </div>
            </div>
          </div>
          <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Container
          </Button>
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
            {error}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-card/50 border border-white/10">
            <TabsTrigger value="logs" className="gap-2">
              <Activity className="w-4 h-4" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="containers" className="gap-2">
              <Server className="w-4 h-4" />
              Containers
            </TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              <div className="flex flex-wrap gap-2 flex-1">
                <ContainerSelector
                  containers={containers}
                  selectedContainerId={selectedContainerId}
                  onSelect={selectContainer}
                />
                <div className="flex-1 min-w-[200px]">
                  <LogSearch value={state.searchQuery} onChange={setSearchQuery} />
                </div>
                <div className="relative">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input
                        type="number"
                        value={settings.logLimit}
                        onChange={(e) => updateSettings({ logLimit: Number(e.target.value) })}
                        onBlur={(e) => {
                          const val = Math.max(1, Number(e.target.value) || 1)
                          updateSettings({ logLimit: val })
                        }}
                        className="w-32 h-9 bg-card/50 border-white/10 pr-16"
                        min={1}
                      />
                    </TooltipTrigger>
                    <TooltipContent>Number of logs to display</TooltipContent>
                  </Tooltip>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">logs count</span>
                </div>
                <div className="relative">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input
                        type="number"
                        value={settings.logHeightLines}
                        onChange={(e) => updateSettings({ logHeightLines: Number(e.target.value) })}
                        onBlur={(e) => {
                          const val = Math.max(1, Number(e.target.value) || 1)
                          updateSettings({ logHeightLines: val })
                        }}
                        className="w-32 h-9 bg-card/50 border-white/10 pr-16"
                        min={1}
                      />
                    </TooltipTrigger>
                    <TooltipContent>Height of log container in lines (affects scrollbar)</TooltipContent>
                  </Tooltip>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">height (lines)</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <LogFiltersPopover
                  activeFilters={state.activeFilters}
                  onToggleFilter={toggleFilter}
                  onClearFilters={clearFilters}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleSyntaxHighlight}
                      className={`h-9 gap-2 bg-transparent ${syntaxHighlight ? "text-yellow-400 border-cyan-400/50 bg-cyan-400/10" : "text-white"}`}
                    >
                      <Code2 className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{syntaxHighlight ? "Disable syntax highlighting" : "Enable syntax highlighting"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const content = (state.logs || [])
                          .slice()
                          .sort((a, b) => a.timestamp - b.timestamp)
                          .map((log) => {
                            const date = new Date(log.timestamp)
                            const timestampStr = !isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString()
                            return `[${timestampStr}] [${getLogLevel(log.message)}] ${log.message}`
                          })
                          .join("\n")
                        const blob = new Blob([content], { type: "text/plain" })
                        const url = URL.createObjectURL(blob)
                        const link = document.createElement("a")
                        link.href = url
                        link.download = `logs-${new Date().toISOString().split("T")[0]}.txt`
                        link.click()
                        URL.revokeObjectURL(url)
                      }}
                      className="h-9 gap-2 bg-transparent text-white"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Download logs</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const content = (state.logs || [])
                          .slice()
                          .sort((a, b) => a.timestamp - b.timestamp)
                          .map((log) => {
                            const date = new Date(log.timestamp)
                            const timestampStr = !isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString()
                            return `[${timestampStr}] [${getLogLevel(log.message)}] ${log.message}`
                          })
                          .join("\n")
                        try {
                          await navigator.clipboard.writeText(content)
                          toast({
                            title: "Logs copied",
                            description: `${state.logs.length} logs copied to clipboard`,
                          })
                        } catch (err) {
                          toast({
                            title: "Copy failed",
                            description: err instanceof Error ? err.message : "Failed to copy logs to clipboard",
                            variant: "destructive",
                          })
                        }
                      }}
                      className="h-9 gap-2 bg-transparent text-white"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy logs to clipboard</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={togglePause}
                      className={`h-9 gap-2 bg-transparent ${!state.isPaused ? "text-yellow-400 border-cyan-400/50 bg-cyan-400/10" : "text-white"}`}
                    >
                      {state.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{state.isPaused ? "Resume log streaming" : "Pause log streaming"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={refreshLogs}
                      className="h-9 gap-2 bg-transparent text-white"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh logs</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleFollow}
                      className={`h-9 gap-2 bg-transparent ${state.followLogs ? "text-yellow-400 border-cyan-400/50 bg-cyan-400/10" : "text-white"}`}
                    >
                      <GitPullRequestDraft className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{state.followLogs ? "Disable auto-scroll" : "Enable auto-scroll"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleSort}
                      className="h-9 gap-2 bg-transparent text-white"
                    >
                      <ArrowUpDown className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{state.sortOrder === "desc" ? "Sort ascending" : "Sort descending"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleTimestamps}
                      className={`h-9 gap-2 bg-transparent ${settings.showTimestamps ? "text-yellow-400 border-cyan-400/50 bg-cyan-400/10" : "text-white"}`}
                    >
                      <Clock className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{settings.showTimestamps ? "Hide timestamps" : "Show timestamps"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleHighlights}
                      className={`h-9 gap-2 bg-transparent ${settings.showHighlights ? "text-yellow-400 border-cyan-400/50 bg-cyan-400/10" : "text-white"}`}
                    >
                      <Pipette className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{settings.showHighlights ? "Hide highlights" : "Show highlights"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleBadges}
                      className={`h-9 gap-2 bg-transparent ${settings.showBadges ? "text-yellow-400 border-cyan-400/50 bg-cyan-400/10" : "text-white"}`}
                    >
                      <Tags className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{settings.showBadges ? "Hide level badges" : "Show level badges"}</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <LogStream
              logs={(state.filteredLogs || []).slice(0, settings.logLimit)}
              maxHeight={settings.logHeightLines * 40}
              showHighlights={settings.showHighlights}
              showBadges={settings.showBadges}
              showTimestamps={settings.showTimestamps}
              followLogs={state.followLogs}
              sortOrder={state.sortOrder}
              syntaxHighlight={syntaxHighlight}
            />
          </TabsContent>

          <TabsContent value="containers" className="mt-4">
            <ContainerList
              containers={containers}
              onRemove={handleRemoveContainer}
              onEdit={handleEditContainer}
            />
          </TabsContent>
        </Tabs>

        <AddContainerDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          onAdd={handleAddContainer}
        />

        <EditContainerDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          container={editingContainer}
          onSave={handleSaveContainer}
        />
      </div>
    </div>
  )
}
