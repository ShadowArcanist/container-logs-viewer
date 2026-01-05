"use client"

import { useState, useEffect, useCallback } from "react"
import type { TrackedContainer } from "@/lib/types"

const STORAGE_KEY = "tracked-containers"
const SELECTED_CONTAINER_KEY = "selected-container"

interface ContainerState extends TrackedContainer {
  lastSeen: number
}

export function useContainerTracker() {
  const [containers, setContainers] = useState<ContainerState[]>([])
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as TrackedContainer[]
        const now = Date.now()
        setContainers(
          parsed.map((c) => ({
            ...c,
            lastSeen: now,
            uptime: now - c.addedAt,
            maxPeriod: c.maxPeriod ?? 7,
            maxLines: c.maxLines ?? 10000,
            serverName: c.serverName ?? "",
          })),
        )
      }

      const savedSelected = localStorage.getItem(SELECTED_CONTAINER_KEY)
      if (savedSelected) {
        setSelectedContainerId(savedSelected)
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setContainers((prev) =>
        prev.map((c) => ({
          ...c,
          uptime: Date.now() - c.addedAt,
        })),
      )
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const saveContainers = useCallback((newContainers: ContainerState[]) => {
    const toSave = newContainers.map(({ lastSeen, ...rest }) => rest)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  }, [])

  const addContainer = useCallback(
    (containerId: string, containerName: string, alias: string, maxPeriod: number, maxLines: number, serverName: string) => {
      const newContainer: ContainerState = {
        id: crypto.randomUUID(),
        containerId,
        containerName,
        alias,
        addedAt: Date.now(),
        uptime: 0,
        status: "running",
        lastSeen: Date.now(),
        maxPeriod,
        maxLines,
        serverName,
      }

      setContainers((prev) => {
        const updated = [...prev, newContainer]
        saveContainers(updated)
        return updated
      })

      return newContainer.id
    },
    [saveContainers],
  )

  const removeContainer = useCallback(
    (id: string) => {
      setContainers((prev) => {
        const updated = prev.filter((c) => c.id !== id)
        saveContainers(updated)
        return updated
      })

      if (selectedContainerId === id) {
        setSelectedContainerId(null)
        localStorage.removeItem(SELECTED_CONTAINER_KEY)
      }
    },
    [saveContainers, selectedContainerId],
  )

  const updateContainer = useCallback(
    (id: string, updates: Partial<TrackedContainer>) => {
      setContainers((prev) => {
        const updated = prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
        saveContainers(updated)
        return updated
      })
    },
    [saveContainers],
  )

  const selectContainer = useCallback((id: string | null) => {
    setSelectedContainerId(id)
    if (id) {
      localStorage.setItem(SELECTED_CONTAINER_KEY, id)
    } else {
      localStorage.removeItem(SELECTED_CONTAINER_KEY)
    }
  }, [])

  const getContainerById = useCallback(
    (id: string) => containers.find((c) => c.id === id),
    [containers],
  )

  return {
    containers,
    selectedContainerId,
    loading,
    addContainer,
    removeContainer,
    updateContainer,
    selectContainer,
    getContainerById,
  }
}
