import { useState, useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/_dashboard/sessions/index'
import { usePrivacy } from '@/features/privacy/PrivacyContext'
import { useRescan } from './rescan.queries'

interface SessionFiltersProps {
  projects: string[]
  activeCount: number
  searchRef?: React.RefObject<HTMLInputElement | null>
}

export function SessionFilters({ projects, activeCount, searchRef }: SessionFiltersProps) {
  const navigate = useNavigate()
  const { search: urlSearch, status, project, sort, view, pageSize, starFirst } = Route.useSearch()
  const { privacyMode, anonymizeProjectName } = usePrivacy()
  const rescan = useRescan()

  const [localSearch, setLocalSearch] = useState(urlSearch)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [])

  useEffect(() => { setLocalSearch(urlSearch) }, [urlSearch])

  function handleSearchChange(value: string) {
    setLocalSearch(value)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      navigate({ to: '/sessions', search: { search: value, sort, view, status, project, page: 1, pageSize } })
    }, 300)
  }

  function handleStatusChange(newStatus: 'all' | 'active' | 'completed') {
    navigate({
      to: '/sessions',
      search: { search: localSearch, sort, view, status: newStatus, page: 1, pageSize, project: newStatus === 'all' ? '' : project },
    })
  }

  function handleProjectChange(newProject: string) {
    navigate({ to: '/sessions', search: { search: localSearch, sort, view, status, project: newProject, page: 1, pageSize } })
  }

  function handleSortChange(newSort: string) {
    navigate({ to: '/sessions', search: { search: localSearch, sort: newSort as typeof sort, view, status, project, page: 1, pageSize } })
  }

  function handleViewChange(newView: string) {
    navigate({
      to: '/sessions',
      search: {
        search: localSearch, sort, status, project, page: 1,
        view: newView as 'flat' | 'grouped',
        pageSize,
      },
    })
  }

  return (
    <div className="space-y-3">
      {/* Row 1: Find & Order */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search sessions... (⌘K)"
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="min-w-[200px] flex-1 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <select
          value={sort}
          onChange={(e) => handleSortChange(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-brand-500"
        >
          <option value="latest">Sort: Latest</option>
          <option value="mostActive">Most Active</option>
          <option value="longest">Longest</option>
          <option value="largest">Largest</option>
          <option value="starred">Starred only</option>
        </select>
      </div>

      {/* Row 2: Filter & Group */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-gray-700 text-xs">
          {(['all', 'active', 'completed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                status === s
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200'
              } ${s === 'all' ? 'rounded-l-lg' : ''} ${s === 'completed' ? 'rounded-r-lg' : ''}`}
            >
              {s}
              {s === 'active' && activeCount > 0 && (
                <span className="ml-1 text-matrix">({activeCount})</span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => navigate({ to: '/sessions', search: (prev) => ({ ...prev, starFirst: !starFirst }) })}
            className={`px-3 py-1.5 capitalize transition-colors rounded-lg ${
              starFirst
                ? 'bg-amber-900/30 text-amber-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            title={starFirst ? 'Starred pinned to top — click to sort all by recency' : 'Click to pin starred to top'}
          >
            {starFirst ? '\u2605' : '\u2606'} Starred
          </button>
        </div>

        {projects.length > 1 && (
          <select
            value={project}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-brand-500"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {privacyMode ? anonymizeProjectName(p) : p}
              </option>
            ))}
          </select>
        )}

        <div className="flex rounded-lg border border-gray-700 text-xs">
          {([['flat', 'Sessions'], ['grouped', 'Projects']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => handleViewChange(v)}
              className={`px-3 py-1.5 transition-colors ${
                view === v
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200'
              } ${v === 'flat' ? 'rounded-l-lg' : 'rounded-r-lg'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          title="re-scan ~/.claude for new or stuck sessions"
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {rescan.isPending ? 'rescanning…' : 'rescan'}
        </button>
      </div>
    </div>
  )
}
