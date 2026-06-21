import { useState, useEffect, useCallback } from 'react'

// Single source of truth for settings. Practice and scoring logic read from
// here exclusively. Persisted to localStorage.
export interface Settings {
  referenceTone: boolean
  chordWindowMs: number
}

export const DEFAULT_SETTINGS: Settings = {
  referenceTone: false,
  chordWindowMs: 120,
}

const KEY = 'pianoscore.settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      // Ignore write failures (private browsing etc.)
    }
  }, [settings])

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  return { settings, update }
}
