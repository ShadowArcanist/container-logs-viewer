"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, ServerCog, CircleFadingPlus, Clock, List, Box } from "lucide-react"

interface AddContainerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (containerId: string, containerName: string, alias: string, maxPeriod: number, maxLines: number, serverName: string) => void
}

export function AddContainerDialog({ open, onOpenChange, onAdd }: AddContainerDialogProps) {
  const [containerName, setContainerName] = useState("")
  const [alias, setAlias] = useState("")
  const [maxPeriod, setMaxPeriod] = useState("7")
  const [maxLines, setMaxLines] = useState("10000")
  const [serverName, setServerName] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (containerName.trim() && alias.trim()) {
      const containerId = crypto.randomUUID().substring(0, 12)
      onAdd(
        containerId,
        containerName.trim(),
        alias.trim(),
        parseInt(maxPeriod) || 7,
        parseInt(maxLines) || 10000,
        serverName.trim()
      )
      setContainerName("")
      setAlias("")
      setMaxPeriod("7")
      setMaxLines("10000")
      setServerName("")
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pb-4">
            Add Container
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="containerName" className="flex items-center gap-2">
              <Box className="w-4 h-4" />
              Container Name
            </Label>
            <Input
              id="containerName"
              placeholder="e.g., nginx-proxy"
              value={containerName}
              onChange={(e) => setContainerName(e.target.value)}
              required
              className="bg-card/50 border-white/10"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="alias" className="flex items-center gap-2">
              <CircleFadingPlus className="w-4 h-4" />
              Alias
            </Label>
            <Input
              id="alias"
              placeholder="e.g., Production Web Server"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              required
              className="bg-card/50 border-white/10"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="maxPeriod" className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Max Period (days)
              </Label>
              <Input
                id="maxPeriod"
                type="number"
                min="1"
                value={maxPeriod}
                onChange={(e) => setMaxPeriod(e.target.value)}
                className="bg-card/50 border-white/10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxLines" className="flex items-center gap-2">
                <List className="w-4 h-4" />
                Max Lines
              </Label>
              <Input
                id="maxLines"
                type="number"
                min="1"
                value={maxLines}
                onChange={(e) => setMaxLines(e.target.value)}
                className="bg-card/50 border-white/10"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="serverName" className="flex items-center gap-2">
              <ServerCog className="w-4 h-4" />
              Server Name (optional)
            </Label>
            <Input
              id="serverName"
              placeholder="e.g., prod-server-01"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              className="bg-card/50 border-white/10"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="bg-transparent">
              Cancel
            </Button>
            <Button type="submit" disabled={!containerName.trim() || !alias.trim()}>
              Add Container
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
