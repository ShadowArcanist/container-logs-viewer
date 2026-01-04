"use client"

import { formatBytes } from "@/lib/format"

interface BandwidthMeterProps {
  label: string
  value: number
  max: number
  color: string
}

export function BandwidthMeter({ label, value, max, color }: BandwidthMeterProps) {
  const percentage = Math.min((value / max) * 100, 100)
  const radius = 45
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percentage / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90">
          <circle cx="56" cy="56" r={radius} className="fill-none stroke-white/5" strokeWidth="8" />
          <circle
            cx="56"
            cy="56"
            r={radius}
            className={`fill-none ${color} transition-all duration-500`}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold font-mono">{percentage.toFixed(0)}%</span>
          <span className="text-xs text-muted-foreground">{formatBytes(value)}/s</span>
        </div>
      </div>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}
