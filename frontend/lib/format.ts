export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

export function formatPacketsPerSecond(pps: number): string {
  return `${pps.toFixed(1)} pkt/s`
}

export function formatTimestamp(timestamp: number): string {
  const ms = timestamp / 1_000_000
  return new Date(ms).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  })
}

export function getLevelColor(level: string): string {
	const colors: Record<string, string> = {
		INFO: "text-green-400",
		WARN: "text-yellow-400",
		DEBUG: "text-cyan-400",
		ERROR: "text-red-400",
		SYSTEM: "text-orange-400",
	}
	return colors[level] || "text-gray-400"
}

export function getLevelBgColor(level: string): string {
	const colors: Record<string, string> = {
		INFO: "bg-green-500/20 border-green-500/30",
		WARN: "bg-yellow-500/20 border-yellow-500/30",
		DEBUG: "bg-cyan-500/20 border-cyan-500/30",
		ERROR: "bg-red-500/20 border-red-500/30",
		SYSTEM: "bg-orange-500/20 border-orange-500/30",
	}
	return colors[level] || "bg-gray-500/20 border-gray-500/30"
}

export function formatUptime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}d ${hours % 24}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}
