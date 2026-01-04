import { getLevelBgColor, getLevelColor } from "@/lib/format"
import type { LogLevel } from "@/lib/types"

interface LevelBadgeProps {
  level: LogLevel
  className?: string
}

export function LevelBadge({ level, className = "" }: LevelBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 rounded text-xs font-mono font-medium border ${getLevelBgColor(level)} ${getLevelColor(level)} ${className}`}
    >
      {level}
    </span>
  )
}
