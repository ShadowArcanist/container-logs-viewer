"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { LogLevel } from "@/lib/types"
import { getLevelColor } from "@/lib/format"

const ALL_LEVELS: LogLevel[] = ["INFO", "WARN", "DEBUG", "ERROR", "SYSTEM"]

interface LevelFiltersProps {
  activeFilters: Set<LogLevel>
  onToggleFilter: (level: LogLevel) => void
  onClearFilters: () => void
}

export function LevelFilters({ activeFilters, onToggleFilter, onClearFilters }: LevelFiltersProps) {
  return (
    <Card className="p-4 backdrop-blur-sm bg-card/50 border-white/10">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Log Level Filters</h3>
        {activeFilters.size > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-7 text-xs">
            Clear All
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {ALL_LEVELS.map((level) => {
          const isActive = activeFilters.has(level)
          return (
            <Button
              key={level}
              variant={isActive ? "default" : "outline"}
              size="sm"
              onClick={() => onToggleFilter(level)}
              className={`h-8 font-mono text-xs ${isActive ? "" : "bg-transparent hover:bg-white/10"}`}
            >
              <span className={isActive ? "" : getLevelColor(level)}>{level}</span>
              {isActive && (
                <Badge variant="secondary" className="ml-2 h-4 px-1 text-xs">
                  Active
                </Badge>
              )}
            </Button>
          )
        })}
      </div>
    </Card>
  )
}
