"use client"

import { useEffect, useCallback, useReducer } from "react"
import { generateLog } from "@/lib/log-generator"
import type { LogEntry, LogLevel } from "@/lib/types"

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
  | { type: "TOGGLE_FILTER"; level: LogLevel }
  | { type: "CLEAR_FILTERS" }
  | { type: "SET_SEARCH"; query: string }
  | { type: "TOGGLE_PAUSE" }
  | { type: "CLEAR_LOGS" }
  | { type: "LOAD_FILTERS"; filters: Set<LogLevel> }
  | { type: "TOGGLE_SORT" }
  | { type: "TOGGLE_FOLLOW" }
  | { type: "LOAD_STATE"; state: Partial<LogState> }

const MAX_LOGS = 500
const STORAGE_KEY = "container-logger-filters"
const SEARCH_KEY = "container-logger-search"

function filterLogs(logs: LogEntry[], filters: Set<LogLevel>, searchQuery: string, sortOrder: "desc" | "asc" = "desc"): LogEntry[] {
  let filtered = logs

  if (filters.size > 0) {
    filtered = filtered.filter((l) => filters.has(l.level))
  }

  if (searchQuery) {
    const query = searchQuery.toLowerCase()
    filtered = filtered.filter(
      (l) =>
        l.message.toLowerCase().includes(query) ||
        l.service.toLowerCase().includes(query) ||
        l.level.toLowerCase().includes(query) ||
        (l.ip && l.ip.toLowerCase().includes(query)) ||
        (l.path && l.path.toLowerCase().includes(query)),
    )
  }

  return filtered.sort((a, b) => sortOrder === "desc" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp)
}

function logReducer(state: LogState, action: LogAction): LogState {
  switch (action.type) {
    case "ADD_LOG": {
      const newLogs = [action.log, ...state.logs].slice(0, MAX_LOGS)
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(newFilters)))
      const filteredLogs = filterLogs(state.logs, newFilters, state.searchQuery, state.sortOrder)
      return { ...state, activeFilters: newFilters, filteredLogs }
    }
    case "CLEAR_FILTERS": {
      localStorage.removeItem(STORAGE_KEY)
      const filteredLogs = filterLogs(state.logs, new Set<LogLevel>(["INFO", "WARN", "DEBUG", "ERROR"]), state.searchQuery, state.sortOrder)
      return { ...state, activeFilters: new Set<LogLevel>(["INFO", "WARN", "DEBUG", "ERROR"]), filteredLogs }
    }
    case "SET_SEARCH": {
      localStorage.setItem(SEARCH_KEY, action.query)
      const filteredLogs = filterLogs(state.logs, state.activeFilters, action.query, state.sortOrder)
      return { ...state, searchQuery: action.query, filteredLogs }
    }
    case "TOGGLE_PAUSE": {
      return { ...state, isPaused: !state.isPaused }
    }
    case "CLEAR_LOGS": {
      return { ...state, logs: [], filteredLogs: [] }
    }
    case "LOAD_FILTERS": {
      const savedSearch = localStorage.getItem(SEARCH_KEY) || ""
      const filteredLogs = filterLogs(state.logs, action.filters, savedSearch, state.sortOrder)
      return { ...state, activeFilters: action.filters, searchQuery: savedSearch, filteredLogs }
    }
    case "TOGGLE_SORT": {
      const newSortOrder = state.sortOrder === "desc" ? "asc" : "desc"
      const sortedFilteredLogs = [...state.filteredLogs].sort((a, b) => 
        newSortOrder === "desc" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
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

export function useLogStream(intervalMs = 300) {
  const ALL_LEVELS: LogLevel[] = ["INFO", "WARN", "DEBUG", "ERROR"]
  
  const initialState: LogState = {
    logs: [],
    filteredLogs: [],
    activeFilters: new Set<LogLevel>(ALL_LEVELS),
    searchQuery: "",
    isPaused: false,
    sortOrder: "desc",
    followLogs: false,
  }
  const [state, dispatch] = useReducer(logReducer, initialState)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsedFilters = JSON.parse(saved) as LogLevel[]
        const filters = new Set<LogLevel>(parsedFilters)
        dispatch({ type: "LOAD_FILTERS", filters })
      }
    } catch (error) {
      console.error("Failed to load filters:", error)
    }
  }, [])

  useEffect(() => {
    if (state.isPaused) return

    const interval = setInterval(() => {
      const log = generateLog()
      dispatch({ type: "ADD_LOG", log })
    }, intervalMs)

    return () => clearInterval(interval)
  }, [intervalMs, state.isPaused])

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
  }, [])

  const clearLogs = useCallback(() => {
    dispatch({ type: "CLEAR_LOGS" })
  }, [])

  const refreshLogs = useCallback(() => {
    const log = generateLog()
    dispatch({ type: "ADD_LOG", log })
  }, [])

  const toggleSort = useCallback(() => {
    dispatch({ type: "TOGGLE_SORT" })
  }, [])

  const toggleFollow = useCallback(() => {
    dispatch({ type: "TOGGLE_FOLLOW" })
  }, [])

  return {
    logs: state.filteredLogs,
    allLogs: state.logs,
    activeFilters: state.activeFilters,
    searchQuery: state.searchQuery,
    isPaused: state.isPaused,
    sortOrder: state.sortOrder,
    followLogs: state.followLogs,
    toggleFilter,
    clearFilters,
    setSearchQuery,
    togglePause,
    clearLogs,
    refreshLogs,
    toggleSort,
    toggleFollow,
  }
}
