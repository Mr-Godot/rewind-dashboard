import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { scanAllSessions, getActiveSessions } from '@/lib/scanner/session-scanner'
import type { SessionSummary } from '@/lib/parsers/types'
import { readMetadataSync } from '@/features/metadata/metadata.api'
import type { Metadata } from '@/features/metadata/metadata.types'

export const getSessionList = createServerFn({ method: 'GET' }).handler(
  async () => {
    return scanAllSessions()
  },
)

export const getActiveSessionList = createServerFn({ method: 'GET' }).handler(
  async () => {
    return getActiveSessions()
  },
)

const paginatedSessionsInputSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(5).max(100),
  search: z.string(),
  status: z.enum(['all', 'active', 'completed']),
  project: z.string(),
  sort: z.enum(['latest', 'mostActive', 'longest', 'largest', 'starred']).default('latest'),
  starFirst: z.boolean().default(true),
})

type PaginatedSessionsInput = z.infer<typeof paginatedSessionsInputSchema>

export interface PaginatedSessionsResult {
  sessions: SessionSummary[]
  totalCount: number
  totalPages: number
  page: number
  pageSize: number
  projects: string[]
}

/**
 * Pure business logic for paginating and filtering sessions.
 * Exported for testing purposes.
 */
export async function paginateAndFilterSessions(
  allSessions: SessionSummary[],
  input: PaginatedSessionsInput,
  metadata?: Metadata,
): Promise<PaginatedSessionsResult> {
  const { page, pageSize, search, status, project, sort, starFirst } = input

  // Filter out sessions from hidden projects
  const hiddenProjects = new Set(
    Object.entries(metadata?.projects ?? {})
      .filter(([, v]) => v.hidden)
      .map(([k]) => k),
  )
  if (hiddenProjects.size > 0 && !project) {
    allSessions = allSessions.filter((s) => s.isActive || !hiddenProjects.has(s.projectPath))
  }

  // Extract distinct project names from (non-hidden) set
  const projects = Array.from(
    new Set(allSessions.map((s) => s.projectName)),
  ).sort()

  // Apply filters
  let filtered = allSessions

  // Search filter
  const sessionMeta = metadata?.sessions ?? {}
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(
      (s) =>
        s.projectName.toLowerCase().includes(q) ||
        s.branch?.toLowerCase().includes(q) ||
        s.sessionId.toLowerCase().includes(q) ||
        s.cwd?.toLowerCase().includes(q) ||
        s.firstUserMessage?.toLowerCase().includes(q) ||
        sessionMeta[s.sessionId]?.customName?.toLowerCase().includes(q),
    )
  }

  // Status filter
  if (status === 'active') {
    filtered = filtered.filter((s) => s.isActive)
  } else if (status === 'completed') {
    filtered = filtered.filter((s) => !s.isActive)
  }

  // Project filter
  if (project) {
    filtered = filtered.filter((s) => s.projectName === project)
  }

  // Starred filter (when sort mode is 'starred')
  if (sort === 'starred') {
    filtered = filtered.filter((s) => sessionMeta[s.sessionId]?.pinned)
  }

  // Sort
  const projectMeta = metadata?.projects ?? {}

  if (sort === 'latest' || sort === 'starred') {
    // Pin boost only when starFirst is true
    const pinnedProjectTopSession = new Set<string>()
    if (starFirst && sort === 'latest') {
      const pinnedProjectPaths = new Set(
        Object.entries(projectMeta).filter(([, v]) => v.pinned).map(([k]) => k),
      )
      if (pinnedProjectPaths.size > 0) {
        const bestPerProject = new Map<string, { id: string; time: number }>()
        for (const s of filtered) {
          if (!pinnedProjectPaths.has(s.projectPath)) continue
          const t = new Date(s.lastActiveAt).getTime()
          const current = bestPerProject.get(s.projectPath)
          if (!current || t > current.time) {
            bestPerProject.set(s.projectPath, { id: s.sessionId, time: t })
          }
        }
        for (const v of bestPerProject.values()) pinnedProjectTopSession.add(v.id)
      }
    }

    filtered.sort((a, b) => {
      // Active sessions always first
      const aActive = a.isActive ? 1 : 0
      const bActive = b.isActive ? 1 : 0
      if (aActive !== bActive) return bActive - aActive

      if (starFirst) {
        const aPin = sessionMeta[a.sessionId]?.pinned ? 1 : 0
        const bPin = sessionMeta[b.sessionId]?.pinned ? 1 : 0
        if (aPin !== bPin) return bPin - aPin

        if (sort === 'latest') {
          const aProjPin = pinnedProjectTopSession.has(a.sessionId) ? 1 : 0
          const bProjPin = pinnedProjectTopSession.has(b.sessionId) ? 1 : 0
          if (aProjPin !== bProjPin) return bProjPin - aProjPin
        }
      }

      return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    })
  } else {
    // Literal sort — no pin boost
    filtered.sort((a, b) => {
      switch (sort) {
        case 'mostActive':
          if (a.messageCount !== b.messageCount) return b.messageCount - a.messageCount
          return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
        case 'longest':
          if (a.durationMs !== b.durationMs) return b.durationMs - a.durationMs
          return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
        case 'largest':
          if (a.fileSizeBytes !== b.fileSizeBytes) return b.fileSizeBytes - a.fileSizeBytes
          return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
        default:
          return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
      }
    })
  }

  const totalCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const clampedPage = Math.min(Math.max(1, page), totalPages)
  const start = (clampedPage - 1) * pageSize
  const end = start + pageSize
  const sessions = filtered.slice(start, end)

  return {
    sessions,
    totalCount,
    totalPages,
    page: clampedPage,
    pageSize,
    projects,
  }
}

export const getPaginatedSessions = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => paginatedSessionsInputSchema.parse(input))
  .handler(async ({ data }): Promise<PaginatedSessionsResult> => {
    const allSessions = await scanAllSessions()
    const metadata = readMetadataSync()
    return paginateAndFilterSessions(allSessions, data, metadata)
  })
