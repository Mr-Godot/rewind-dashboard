import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { paginatedSessionListQuery, activeSessionsQuery } from './sessions.queries'
import { metadataQuery } from '@/features/metadata/metadata.queries'
import { SessionCard } from './SessionCard'
import { SessionFilters } from './SessionFilters'
import { PaginationControls } from './PaginationControls'
import { usePageSizePreference } from './usePageSizePreference'
import { SessionListGrouped } from './SessionListGrouped'
import { searchConversations, type SearchHit } from './search.api'
import { formatRelativeTime, formatDateTime } from '@/lib/utils/format'
import { Link } from '@tanstack/react-router'
import { Route } from '@/routes/_dashboard/sessions/index'

export function SessionList() {
  const navigate = useNavigate()
  const { page, pageSize, search, status, project, sort, starFirst, view } = Route.useSearch()
  const { storedPageSize, setPageSize } = usePageSizePreference()
  const hasAppliedStoredPreference = useRef(false)
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

  const { data: activeSessions = [] } = useQuery(activeSessionsQuery)
  const hasActive = activeSessions.length > 0
  const { data: paginatedData, isLoading } = useQuery(
    paginatedSessionListQuery({ page, pageSize, search, status, project, sort, starFirst, hasActive }),
  )
  const { data: metadata } = useQuery(metadataQuery)

  // Progressive loading: once the current page is in, background-prefetch the
  // NEXT page only (page+1) so advancing is instant. Pages beyond that stay
  // lazy and load on demand; keepPreviousData keeps them smooth.
  const queryClient = useQueryClient()
  useEffect(() => {
    const totalPages = paginatedData?.totalPages ?? 1
    if (page + 1 > totalPages) return
    queryClient.prefetchQuery(
      paginatedSessionListQuery({ page: page + 1, pageSize, search, status, project, sort, starFirst, hasActive }),
    )
  }, [queryClient, page, pageSize, search, status, project, sort, starFirst, hasActive, paginatedData?.totalPages])

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
    const hiddenPaths = new Set(
      Object.entries(metadata?.projects ?? {})
        .filter(([, v]) => v.hidden)
        .map(([k]) => k),
    )
    if (hiddenPaths.size === 0) return projects
    const hiddenNames = new Set<string>()
    for (const s of paginatedData?.sessions ?? []) {
      if (hiddenPaths.has(s.projectPath)) hiddenNames.add(s.projectName)
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

  return (
    <div>
      <SessionFilters
        projects={visibleProjects}
        activeCount={activeCount}
        searchRef={searchInputRef}
      />

      {/* Background refetch — no visual indicator */}

      <div className="mt-4 space-y-2">
        {mergedSessions.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            {totalCount === 0 && !search && status === 'all' && !project
              ? 'No sessions found in ~/.claude'
              : 'No sessions match your filters'}
          </div>
        ) : view === 'grouped' ? (
          <SessionListGrouped sessions={mergedSessions} metadata={metadata} />
        ) : (
          mergedSessions.map((session) => (
            <SessionCard
              key={session.sessionId}
              session={session}
              metadata={metadata?.sessions[session.sessionId]}
              projectMeta={metadata?.projects[session.projectPath]}
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
