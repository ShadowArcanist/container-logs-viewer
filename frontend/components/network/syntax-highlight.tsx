"use client"

import { useEffect, useState } from "react"
import { createHighlighter } from "shiki"

interface SyntaxHighlightProps {
  code: string
  language?: string
  className?: string
}

let highlighterInstance: Awaited<ReturnType<typeof createHighlighter>> | null = null
let initPromise: Promise<Awaited<ReturnType<typeof createHighlighter>>> | null = null

async function getHighlighter() {
  if (!initPromise) {
    initPromise = createHighlighter({
      themes: ["catppuccin-frappe"],
      langs: ["json", "plaintext", "bash", "javascript", "typescript"]
    }).then(h => {
      highlighterInstance = h
      return h
    })
  }
  return initPromise
}

export function SyntaxHighlight({ code, language = "json", className = "" }: SyntaxHighlightProps) {
  const [highlightedCode, setHighlightedCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadHighlighter() {
      try {
        const highlighter = await getHighlighter()

        if (cancelled) return

        const isJson = language === "json" || (
          code.trim().startsWith("{") ||
          code.trim().startsWith("[") ||
          code.includes('"')
        )
        const langToUse = isJson ? "json" : "plaintext"

        const html = highlighter.codeToHtml(code, {
          lang: langToUse,
          theme: "catppuccin-frappe",
          structure: 'inline'
        })
        setHighlightedCode(html)
        setLoading(false)
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to highlight code:", error)
          setLoading(false)
        }
      }
    }

    loadHighlighter()

    return () => {
      cancelled = true
    }
  }, [code, language])

  if (loading) {
    return (
      <code className={`text-sm font-mono break-words ${className}`}>
        {code}
      </code>
    )
  }

  if (!highlightedCode) {
    return (
      <code className={`text-sm font-mono break-words ${className}`}>
        {code}
      </code>
    )
  }

  return (
    <div className={`text-sm font-mono shiki ${className}`} dangerouslySetInnerHTML={{ __html: highlightedCode }} />
  )
}
