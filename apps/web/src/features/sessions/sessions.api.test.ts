import { describe, it, expect } from 'vitest'
import type { SessionSummary } from '@/lib/parsers/types'
import type { Metadata } from '@/features/metadata/metadata.types'
import { paginateAndFilterSessions } from './sessions.api'

describe('paginateAndFilterSessions', () => {
  const createMockSession = (
    overrides: Partial<SessionSummary> = {},
  ): SessionSummary => ({
    sessionId: `session-${Math.random()}`,
    projectDir: '-path-to-project',
    projectPath: '/path/to/project',
    projectName: 'test-project',
    branch: 'main',
    cwd: '/path/to/project',
    startedAt: '2026-01-01T10:00:00Z',
    lastActiveAt: '2026-01-01T11:00:00Z',
    durationMs: 3600000,
    messageCount: 10,
    userMessageCount: 5,
    assistantMessageCount: 5,
    isActive: false,
    sessionState: 'inactive' as const,
    model: 'claude-opus-4-6',
    version: '1.0.0',
    fileSizeBytes: 1024,
    totalTokens: 0,
    firstUserMessage: null,
    claudeName: null,
    ...overrides,
  })

  describe('search filter', () => {
    it('should filter by projectName (case-insensitive)', async () => {
      const sessions = [
        createMockSession({ projectName: 'MyProject' }),
        createMockSession({ projectName: 'OtherProject' }),
        createMockSession({ projectName: 'AnotherProject' }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: 'myproject',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0].projectName).toBe('MyProject')
      expect(result.totalCount).toBe(1)
    })

    it('should filter by branch (case-insensitive)', async () => {
      const sessions = [
        createMockSession({ branch: 'feature/auth' }),
        createMockSession({ branch: 'main' }),
        createMockSession({ branch: 'feature/dashboard' }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: 'FEATURE',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(2)
      expect(result.totalCount).toBe(2)
    })

    it('should filter by sessionId (case-insensitive)', async () => {
      const sessions = [
        createMockSession({ sessionId: 'abc123' }),
        createMockSession({ sessionId: 'def456' }),
        createMockSession({ sessionId: 'ghi789' }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: 'ABC',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0].sessionId).toBe('abc123')
    })

    it('should filter by cwd (case-insensitive)', async () => {
      const sessions = [
        createMockSession({ cwd: '/Users/name/projects/web' }),
        createMockSession({ cwd: '/Users/name/projects/api' }),
        createMockSession({ cwd: null }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: 'WEB',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0].cwd).toBe('/Users/name/projects/web')
    })

    it('should handle null values gracefully', async () => {
      const sessions = [
        createMockSession({ branch: null, cwd: null }),
        createMockSession({ branch: 'main', cwd: '/path' }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: 'main',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0].branch).toBe('main')
    })

    it('should return all sessions when search is empty', async () => {
      const sessions = [
        createMockSession({ projectName: 'Project1' }),
        createMockSession({ projectName: 'Project2' }),
        createMockSession({ projectName: 'Project3' }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(3)
      expect(result.totalCount).toBe(3)
    })
  })

  describe('status filter', () => {
    it('should filter active sessions when status is "active"', async () => {
      const sessions = [
        createMockSession({ isActive: true }),
        createMockSession({ isActive: false }),
        createMockSession({ isActive: true }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'active',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(2)
      expect(result.sessions.every((s) => s.isActive)).toBe(true)
      expect(result.totalCount).toBe(2)
    })

    it('should filter completed sessions when status is "completed"', async () => {
      const sessions = [
        createMockSession({ isActive: true }),
        createMockSession({ isActive: false }),
        createMockSession({ isActive: false }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'completed',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(2)
      expect(result.sessions.every((s) => !s.isActive)).toBe(true)
      expect(result.totalCount).toBe(2)
    })

    it('should return all sessions when status is "all"', async () => {
      const sessions = [
        createMockSession({ isActive: true }),
        createMockSession({ isActive: false }),
        createMockSession({ isActive: true }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(3)
      expect(result.totalCount).toBe(3)
    })
  })

  describe('project filter', () => {
    it('should filter by exact project name match', async () => {
      const sessions = [
        createMockSession({ projectName: 'project-a' }),
        createMockSession({ projectName: 'project-b' }),
        createMockSession({ projectName: 'project-a-fork' }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'all',
        project: 'project-a',
        sort: 'latest' as const,
        starFirst: true,
      })

      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0].projectName).toBe('project-a')
      expect(result.totalCount).toBe(1)
    })

    it('should return all sessions when project filter is empty', async () => {
      const sessions = [
        createMockSession({ projectName: 'project-a' }),
        createMockSession({ projectName: 'project-b' }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(2)
      expect(result.totalCount).toBe(2)
    })
  })

  describe('combined filters', () => {
    it('should apply search, status, and project filters together', async () => {
      const sessions = [
        createMockSession({
          projectName: 'web-app',
          branch: 'feature/auth',
          isActive: true,
        }),
        createMockSession({
          projectName: 'web-app',
          branch: 'main',
          isActive: false,
        }),
        createMockSession({
          projectName: 'api',
          branch: 'feature/auth',
          isActive: true,
        }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: 'auth',
        status: 'active',
        project: 'web-app',
        sort: 'latest' as const,
        starFirst: true,
      })

      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0].projectName).toBe('web-app')
      expect(result.sessions[0].branch).toBe('feature/auth')
      expect(result.sessions[0].isActive).toBe(true)
    })
  })

  describe('pagination', () => {
    it('should paginate results correctly', async () => {
      const sessions = Array.from({ length: 25 }, (_, i) =>
        createMockSession({ sessionId: `session-${i}` }),
      )

      const page1 = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(page1.sessions).toHaveLength(10)
      expect(page1.sessions[0].sessionId).toBe('session-0')
      expect(page1.sessions[9].sessionId).toBe('session-9')
      expect(page1.totalCount).toBe(25)
      expect(page1.totalPages).toBe(3)
      expect(page1.page).toBe(1)

      const page2 = await paginateAndFilterSessions(sessions, {
        page: 2,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(page2.sessions).toHaveLength(10)
      expect(page2.sessions[0].sessionId).toBe('session-10')
      expect(page2.sessions[9].sessionId).toBe('session-19')
      expect(page2.page).toBe(2)

      const page3 = await paginateAndFilterSessions(sessions, {
        page: 3,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(page3.sessions).toHaveLength(5)
      expect(page3.sessions[0].sessionId).toBe('session-20')
      expect(page3.sessions[4].sessionId).toBe('session-24')
      expect(page3.page).toBe(3)
    })

    it('should calculate totalPages correctly', async () => {
      const testCases = [
        { total: 0, pageSize: 10, expected: 1 },
        { total: 1, pageSize: 10, expected: 1 },
        { total: 10, pageSize: 10, expected: 1 },
        { total: 11, pageSize: 10, expected: 2 },
        { total: 20, pageSize: 10, expected: 2 },
        { total: 21, pageSize: 10, expected: 3 },
        { total: 100, pageSize: 25, expected: 4 },
      ]

      for (const { total, pageSize, expected } of testCases) {
        const sessions = Array.from({ length: total }, (_, i) =>
          createMockSession({ sessionId: `session-${i}` }),
        )

        const result = await paginateAndFilterSessions(sessions, {
          page: 1,
          pageSize,
          search: '',
          status: 'all',
          project: '', sort: 'latest' as const, starFirst: true,
        })

        expect(result.totalPages).toBe(expected)
      }
    })

    it('should clamp page number to valid range', async () => {
      const sessions = Array.from({ length: 25 }, (_, i) =>
        createMockSession({ sessionId: `session-${i}` }),
      )

      // Page beyond total should clamp to last page
      const beyondResult = await paginateAndFilterSessions(sessions, {
        page: 999,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(beyondResult.page).toBe(3) // Last page
      expect(beyondResult.sessions).toHaveLength(5)
      expect(beyondResult.sessions[0].sessionId).toBe('session-20')

      // Page 0 or negative should clamp to 1
      const negativeResult = await paginateAndFilterSessions(sessions, {
        page: 0,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(negativeResult.page).toBe(1)
      expect(negativeResult.sessions[0].sessionId).toBe('session-0')
    })

    it('should handle single page result', async () => {
      const sessions = Array.from({ length: 5 }, (_, i) =>
        createMockSession({ sessionId: `session-${i}` }),
      )

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(5)
      expect(result.totalPages).toBe(1)
      expect(result.page).toBe(1)
    })

    it('should accept pageSize of 5 (new minimum)', async () => {
      const sessions = Array.from({ length: 12 }, (_, i) =>
        createMockSession({ sessionId: `session-${i}` }),
      )

      const page1 = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 5,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(page1.sessions).toHaveLength(5)
      expect(page1.sessions[0].sessionId).toBe('session-0')
      expect(page1.sessions[4].sessionId).toBe('session-4')
      expect(page1.totalCount).toBe(12)
      expect(page1.totalPages).toBe(3)

      const page2 = await paginateAndFilterSessions(sessions, {
        page: 2,
        pageSize: 5,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(page2.sessions).toHaveLength(5)
      expect(page2.sessions[0].sessionId).toBe('session-5')
      expect(page2.sessions[4].sessionId).toBe('session-9')

      const page3 = await paginateAndFilterSessions(sessions, {
        page: 3,
        pageSize: 5,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(page3.sessions).toHaveLength(2)
      expect(page3.sessions[0].sessionId).toBe('session-10')
      expect(page3.sessions[1].sessionId).toBe('session-11')
    })
  })

  describe('edge cases', () => {
    it('should handle empty results', async () => {
      const result = await paginateAndFilterSessions([], {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(0)
      expect(result.totalCount).toBe(0)
      expect(result.totalPages).toBe(1)
      expect(result.page).toBe(1)
    })

    it('should handle page=1 with no results', async () => {
      const result = await paginateAndFilterSessions([], {
        page: 1,
        pageSize: 10,
        search: 'nonexistent',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(0)
      expect(result.totalCount).toBe(0)
      expect(result.totalPages).toBe(1)
      expect(result.page).toBe(1)
    })

    it('should handle filters that produce no results', async () => {
      const sessions = [
        createMockSession({ projectName: 'project-a', isActive: false }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'active',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.sessions).toHaveLength(0)
      expect(result.totalCount).toBe(0)
      expect(result.totalPages).toBe(1)
    })
  })

  describe('projects list', () => {
    it('should extract distinct project names from all sessions', async () => {
      const sessions = [
        createMockSession({ projectName: 'project-b' }),
        createMockSession({ projectName: 'project-a' }),
        createMockSession({ projectName: 'project-c' }),
        createMockSession({ projectName: 'project-a' }), // Duplicate
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.projects).toEqual(['project-a', 'project-b', 'project-c'])
    })

    it('should include all projects even when filters are applied', async () => {
      const sessions = [
        createMockSession({ projectName: 'project-a', isActive: true }),
        createMockSession({ projectName: 'project-b', isActive: false }),
        createMockSession({ projectName: 'project-c', isActive: false }),
      ]

      const result = await paginateAndFilterSessions(sessions, {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'active', // Filters to only project-a
        project: '', sort: 'latest' as const, starFirst: true,
      })

      // Projects list should still include all projects
      expect(result.projects).toEqual(['project-a', 'project-b', 'project-c'])
      // But sessions should only include active
      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0].projectName).toBe('project-a')
    })

    it('should handle empty sessions list', async () => {
      const result = await paginateAndFilterSessions([], {
        page: 1,
        pageSize: 10,
        search: '',
        status: 'all',
        project: '', sort: 'latest' as const, starFirst: true,
      })

      expect(result.projects).toEqual([])
    })
  })

  describe('hidden project filter (keyed by projectDir)', () => {
    it('filters out sessions whose projectDir is hidden', async () => {
      const sessions = [
        createMockSession({ sessionId: 'visible', projectDir: '-dir-visible', projectName: 'visible' }),
        createMockSession({ sessionId: 'hidden', projectDir: '-dir-hidden', projectName: 'hidden' }),
      ]
      const metadata: Metadata = {
        version: 2,
        sessions: {},
        projects: { '-dir-hidden': { hidden: true } },
      }

      const result = await paginateAndFilterSessions(
        sessions,
        { page: 1, pageSize: 10, search: '', status: 'all', project: '', sort: 'latest' as const, starFirst: true },
        metadata,
      )

      const ids = result.sessions.map((s) => s.sessionId)
      expect(ids).toContain('visible')
      expect(ids).not.toContain('hidden')
    })

    it('keeps a session visible when its projectDir is not hidden even if its decoded projectPath equals a stale key', async () => {
      // Stale lossy key "C:/" is hidden, but the live project is keyed by its dir "C--".
      const sessions = [
        createMockSession({ sessionId: 'live', projectDir: 'C--', projectPath: 'C:/', projectName: 'root' }),
      ]
      const metadata: Metadata = {
        version: 2,
        sessions: {},
        projects: { 'C:/': { hidden: true } },
      }

      const result = await paginateAndFilterSessions(
        sessions,
        { page: 1, pageSize: 10, search: '', status: 'all', project: '', sort: 'latest' as const, starFirst: true },
        metadata,
      )

      expect(result.sessions.map((s) => s.sessionId)).toContain('live')
    })
  })

  describe('hidden project summary + showHidden', () => {
    const metadata: Metadata = {
      version: 2,
      sessions: {},
      projects: { '-dir-hidden': { hidden: true }, '-dir-hidden2': { hidden: true } },
    }

    it('computes hiddenProjects and hiddenSessionCount independent of the active filters', async () => {
      const sessions = [
        createMockSession({ sessionId: 'v1', projectDir: '-dir-visible', projectName: 'visible' }),
        createMockSession({ sessionId: 'h1', projectDir: '-dir-hidden', projectName: 'alpha' }),
        createMockSession({ sessionId: 'h2', projectDir: '-dir-hidden', projectName: 'alpha' }),
        createMockSession({ sessionId: 'h3', projectDir: '-dir-hidden2', projectName: 'beta' }),
      ]

      // A search filter that matches nothing must not change the hidden summary.
      const result = await paginateAndFilterSessions(
        sessions,
        { page: 1, pageSize: 10, search: 'zzz-no-match', status: 'all', project: '', sort: 'latest' as const, starFirst: true },
        metadata,
      )

      expect(result.sessions).toHaveLength(0)
      expect(result.hiddenSessionCount).toBe(3)
      expect(result.hiddenProjects).toHaveLength(2)

      const alpha = result.hiddenProjects.find((p) => p.projectDir === '-dir-hidden')
      const beta = result.hiddenProjects.find((p) => p.projectDir === '-dir-hidden2')
      expect(alpha?.sessionCount).toBe(2)
      expect(alpha?.projectName).toBe('alpha')
      expect(beta?.sessionCount).toBe(1)
      expect(beta?.projectName).toBe('beta')
    })

    it('excludes hidden sessions when showHidden is false (default)', async () => {
      const sessions = [
        createMockSession({ sessionId: 'v1', projectDir: '-dir-visible', projectName: 'visible' }),
        createMockSession({ sessionId: 'h1', projectDir: '-dir-hidden', projectName: 'alpha' }),
      ]

      const result = await paginateAndFilterSessions(
        sessions,
        { page: 1, pageSize: 10, search: '', status: 'all', project: '', sort: 'latest' as const, starFirst: true },
        metadata,
      )

      expect(result.sessions.map((s) => s.sessionId)).toEqual(['v1'])
      expect(result.hiddenSessionCount).toBe(1)
    })

    it('includes hidden sessions when showHidden is true', async () => {
      const sessions = [
        createMockSession({ sessionId: 'v1', projectDir: '-dir-visible', projectName: 'visible' }),
        createMockSession({ sessionId: 'h1', projectDir: '-dir-hidden', projectName: 'alpha' }),
      ]

      const result = await paginateAndFilterSessions(
        sessions,
        { page: 1, pageSize: 10, search: '', status: 'all', project: '', sort: 'latest' as const, starFirst: true, showHidden: true },
        metadata,
      )

      const ids = result.sessions.map((s) => s.sessionId)
      expect(ids).toContain('v1')
      expect(ids).toContain('h1')
      // Summary is still reported even while hidden sessions are shown.
      expect(result.hiddenSessionCount).toBe(1)
    })

    it('reports an empty summary when no projects are hidden', async () => {
      const sessions = [
        createMockSession({ sessionId: 'v1', projectDir: '-dir-visible', projectName: 'visible' }),
      ]

      const result = await paginateAndFilterSessions(
        sessions,
        { page: 1, pageSize: 10, search: '', status: 'all', project: '', sort: 'latest' as const, starFirst: true },
      )

      expect(result.hiddenProjects).toEqual([])
      expect(result.hiddenSessionCount).toBe(0)
    })
  })
})
