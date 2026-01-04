"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil, Box, CircleFadingPlus, ServerCog, Hash, Clock, FileText } from "lucide-react"
import type { TrackedContainer } from "@/lib/types"

interface EditContainerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  container: TrackedContainer | null
  onSave: (id: string, updates: { containerName: string; alias: string; serverName: string; maxPeriod: number; maxLines: number }) => void
}

export function EditContainerDialog({ open, onOpenChange, container, onSave }: EditContainerDialogProps) {
  const [containerName, setContainerName] = useState("")
  const [alias, setAlias] = useState("")
  const [serverName, setServerName] = useState("")
  const [maxPeriod, setMaxPeriod] = useState("7")
  const [maxLines, setMaxLines] = useState("10000")

  useEffect(() => {
    if (container) {
      setContainerName(container.containerName)
      setAlias(container.alias)
      setServerName(container.serverName || "")
      setMaxPeriod(container.maxPeriod > 0 ? container.maxPeriod.toString() : "7")
      setMaxLines(container.maxLines > 0 ? container.maxLines.toString() : "10000")
    }
  }, [container])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (container && containerName.trim()) {
      onSave(container.id, {
        containerName: containerName.trim(),
        alias: alias.trim() || containerName.trim(),
        serverName: serverName.trim(),
        maxPeriod: parseInt(maxPeriod) || 7,
        maxLines: parseInt(maxLines) || 10000,
      })
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pb-4">
            Edit Container
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="editContainerId" className="flex items-center gap-2">
              <Hash className="w-4 h-4" />
              Container ID
            </Label>
            <Input
              id="editContainerId"
              value={container?.containerId || ""}
              disabled
              className="bg-muted/50 border-white/10 opacity-50"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="editContainerName" className="flex items-center gap-2">
              <Box className="w-4 h-4" />
              Container Name
            </Label>
            <Input
              id="editContainerName"
              placeholder="e.g., nginx-proxy"
              value={containerName}
              onChange={(e) => setContainerName(e.target.value)}
              required
              className="bg-card/50 border-white/10"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="editAlias" className="flex items-center gap-2">
              <CircleFadingPlus className="w-4 h-4" />
              Alias
            </Label>
            <Input
              id="editAlias"
              placeholder="e.g., Production Web Server"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              className="bg-card/50 border-white/10"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="editServerName" className="flex items-center gap-2">
              <ServerCog className="w-4 h-4" />
              Server Name
            </Label>
            <Input
              id="editServerName"
              placeholder="e.g., prod-server-01"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              className="bg-card/50 border-white/10"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="editMaxPeriod" className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Max Days
              </Label>
              <Input
                id="editMaxPeriod"
                type="number"
                min="0"
                placeholder="7"
                value={maxPeriod}
                onChange={(e) => setMaxPeriod(e.target.value)}
                className="bg-card/50 border-white/10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="editMaxLines" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Max Lines
              </Label>
              <Input
                id="editMaxLines"
                type="number"
                min="0"
                placeholder="10000"
                value={maxLines}
                onChange={(e) => setMaxLines(e.target.value)}
                className="bg-card/50 border-white/10"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="bg-transparent">
              Cancel
            </Button>
            <Button type="submit" disabled={!containerName.trim()}>
              Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
