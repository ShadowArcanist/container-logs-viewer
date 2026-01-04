"use client"

import * as React from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Filter } from "lucide-react"
import type { LogLevel } from "@/lib/types"

const ALL_LEVELS: LogLevel[] = ["INFO", "WARN", "DEBUG", "ERROR", "SYSTEM"]

interface LogFiltersPopoverProps {
  activeFilters: Set<LogLevel>
  onToggleFilter: (level: LogLevel) => void
  onClearFilters: () => void
}

export function LogFiltersPopover({ activeFilters, onToggleFilter, onClearFilters }: LogFiltersPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 bg-transparent text-white"
          title="Filter logs by level (INFO, WARN, DEBUG, ERROR, SYSTEM)"
        >
          <Filter className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Log Filters</span>
            {activeFilters.size > 0 && activeFilters.size < ALL_LEVELS.length && (
              <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-7 text-xs px-2">
                Clear
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {ALL_LEVELS.map((level) => {
              const isActive = activeFilters.has(level)
              return (
                <label
                  key={level}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-white/5 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={isActive}
                    onCheckedChange={() => onToggleFilter(level)}
                    id={`filter-${level}`}
                  />
                  <span
                    className="text-sm font-mono"
                  >
                    {level}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
