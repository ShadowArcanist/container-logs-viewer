"use client"

import { useRef, useState, useMemo } from "react"
import DottedMap from "dotted-map"
import Image from "next/image"
import { useTheme } from "next-themes"

interface MapProps {
  dots?: Array<{
    start: { lat: number; lng: number; label?: string }
    end: { lat: number; lng: number; label?: string }
  }>
  lineColor?: string
  showLabels?: boolean
  labelClassName?: string
  animationDuration?: number
  loop?: boolean
  locationPoints?: Array<{
    lat: number
    lng: number
    count: number
    country: string
    city: string
    level: string
  }>
  locationData?: Array<{
    lat: number
    lng: number
    country: string
    city: string
    totalCount: number
    levels: Record<string, number>
  }>
  getLevelColor?: (level: string) => string
}

export function WorldMap({
  dots = [],
  lineColor = "#0ea5e9",
  showLabels = true,
  labelClassName = "text-sm",
  animationDuration = 2,
  loop = true,
  locationPoints = [],
  locationData = [],
  getLevelColor = () => "#94a3b8",
}: MapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredLocation, setHoveredLocation] = useState<string | null>(null)
  const { theme } = useTheme()

  const map = useMemo(() => new DottedMap({ height: 100, grid: "diagonal" }), [])

  const svgMap = useMemo(
    () =>
      map.getSVG({
        radius: 0.22,
        color: "#FFFFFF20", // Light dots on dark background
        shape: "circle",
        backgroundColor: "black",
      }),
    [map],
  )

  const projectPoint = (lat: number, lng: number) => {
    const x = (lng + 180) * (800 / 360)
    const y = (90 - lat) * (400 / 180)
    return { x, y }
  }

  const getLocationInfo = (lat: number, lng: number) => {
    return locationData.find((loc) => loc.lat === lat && loc.lng === lng)
  }

  return (
    <div className="w-full aspect-[2/1] md:aspect-[2.5/1] lg:aspect-[2/1] bg-black rounded-lg relative font-sans overflow-hidden">
      <Image
        src={`data:image/svg+xml;utf8,${encodeURIComponent(svgMap)}`}
        className="h-full w-full [mask-image:linear-gradient(to_bottom,transparent,white_10%,white_90%,transparent)] pointer-events-none select-none object-cover"
        alt="world map"
        height="495"
        width="1056"
        draggable={false}
        priority
      />

      <svg viewBox="0 0 800 400" className="w-full h-full absolute inset-0" ref={svgRef}>
        {locationPoints.map((point, idx) => {
          const { x, y } = projectPoint(point.lat, point.lng)
          const size = Math.min(Math.max(point.count / 10, 3), 12)
          const locationKey = `${point.lat},${point.lng}`
          const isHovered = hoveredLocation === locationKey

          return (
            <g key={idx}>
              {/* Pulsing outer circle */}
              <circle
                cx={x}
                cy={y}
                r={size + 4}
                fill={getLevelColor(point.level)}
                opacity="0.3"
                className="animate-pulse pointer-events-none"
              />
              {/* Main marker circle - with hover */}
              <circle
                cx={x}
                cy={y}
                r={size}
                fill={getLevelColor(point.level)}
                opacity={isHovered ? "1" : "0.9"}
                className="pointer-events-auto cursor-pointer transition-opacity"
                onMouseEnter={() => setHoveredLocation(locationKey)}
                onMouseLeave={() => setHoveredLocation(null)}
              />
              {/* Inner bright dot */}
              <circle cx={x} cy={y} r={size / 2} fill="white" opacity="0.8" className="pointer-events-none" />
            </g>
          )
        })}
      </svg>

      {hoveredLocation &&
        (() => {
          const [lat, lng] = hoveredLocation.split(",").map(Number)
          const locationInfo = getLocationInfo(lat, lng)
          if (!locationInfo) return null

          const { x, y } = projectPoint(lat, lng)

          const isUpperHalf = y < 200 // Map height is 400, so 200 is middle
          const verticalOffset = isUpperHalf ? 20 : -120

          return (
            <div
              className="absolute pointer-events-none z-50"
              style={{
                left: `${(x / 800) * 100}%`,
                top: `${(y / 400) * 100}%`,
                transform: `translate(-50%, ${verticalOffset}%)`,
              }}
            >
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl min-w-[200px]">
                <div className="text-white font-semibold mb-1">
                  {locationInfo.city}, {locationInfo.country}
                </div>
                <div className="text-xs text-slate-400 mb-2">{locationInfo.totalCount} total logs</div>
                <div className="space-y-1">
                  {Object.entries(locationInfo.levels)
                    .sort(([, a], [, b]) => b - a)
                    .map(([level, count]) => (
                      <div key={level} className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: getLevelColor(level) }}
                          ></div>
                          <span className="text-xs text-slate-300">{level}</span>
                        </div>
                        <span className="text-xs text-slate-400">{count}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )
        })()}
    </div>
  )
}
