"use client"

import { useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { TrackedContainer } from "@/lib/types"

interface ContainerSelectorProps {
  containers: TrackedContainer[]
  selectedContainerId: string | null
  onSelect: (id: string) => void
}

export function ContainerSelector({ containers, selectedContainerId, onSelect }: ContainerSelectorProps) {
  const [open, setOpen] = useState(false)

  const selectedContainer = containers.find((c) => c.id === selectedContainerId)

  return (
    <div className="flex items-center gap-2">
      <Select
        open={open}
        onOpenChange={setOpen}
        value={selectedContainerId || ""}
        onValueChange={onSelect}
      >
        <SelectTrigger className="w-[220px] bg-card/50 border-white/10">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {selectedContainer ? (
              <span className="font-medium truncate">{selectedContainer.alias}</span>
            ) : (
              <span className="text-muted-foreground">Select container...</span>
            )}
          </div>
        </SelectTrigger>
        <SelectContent>
          {containers.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No containers tracked
            </div>
          ) : (
            containers.map((container) => (
              <SelectItem key={container.id} value={container.id} className="cursor-pointer">
                <span className="font-medium">{container.alias}</span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
