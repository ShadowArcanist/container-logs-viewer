"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { LevelBadge } from "./level-badge"
import { formatTimestamp } from "@/lib/format"
import type { LogEntry } from "@/lib/types"
import { Copy, Check } from "lucide-react"
import { SyntaxHighlight } from "./syntax-highlight"

interface LogDetailModalProps {
  log: LogEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  syntaxHighlight?: boolean
}

function getLogLevel(message: string): "INFO" | "WARN" | "DEBUG" | "ERROR" | "SYSTEM" {
	const msg = message.toUpperCase()
	if (msg.includes("SYSTEM")) {
		return "SYSTEM"
	}
	if (msg.includes("ERROR") || msg.includes("ERR]") || msg.includes("FATAL") || msg.includes("CRITICAL")) {
		return "ERROR"
	}
	if (msg.includes("WARN") || msg.includes("WARNING")) {
		return "WARN"
	}
	if (msg.includes("DEBUG") || msg.includes("DBG]")) {
		return "DEBUG"
	}
	return "INFO"
}

export function LogDetailModal({ log, open, onOpenChange, syntaxHighlight = false }: LogDetailModalProps) {
  const [copied, setCopied] = useState(false)
  if (!log) return null

  const level = getLogLevel(log.message)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full bg-card/95 backdrop-blur-xl border-white/10 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Log Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 font-mono text-sm">
          <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-muted-foreground mb-1">Level</div>
                <LevelBadge level={level} />
              </div>
            <div>
              <div className="text-muted-foreground mb-1">Timestamp</div>
              <div>{formatTimestamp(log.timestamp)}</div>
            </div>
          </div>

          <div className="space-y-3 p-4 rounded-lg bg-black/20 border border-white/5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Log</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(log.message)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="p-2 rounded bg-white/10 hover:bg-white/20 transition-colors"
                title="Copy to clipboard"
              >
                {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <div className="p-3 rounded bg-black/40 border border-white/5 w-full">
              {syntaxHighlight ? (
                <div className="w-full break-words">
                  <SyntaxHighlight code={log.message} />
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words">
                  {log.message}
                </pre>
              )}
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  )
}
