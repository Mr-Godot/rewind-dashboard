import { useCallback, useState } from 'react'
import { STATUS_OPTIONS, SORT_OPTIONS, VIEW_OPTIONS } from '@/routes/_dashboard/sessions/index'

const STORAGE_KEY = 'claude-dashboard:session-filters'

type Status = (typeof STATUS_OPTIONS)[number]
type Sort = (typeof SORT_OPTIONS)[number]
type View = (typeof VIEW_OPTIONS)[number]

export interface StoredFilters {
  status?: Status
  sort?: Sort
  starFirst?: boolean
  view?: View
  project?: string
}

const PERSISTED_KEYS = ['status', 'sort', 'starFirst', 'view', 'project'] as const

function readStoredFilters(): StoredFilters {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    const result: StoredFilters = {}
    if (typeof parsed.status === 'string' && (STATUS_OPTIONS as readonly string[]).includes(parsed.status)) {
      result.status = parsed.status as Status
    }
    if (typeof parsed.sort === 'string' && (SORT_OPTIONS as readonly string[]).includes(parsed.sort)) {
      result.sort = parsed.sort as Sort
    }
    if (typeof parsed.starFirst === 'boolean') {
      result.starFirst = parsed.starFirst
    }
    if (typeof parsed.view === 'string' && (VIEW_OPTIONS as readonly string[]).includes(parsed.view)) {
      result.view = parsed.view as View
    }
    if (typeof parsed.project === 'string') {
      result.project = parsed.project
    }
    return result
  } catch {
    // localStorage unavailable or malformed JSON
    return {}
  }
}

/**
 * True only when NONE of the persisted filter keys are present in the URL
 * search string AND there is at least one stored filter to rehydrate.
 */
export function shouldRehydrate(
  rawSearchString: string,
  storedFilters: StoredFilters,
): boolean {
  if (!storedFilters || Object.keys(storedFilters).length === 0) return false
  const params = new URLSearchParams(rawSearchString)
  for (const key of PERSISTED_KEYS) {
    if (params.has(key)) return false
  }
  return true
}

/** Returns the project if it is still in the list, otherwise '' (all projects). */
export function reconcileStoredProject(project: string, projectList: string[]): string {
  if (!project) return ''
  return projectList.includes(project) ? project : ''
}

interface SessionFilterPreferences {
  /** Snapshot of stored filters read once on mount (empty when none/invalid) */
  storedFilters: StoredFilters
  /** Merge and persist a partial set of filters to localStorage */
  persistFilters: (partial: StoredFilters) => void
}

export function useSessionFilterPreferences(): SessionFilterPreferences {
  // Lazy initializer: read from localStorage on mount (client-side only)
  const [storedFilters] = useState<StoredFilters>(readStoredFilters)

  const persistFilters = useCallback((partial: StoredFilters) => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      let existing: StoredFilters = {}
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') existing = parsed as StoredFilters
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, ...partial }))
    } catch {
      // Ignore write failures
    }
  }, [])

  return { storedFilters, persistFilters }
}

export { STORAGE_KEY }
