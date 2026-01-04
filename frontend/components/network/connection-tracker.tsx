"use client"

import { Card } from "@/components/ui/card"
import { ProtocolBadge } from "./protocol-badge"
import { formatBytes } from "@/lib/format"
import type { Connection } from "@/lib/types"
import { Badge } from "@/components/ui/badge"

interface ConnectionTrackerProps {
  connections: Connection[]
}

export function ConnectionTracker({ connections }: ConnectionTrackerProps) {
  return (
    <Card className="backdrop-blur-sm bg-card/50 border-white/10">
      <div className="p-4 border-b border-white/10">
        <h3 className="font-semibold">Active Connections</h3>
        <p className="text-sm text-muted-foreground">{connections.length} active</p>
      </div>
      <div className="divide-y divide-white/5 max-h-96 overflow-auto">
        {connections.map((conn) => (
          <div key={conn.id} className="p-3 hover:bg-white/5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <ProtocolBadge protocol={conn.protocol} />
                <Badge variant="outline" className="text-xs">
                  {conn.state}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">{((Date.now() - conn.startTime) / 1000).toFixed(0)}s</div>
            </div>
            <div className="flex items-center gap-2 text-sm font-mono mb-1">
              <span className="text-cyan-400">{conn.sourceIp}</span>
              <span className="text-muted-foreground">:</span>
              <span>{conn.sourcePort}</span>
              <span className="text-muted-foreground">↔</span>
              <span className="text-cyan-400">{conn.destIp}</span>
              <span className="text-muted-foreground">:</span>
              <span>{conn.destPort}</span>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>↓ {formatBytes(conn.bytesReceived)}</span>
              <span>↑ {formatBytes(conn.bytesSent)}</span>
            </div>
          </div>
        ))}
        {connections.length === 0 && <div className="p-8 text-center text-muted-foreground">No active connections</div>}
      </div>
    </Card>
  )
}
