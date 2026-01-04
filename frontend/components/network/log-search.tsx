"use client"

import { Input } from "@/components/ui/input"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface LogSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function LogSearch({
  value,
  onChange,
  placeholder = "Search logs..",
}: LogSearchProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-10 pr-10 bg-card/50 border-white/10"
      />
      {value && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange("")}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
        >
          <X className="w-4 h-4" />
        </Button>
      )}
    </div>
  )
}
