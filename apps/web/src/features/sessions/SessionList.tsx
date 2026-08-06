import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { paginatedSessionListQuery, activeSessionsQuery } from './sessions.queries'
import type { HiddenProjectSummary, HiddenSessionSummary } from './sessions.api'
import { metadataQuery } from '@/features/metadata/metadata.queries'
import { SessionCard } from './SessionCard'
import { SessionFilters } from './SessionFilters'
import { PaginationControls } from './PaginationControls'
import { usePageSizePreference } from './usePageSizePreference'
import {
  useSessionFilterPreferences,
  shouldRehydrate,
  reconcileStoredProject,
} from './useSessionFilterPreferences'
import { SessionListGrouped } from './SessionListGrouped'
import { countWorkingSessions, hasWorkingSession, mergeLiveStates } from './active-merge'
import { useHideProject, useHideSession } from '@/features/metadata/useMetadataMutations'
import { resolveSessionTitle } from './session-title'
import { usePrivacy } from '@/features/privacy/PrivacyContext'
import { FullTextSearchResults, MIN_FTS_QUERY_LENGTH } from './FullTextSearchResults'
import { EmptyState } from '@/components/EmptyState'
import { useRescan } from './rescan.queries'
import { Route } from '@/routes/_dashboard/sessions/index'

export function SessionList() {
  const navigate = useNavigate()
  const { page, pageSize, search, status, project, sort, starFirst, view, showHidden } = Route.useSearch()
  const { storedPageSize, setPageSize } = usePageSizePreference()
  const { storedFilters, persistFilters } = useSessionFilterPreferences()
  const { anonymizeProjectName } = usePrivacy()
  const hasAppliedStoredPreference = useRef(false)
  const hasRehydratedFilters = useRef(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Cmd+K to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (
      storedPageSize !== null &&
      !hasAppliedStoredPreference.current &&
      storedPageSize !== pageSize
    ) {
      hasAppliedStoredPreference.current = true
      navigate({
        to: '/sessions',
        search: (prev) => ({ ...prev, pageSize: storedPageSize, page: 1 }),
        replace: true,
      })
    }
  }, [storedPageSize, pageSize, navigate])

  // One-shot rehydrate of saved filters when arriving with a bare URL
  useEffect(() => {
    if (hasRehydratedFilters.current) return
    if (shouldRehydrate(window.location.search, storedFilters)) {
      hasRehydratedFilters.current = true
      navigate({
        to: '/sessions',
        search: (prev) => ({ ...prev, ...storedFilters, page: 1 }),
        replace: true,
      })
    } else {
      hasRehydratedFilters.current = true
    }
  }, [storedFilters, navigate])

  // Write-through: persist filters whenever they change
  useEffect(() => {
    persistFilters({ status, sort, starFirst, view, project })
  }, [status, sort, starFirst, view, project, persistFilters])

  const activeQuery = useQuery(activeSessionsQuery)
  const activeSessions = useMemo(() => activeQuery.data ?? [], [activeQuery.data])
  const hasActive = hasWorkingSession(activeSessions)
  const { data: paginatedData, isLoading, isFetching, isPlaceholderData } = useQuery(
    paginatedSessionListQuery({ page, pageSize, search, status, project, sort, starFirst, showHidden, hasActive }),
  )
  const { data: metadata } = useQuery(metadataQuery)
  const rescan = useRescan()

  // A filter set from the Projects table is an encoded dir, not a display name.
  const reconciledProject = useMemo(() => {
    if (!project || !paginatedData) return project
    return reconcileStoredProject(project, [
      ...paginatedData.projects,
      ...paginatedData.projectDirs,
    ])
  }, [project, paginatedData])

  /**
   * The reconcile below only runs AFTER the query resolves, so a persisted
   * filter naming a project that no longer exists paints a full "nothing
   * matched" screen before the navigate lands. While this is true the list is
   * mid-correction: show the busy affordance, never an empty state.
   */
  const projectPendingReconcile = reconciledProject !== project

  // Drop a stale stored project that no longer exists in the current set
  useEffect(() => {
    if (!projectPendingReconcile) return
    navigate({
      to: '/sessions',
      search: (prev) => ({ ...prev, project: reconciledProject, page: 1 }),
      replace: true,
    })
  }, [projectPendingReconcile, reconciledProject, navigate])

  // Progressive loading: once the current page is in, background-prefetch the
  // NEXT page only (page+1) so advancing is instant. Pages beyond that stay
  // lazy and load on demand; keepPreviousData keeps them smooth.
  const queryClient = useQueryClient()
  useEffect(() => {
    const totalPages = paginatedData?.totalPages ?? 1
    if (page + 1 > totalPages) return
    queryClient.prefetchQuery(
      paginatedSessionListQuery({ page: page + 1, pageSize, search, status, project, sort, starFirst, showHidden, hasActive }),
    )
  }, [queryClient, page, pageSize, search, status, project, sort, starFirst, showHidden, hasActive, paginatedData?.totalPages])

  // Merge liveness from the fast-polling query (symmetric: also downgrades)
  const mergedSessions = useMemo(() => {
    if (!paginatedData) return []
    return mergeLiveStates(paginatedData.sessions, activeSessions, activeQuery.isSuccess)
  }, [paginatedData, activeSessions, activeQuery.isSuccess])

  /**
   * Newest activity visible on this page. Used only as a lower bound on what
   * the conversation index must cover: anything newer than `indexedThrough`
   * provably is not searchable yet.
   */
  const newestSessionAt = useMemo(() => {
    let newest: string | null = null
    for (const s of mergedSessions) {
      if (!newest || Date.parse(s.lastActiveAt) > Date.parse(newest)) newest = s.lastActiveAt
    }
    return newest
  }, [mergedSessions])

  // Client-side filter hidden projects from dropdown
  const visibleProjects = useMemo(() => {
    const projects = paginatedData?.projects ?? []
    const hiddenDirs = new Set(
      Object.entries(metadata?.projects ?? {})
        .filter(([, v]) => v.hidden)
        .map(([k]) => k),
    )
    if (hiddenDirs.size === 0) return projects
    const hiddenNames = new Set<string>()
    for (const s of paginatedData?.sessions ?? []) {
      if (hiddenDirs.has(s.projectDir)) hiddenNames.add(s.projectName)
    }
    return projects.filter((p) => !hiddenNames.has(p))
  }, [paginatedData, metadata])

  function handlePageChange(newPage: number) {
    navigate({ to: '/sessions', search: (prev) => ({ ...prev, page: newPage }) })
  }

  function handlePageSizeChange(newSize: number) {
    setPageSize(newSize)
    navigate({ to: '/sessions', search: (prev) => ({ ...prev, pageSize: newSize, page: 1 }) })
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-gray-800 bg-gray-900/50" />
        ))}
      </div>
    )
  }

  const totalCount = paginatedData?.totalCount ?? 0
  const totalPages = paginatedData?.totalPages ?? 1
  const activeCount = countWorkingSessions(activeSessions)
  const hiddenSessionCount = paginatedData?.hiddenSessionCount ?? 0
  const hiddenProjects = paginatedData?.hiddenProjects ?? []
  const hiddenSessions = paginatedData?.hiddenSessions ?? []
  const hiddenSessionOnlyCount = paginatedData?.hiddenSessionOnlyCount ?? 0
  const totalHiddenCount = hiddenSessionCount + hiddenSessionOnlyCount
  const noActiveFilter = !search && status === 'all' && !project
  // Additive only. Swapping in a skeleton here would defeat keepPreviousData
  // and blank a populated list on every search keystroke.
  const dimmed = isPlaceholderData && isFetching
  const busy = dimmed || projectPendingReconcile
  const activeFilterLabels = [
    search ? `search "${search}"` : null,
    status !== 'all' ? `status ${status}` : null,
    project ? `project ${anonymizeProjectName(project)}` : null,
  ].filter((label): label is string => label !== null)

  function toggleShowHidden() {
    navigate({ to: '/sessions', search: (prev) => ({ ...prev, showHidden: !showHidden, page: 1 }) })
  }

  function revealHiddenSessions() {
    navigate({ to: '/sessions', search: (prev) => ({ ...prev, showHidden: true, page: 1 }) })
  }

  function clearFilters() {
    persistFilters({ status: 'all', project: '' })
    navigate({
      to: '/sessions',
      search: (prev) => ({ ...prev, search: '', status: 'all', project: '', page: 1 }),
    })
  }

  return (
    <div>
      <SessionFilters
        projects={visibleProjects}
        activeCount={activeCount}
        searchRef={searchInputRef}
      />

      {totalHiddenCount > 0 && (
        <HiddenBanner
          hiddenSessionCount={hiddenSessionCount}
          hiddenProjects={hiddenProjects}
          hiddenSessions={hiddenSessions}
          showHidden={showHidden}
          onToggle={toggleShowHidden}
        />
      )}

      {/* Background refetch: a 2px indeterminate bar, never a content swap. */}
      {busy && (
        <div
          data-testid="session-list-busy"
          role="status"
          aria-label="Updating sessions"
          className="mt-3 h-0.5 overflow-hidden rounded-full bg-gray-800"
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-500" />
        </div>
      )}

      <div
        data-testid="session-list-rows"
        className={`mt-4 space-y-2 transition-opacity ${dimmed ? 'opacity-50' : ''}`}
      >
        {mergedSessions.length === 0 ? (
          // Nothing to keep and an answer already in flight: the busy bar above
          // is the honest state. Picking an empty-state branch here would read
          // the PLACEHOLDER's totalCount against the NEW filters and cheerfully
          // announce "No sessions found in ~/.claude" the moment a filter is
          // cleared. keepPreviousData is untouched: this branch only runs when
          // there are zero rows to preserve.
          busy ? null : totalCount === 0 &&
            totalHiddenCount > 0 &&
            noActiveFilter ? (
            <EmptyState
              title="Every session is hidden"
              hint={
                hiddenSessionOnlyCount === 0
                  ? `All ${hiddenSessionCount} sessions live in projects you have hidden.`
                  : hiddenSessionCount === 0
                    ? `All ${hiddenSessionOnlyCount} sessions were hidden one by one.`
                    : `All ${totalHiddenCount} sessions are hidden: ${hiddenSessionCount} in hidden projects, ${hiddenSessionOnlyCount} hidden one by one.`
              }
              action={
                <button
                  type="button"
                  onClick={revealHiddenSessions}
                  className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
                >
                  Show hidden sessions
                </button>
              }
            />
          ) : totalCount === 0 && noActiveFilter ? (
            <EmptyState
              title="No sessions found in ~/.claude"
              hint="Nothing was found under ~/.claude/projects. If you have used Claude Code here, rescan to rebuild the cache."
              action={
                <button
                  type="button"
                  onClick={() => rescan.mutate()}
                  disabled={rescan.isPending}
                  className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100 disabled:opacity-50"
                >
                  {rescan.isPending ? 'Rescanning…' : 'Rescan'}
                </button>
              }
            />
          ) : (
            <EmptyState
              title="No sessions match your filters"
              hint={
                activeFilterLabels.length > 0
                  ? `Active filters: ${activeFilterLabels.join(', ')}.`
                  : `Page ${page} is empty (${totalCount} sessions in total).`
              }
              action={
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-gray-100"
                >
                  Clear filters
                </button>
              }
            />
          )
        ) : view === 'grouped' ? (
          <SessionListGrouped sessions={mergedSessions} metadata={metadata} />
        ) : (
          mergedSessions.map((session) => (
            <SessionCard
              key={session.sessionId}
              session={session}
              metadata={metadata?.sessions[session.sessionId]}
              projectMeta={metadata?.projects[session.projectDir]}
            />
          ))
        )}
      </div>

      {/* Full-text conversation search */}
      {search && search.length >= MIN_FTS_QUERY_LENGTH && (
        <FullTextSearchResults
          query={search}
          existingIds={new Set(mergedSessions.map((s) => s.sessionId))}
          newestSessionAt={newestSessionAt}
        />
      )}

      <div className="mt-4">
        <PaginationControls
          page={paginatedData?.page ?? page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={pageSize}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      </div>
    </div>
  )
}

function HiddenBanner({
  hiddenSessionCount,
  hiddenProjects,
  hiddenSessions,
  showHidden,
  onToggle,
}: {
  hiddenSessionCount: number
  hiddenProjects: HiddenProjectSummary[]
  hiddenSessions: HiddenSessionSummary[]
  showHidden: boolean
  onToggle: () => void
}) {
  const { privacyMode, anonymizeProjectName } = usePrivacy()
  const hideMutation = useHideProject()
  const hideSessionMutation = useHideSession()
  const [expanded, setExpanded] = useState(false)
  const projectCount = hiddenProjects.length
  const sessionOnlyCount = hiddenSessions.length

  const projectPart =
    projectCount > 0
      ? `${hiddenSessionCount} ${hiddenSessionCount === 1 ? 'session' : 'sessions'} in ${projectCount} hidden ${projectCount === 1 ? 'project' : 'projects'}`
      : null
  const sessionPart =
    sessionOnlyCount > 0
      ? `${sessionOnlyCount} ${sessionOnlyCount === 1 ? 'session' : 'sessions'} hidden one by one`
      : null
  const summary = [projectPart, sessionPart].filter(Boolean).join(', plus ')

  return (
    <div className="mt-3 border border-gray-800 bg-gray-900/60 px-3 py-1.5 text-xs text-gray-400">
      <div className="flex items-center gap-2">
        <span>{summary}</span>
        <button
          type="button"
          onClick={onToggle}
          className="text-matrix underline-offset-2 hover:underline"
        >
          [{showHidden ? 'hide' : 'show'}]
        </button>
        {(projectCount > 0 || sessionOnlyCount > 0) && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-gray-500 hover:text-gray-300"
          >
            {expanded ? '▼' : '▶'} {expanded ? 'collapse' : 'list'}
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-2 space-y-1 border-t border-gray-800 pt-2">
          {hiddenProjects.map((p) => (
            <div key={p.projectDir} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {privacyMode ? anonymizeProjectName(p.projectName) : p.projectName}
                <span className="ml-1 text-gray-600">({p.sessionCount})</span>
              </span>
              <button
                type="button"
                onClick={() => hideMutation.mutate({ projectDir: p.projectDir, hidden: false })}
                className="shrink-0 rounded bg-blue-900/40 px-1.5 py-0.5 text-blue-400 transition-colors hover:bg-blue-800/60"
              >
                unhide
              </button>
            </div>
          ))}
          {hiddenSessions.map((s) => (
            <div key={s.sessionId} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {resolveSessionTitle({
                  customName: s.customName,
                  claudeName: s.claudeName,
                  firstUserMessage: s.firstUserMessage,
                  fallback: privacyMode ? anonymizeProjectName(s.projectName) : s.projectName,
                  privacyMode,
                })}
                <span className="ml-1 font-mono text-gray-600">{s.sessionId.slice(0, 8)}</span>
              </span>
              <button
                type="button"
                onClick={() => hideSessionMutation.mutate({ sessionId: s.sessionId, hidden: false })}
                className="shrink-0 rounded bg-blue-900/40 px-1.5 py-0.5 text-blue-400 transition-colors hover:bg-blue-800/60"
              >
                unhide
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
