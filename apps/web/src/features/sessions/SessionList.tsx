import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { paginatedSessionListQuery, activeSessionsQuery } from './sessions.queries'
import type { HiddenProjectSummary } from './sessions.api'
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
import { useHideProject } from '@/features/metadata/useMetadataMutations'
import { usePrivacy } from '@/features/privacy/PrivacyContext'
import { searchConversations, type SearchHit } from './search.api'
import { formatRelativeTime, formatDateTime } from '@/lib/utils/format'
import { Link } from '@tanstack/react-router'
import { Route } from '@/routes/_dashboard/sessions/index'

export function SessionList() {
  const navigate = useNavigate()
  const { page, pageSize, search, status, project, sort, starFirst, view, showHidden } = Route.useSearch()
  const { storedPageSize, setPageSize } = usePageSizePreference()
  const { storedFilters, persistFilters } = useSessionFilterPreferences()
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

  const { data: activeSessions = [] } = useQuery(activeSessionsQuery)
  const hasActive = activeSessions.length > 0
  const { data: paginatedData, isLoading } = useQuery(
    paginatedSessionListQuery({ page, pageSize, search, status, project, sort, starFirst, showHidden, hasActive }),
  )
  const { data: metadata } = useQuery(metadataQuery)

  // Drop a stale stored project that no longer exists in the current set
  useEffect(() => {
    if (!project || !paginatedData) return
    const reconciled = reconcileStoredProject(project, paginatedData.projects)
    if (reconciled !== project) {
      navigate({
        to: '/sessions',
        search: (prev) => ({ ...prev, project: reconciled, page: 1 }),
        replace: true,
      })
    }
  }, [project, paginatedData, navigate])

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

  // Merge active status from fast-polling query
  const mergedSessions = useMemo(() => {
    if (!paginatedData) return []
    const activeMap = new Map(activeSessions.map((s) => [s.sessionId, s]))
    return paginatedData.sessions.map((s) => {
      const active = activeMap.get(s.sessionId)
      if (!active) return s
      return { ...s, isActive: true, sessionState: active.sessionState }
    })
  }, [paginatedData, activeSessions])

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
  const activeCount = activeSessions.length
  const hiddenSessionCount = paginatedData?.hiddenSessionCount ?? 0
  const hiddenProjects = paginatedData?.hiddenProjects ?? []
  const noActiveFilter = !search && status === 'all' && !project

  function toggleShowHidden() {
    navigate({ to: '/sessions', search: (prev) => ({ ...prev, showHidden: !showHidden, page: 1 }) })
  }

  return (
    <div>
      <SessionFilters
        projects={visibleProjects}
        activeCount={activeCount}
        searchRef={searchInputRef}
      />

      {hiddenSessionCount > 0 && (
        <HiddenBanner
          hiddenSessionCount={hiddenSessionCount}
          hiddenProjects={hiddenProjects}
          showHidden={showHidden}
          onToggle={toggleShowHidden}
        />
      )}

      {/* Background refetch — no visual indicator */}

      <div className="mt-4 space-y-2">
        {mergedSessions.length === 0 ? (
          totalCount === 0 && hiddenSessionCount > 0 && noActiveFilter ? (
            <div className="py-12 text-center text-sm text-gray-500">
              no visible sessions — {hiddenSessionCount} hidden.{' '}
              <button
                type="button"
                onClick={toggleShowHidden}
                className="text-matrix underline-offset-2 hover:underline"
              >
                [show hidden]
              </button>
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-gray-500">
              {totalCount === 0 && noActiveFilter
                ? 'No sessions found in ~/.claude'
                : 'No sessions match your filters'}
            </div>
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
      {search && search.length >= 3 && (
        <FullTextSearchResults query={search} existingIds={new Set(mergedSessions.map((s) => s.sessionId))} />
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
  showHidden,
  onToggle,
}: {
  hiddenSessionCount: number
  hiddenProjects: HiddenProjectSummary[]
  showHidden: boolean
  onToggle: () => void
}) {
  const { privacyMode, anonymizeProjectName } = usePrivacy()
  const hideMutation = useHideProject()
  const [expanded, setExpanded] = useState(false)
  const projectCount = hiddenProjects.length

  return (
    <div className="mt-3 border border-gray-800 bg-gray-900/60 px-3 py-1.5 text-xs text-gray-400">
      <div className="flex items-center gap-2">
        <span>
          {hiddenSessionCount} sessions in {projectCount} {projectCount === 1 ? 'project' : 'projects'} hidden
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="text-matrix underline-offset-2 hover:underline"
        >
          [{showHidden ? 'hide' : 'show'}]
        </button>
        {projectCount > 0 && (
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
        </div>
      )}
    </div>
  )
}

function FullTextSearchResults({ query, existingIds }: { query: string; existingIds: Set<string> }) {
  const [results, setResults] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const searchedRef = useRef('')

  useEffect(() => {
    if (query.length < 3 || query === searchedRef.current) return
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      setLoading(true)
      return searchConversations({ data: { query, limit: 10 } })
        .then((hits) => {
          if (cancelled) return
          setResults(hits.filter((h) => !existingIds.has(h.sessionId)))
          searchedRef.current = query
        })
        .catch(() => { if (!cancelled) setResults([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
    })
    return () => { cancelled = true }
  }, [query, existingIds])

  if (!loading && results.length === 0) return null

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Conversation matches
      </h3>
      {loading ? (
        <div className="h-12 animate-pulse rounded-lg bg-gray-800/50" />
      ) : (
        <div className="space-y-2">
          {results.map((hit) => (
            <Link
              key={hit.sessionId}
              to="/sessions/$sessionId"
              params={{ sessionId: hit.sessionId }}
              search={{ project: hit.projectPath }}
              className="block rounded-lg border border-gray-800 bg-gray-900/50 p-3 transition-all hover:border-gray-700 hover:bg-gray-900"
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-blue-900/20 border border-blue-800/40 px-1.5 py-0.5 text-blue-300">
                    Project: {hit.projectName}
                  </span>
                  <span className="font-mono text-gray-500">{hit.sessionId.slice(0, 8)}</span>
                </div>
                {hit.timestamp && (
                  <span className="text-gray-500" title={formatDateTime(hit.timestamp)}>{formatRelativeTime(hit.timestamp)}</span>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-300">&ldquo;{hit.snippet}&rdquo;</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
