import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { searchConversations } from './search.api'
import { formatRelativeTime, formatDateTime } from '@/lib/utils/format'

/** Shortest query the conversation index is asked about. */
export const MIN_FTS_QUERY_LENGTH = 3
/**
 * Sessions requested per query. The server LIMIT counts SESSIONS, and nothing
 * is subtracted client-side any more, so this is the number of rows rendered.
 */
export const FTS_LIMIT = 50
/** After this long, the first search of a process is almost certainly building the index. */
const SLOW_SEARCH_MS = 2000

/**
 * Conversation (full-text) matches shown under the session list.
 *
 * Every state is explicit: idle, loading, degraded, and no-match. Returning
 * null while a search is in flight is what made a dead search subsystem look
 * identical to "nothing matched".
 *
 * The request goes through useQuery with retry disabled. The previous
 * hand-rolled effect only recorded the query on the success path, so a
 * rejected search re-fired on every render, an unbounded request storm.
 */
export function FullTextSearchResults({
  query,
  existingIds,
}: {
  query: string
  existingIds: Set<string>
}) {
  const enabled = query.length >= MIN_FTS_QUERY_LENGTH

  const { data, isError } = useQuery({
    queryKey: ['fts', query, FTS_LIMIT],
    queryFn: () => searchConversations({ data: { query, limit: FTS_LIMIT } }),
    enabled,
    retry: false,
  })

  // The first search of a server process builds the whole index inside that one
  // request. Without this the user stares at a spinner for tens of seconds with
  // no idea anything is happening.
  const [slowQuery, setSlowQuery] = useState<string | null>(null)
  const settled = data !== undefined || isError
  useEffect(() => {
    if (!enabled || settled) return
    const timer = setTimeout(() => setSlowQuery(query), SLOW_SEARCH_MS)
    return () => clearTimeout(timer)
  }, [enabled, settled, query])
  const slow = slowQuery === query

  if (!enabled) return null

  if (isError || data?.degraded) {
    return (
      <Shell>
        <p className="text-sm text-amber-400">
          Conversation search unavailable: check the server log.
        </p>
      </Shell>
    )
  }

  if (!data) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="h-3 w-3 animate-pulse rounded-full bg-gray-600" />
          {slow ? 'Building the conversation index…' : 'Searching conversations…'}
        </div>
      </Shell>
    )
  }

  const rawCount = data.hits.length

  if (rawCount === 0) {
    return (
      <Shell>
        <p className="text-sm text-gray-400">
          No conversation text matched &ldquo;{query}&rdquo;.
        </p>
      </Shell>
    )
  }

  // Every hit is rendered in server order. Subtracting the sessions already on
  // the metadata page used to run AFTER the server LIMIT, so a page of hits
  // could collapse to one visible row. Hits already listed above get a chip
  // instead. No client-side sort: the server returns newest-first and
  // re-sorting a truncated page is exactly the bug being fixed.
  return (
    <Shell>
      <p className="mb-2 text-xs text-gray-500">
        Showing {rawCount} of {data.total}
      </p>
      <div className="space-y-2">
        {data.hits.map((hit) => (
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
                {(hit.matchCount ?? 0) > 1 && (
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">
                    {hit.matchCount} matches
                  </span>
                )}
                {existingIds.has(hit.sessionId) && (
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-500">
                    already listed above
                  </span>
                )}
              </div>
              {hit.timestamp && (
                <span className="text-gray-500" title={formatDateTime(hit.timestamp)}>
                  {formatRelativeTime(hit.timestamp)}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-300">&ldquo;{hit.snippet}&rdquo;</p>
          </Link>
        ))}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Conversation matches
      </h3>
      {children}
    </div>
  )
}
