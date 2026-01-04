"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Trash2, Pencil, Activity } from "lucide-react"
import type { TrackedContainer } from "@/lib/types"

interface ContainerListProps {
  containers: TrackedContainer[]
  onRemove: (id: string) => void
  onEdit: (container: TrackedContainer) => void
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + "..."
}

export function ContainerList({ containers, onRemove, onEdit }: ContainerListProps) {
  if (containers.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground border border-dashed border-white/10 rounded-lg">
        <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>No containers tracked yet</p>
        <p className="text-sm">Add a container to start monitoring its logs</p>
      </div>
    )
  }

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden backdrop-blur-sm bg-card/50">
      <Table>
        <TableHeader>
          <TableRow className="border-white/10 hover:bg-white/5 bg-gray-500/10">
            <TableHead className="text-muted-foreground">ID</TableHead>
            <TableHead className="text-muted-foreground">Name</TableHead>
            <TableHead className="text-muted-foreground">Alias</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            <TableHead className="text-muted-foreground">Server</TableHead>
            <TableHead className="text-muted-foreground">Added on</TableHead>
            <TableHead className="text-muted-foreground">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {containers.map((container) => (
            <TableRow
              key={container.id}
              className="border-white/10"
            >

            <TableCell className="font-mono text-xs text-muted-foreground">
              {container.containerId.substring(0, 12)}
            </TableCell>
            <TableCell className="font-mono font-medium truncate max-w-[200px]" title={container.containerName}>
              {truncateText(container.containerName, 30)}
            </TableCell>
            <TableCell className="font-mono truncate max-w-[200px]" title={container.alias}>
              {truncateText(container.alias, 30)}
            </TableCell>
            <TableCell className="font-mono">
              <Badge
                variant="outline"
                className={`${
                  container.status === "running"
                    ? "bg-green-500/20 border-green-500/30 text-green-400"
                    : container.status === "exited"
                    ? "bg-red-500/20 border-red-500/30 text-red-400"
                    : container.status === "restarting"
                    ? "bg-yellow-500/20 border-yellow-500/30 text-yellow-400"
                    : container.status === "stopped"
                    ? "bg-orange-500/20 border-orange-500/30 text-orange-400"
                    : "bg-gray-500/20 border-gray-500/30 text-gray-400"
                }`}
              >
                {container.status}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-muted-foreground">{container.serverName || "-"}</TableCell>
            <TableCell className="font-mono text-muted-foreground">
              {new Date(container.addedAt * 1000).toLocaleDateString()}
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(container)
                    }}
                    className="hover:bg-cyan-500/20"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(container.id)
                    }}
                    className="hover:bg-red-500/20 text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
