"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { LevelBadge } from "./level-badge"
import { LogDetailModal } from "./log-detail-modal"
import { LogContextMenu } from "./log-context-menu"
import { formatTimestamp } from "@/lib/format"
import type { LogEntry } from "@/lib/types"
import { SyntaxHighlight } from "./syntax-highlight"

interface LogStreamProps {
  logs: LogEntry[]
  maxHeight?: number
  showHighlights?: boolean
  showBadges?: boolean
  showTimestamps?: boolean
  followLogs?: boolean
  sortOrder?: "desc" | "asc"
  syntaxHighlight?: boolean
}

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

export function LogStream({ logs, maxHeight = 600, showHighlights = true, showBadges = true, showTimestamps = true, followLogs = false, sortOrder = "desc", syntaxHighlight = false }: LogStreamProps) {
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(() => followLogs)

  const logsWithLevel = useMemo(() => {
    return logs.map(log => ({
      ...log,
      level: getLogLevel(log.message)
    }))
  }, [logs])

  useEffect(() => {
    setAutoScroll(followLogs)
  }, [followLogs])

  useEffect(() => {
    if (autoScroll && scrollRef.current && followLogs) {
      if (sortOrder === "asc") {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      } else {
        scrollRef.current.scrollTop = 0
      }
    }
  }, [logs, autoScroll, followLogs, sortOrder])

  const handleScroll = () => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const maxScroll = scrollHeight - clientHeight

    if (sortOrder === "desc") {
      if (scrollTop > 50) {
        setAutoScroll(false)
      } else if (autoScroll === false && scrollTop < 10) {
        setAutoScroll(true)
      }
    } else {
      if (maxScroll - scrollTop > 50) {
        setAutoScroll(false)
      } else if (autoScroll === false && maxScroll - scrollTop < 10) {
        setAutoScroll(true)
      }
    }
  }

  const handleLogClick = (log: LogEntry & { level: string }) => {
    setSelectedLog(log)
    setModalOpen(true)
  }

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-auto backdrop-blur-sm bg-card/50 border border-white/10 rounded-md"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        <div>
          {logsWithLevel.map((log) => (
            <LogContextMenu
              key={log.id}
              log={log}
              onViewDetails={() => {
                setSelectedLog(log)
                setModalOpen(true)
              }}
            >
              <div
                onClick={() => handleLogClick(log)}
                className={`p-3 hover:bg-white/5 cursor-pointer transition-colors ${
                  showHighlights && log.level === "ERROR" ? "bg-red-500/10 border-l-2 border-red-500" :
                  showHighlights && log.level === "WARN" ? "bg-yellow-500/10 border-l-2 border-yellow-500" :
                  showHighlights && log.level === "DEBUG" ? "bg-cyan-500/10 border-l-2 border-cyan-500" :
                  showHighlights && log.level === "INFO" ? "bg-green-500/10 border-l-2 border-green-500" :
                  showHighlights && log.level === "SYSTEM" ? "bg-orange-500/10 border-l-2 border-orange-500" : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-3 flex-1 min-w-0">
                    {showTimestamps && (
                      <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                        {formatTimestamp(log.timestamp)}
                      </span>
                    )}
                    {showBadges && <LevelBadge level={log.level as "INFO" | "WARN" | "DEBUG" | "ERROR" | "SYSTEM"} />}
                    {syntaxHighlight ? (
                      <div className="text-xs flex-1 min-w-0">
                        <SyntaxHighlight code={log.message} className="!bg-transparent !p-0" />
                      </div>
                    ) : (
                      <span className="text-sm font-mono wrap-break-word">{log.message}</span>
                    )}
                  </div>
                </div>
              </div>
            </LogContextMenu>
          ))}
          {logs.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">No logs captured yet...</div>
          )}
        </div>
      </div>

      <LogDetailModal log={selectedLog} open={modalOpen} onOpenChange={setModalOpen} syntaxHighlight={syntaxHighlight} />
    </>
  )
}
