"use client"

import type React from "react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Copy, Eye, FileText, Terminal } from "lucide-react"
import type { LogEntry } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

interface LogContextMenuProps {
  log: LogEntry
  onViewDetails: () => void
  children: React.ReactNode
}

export function LogContextMenu({ log, onViewDetails, children }: LogContextMenuProps) {
  const { toast } = useToast()

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast({
      title: "Copied",
      description: `${label} copied to clipboard`,
    })
  }

  const handleCopyMessage = () => {
    copyToClipboard(log.message, "Log message")
  }

  const handleCopyFullLog = () => {
    copyToClipboard(JSON.stringify(log, null, 2), "Full log entry")
  }

  const handleExportLog = () => {
    const dataStr = JSON.stringify(log, null, 2)
    const dataBlob = new Blob([dataStr], { type: "application/json" })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement("a")
    link.href = url
    link.download = `log-${log.id}.json`
    link.click()
    URL.revokeObjectURL(url)

    toast({
      title: "Exported",
      description: "Log entry exported successfully",
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56 bg-slate-900 border-slate-700">
        <ContextMenuItem onClick={onViewDetails} className="cursor-pointer">
          <Eye className="mr-2 h-4 w-4" />
          <span>View Details</span>
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-slate-700" />
        <ContextMenuItem onClick={handleCopyMessage} className="cursor-pointer">
          <Terminal className="mr-2 h-4 w-4" />
          <span>Copy Message</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopyFullLog} className="cursor-pointer">
          <Copy className="mr-2 h-4 w-4" />
          <span>Copy Full Log</span>
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-slate-700" />
        <ContextMenuItem onClick={handleExportLog} className="cursor-pointer">
          <FileText className="mr-2 h-4 w-4" />
          <span>Export Log</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
