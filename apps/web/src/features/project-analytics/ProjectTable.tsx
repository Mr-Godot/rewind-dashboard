import { useState, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { formatDuration, formatRelativeTime } from '@/lib/utils/format'
import { usePrivacy } from '@/features/privacy/PrivacyContext'
import { metadataQuery } from '@/features/metadata/metadata.queries'
import { usePinProject, useHideProject, useRenameProject } from '@/features/metadata/useMetadataMutations'
import type { ProjectAnalytics } from './project-analytics.api'

type SortField = 'projectName' | 'totalSessions' | 'totalMessages' | 'totalDurationMs' | 'lastSessionAt'
type SortDir = 'asc' | 'desc'

interface ProjectTableProps {
  projects: ProjectAnalytics[]
  showHidden: boolean
}

const COLUMNS: { key: SortField; label: string; align?: 'right' }[] = [
  { key: 'projectName', label: 'Project' },
  { key: 'totalSessions', label: 'Sessions', align: 'right' },
  { key: 'totalMessages', label: 'Messages', align: 'right' },
  { key: 'totalDurationMs', label: 'Duration', align: 'right' },
  { key: 'lastSessionAt', label: 'Last Active', align: 'right' },
]

export function ProjectTable({ projects, showHidden }: ProjectTableProps) {
  const { anonymizeProjectName } = usePrivacy()
  const [sortField, setSortField] = useState<SortField>('lastSessionAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const { data: metadata } = useQuery(metadataQuery)
  const pinMutation = usePinProject()
  const hideMutation = useHideProject()
  const renameMutation = useRenameProject()
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const projectMeta = metadata?.projects ?? {}

  const filtered = useMemo(() => {
    if (showHidden) return projects
    return projects.filter((p) => !projectMeta[p.projectPath]?.hidden)
  }, [projects, showHidden, projectMeta])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      // Pinned projects always first
      const aPinned = projectMeta[a.projectPath]?.pinned ? 1 : 0
      const bPinned = projectMeta[b.projectPath]?.pinned ? 1 : 0
      if (aPinned !== bPinned) return bPinned - aPinned

      let cmp = 0
      switch (sortField) {
        case 'projectName':
          cmp = a.projectName.localeCompare(b.projectName)
          break
        case 'totalSessions':
          cmp = a.totalSessions - b.totalSessions
          break
        case 'totalMessages':
          cmp = a.totalMessages - b.totalMessages
          break
        case 'totalDurationMs':
          cmp = a.totalDurationMs - b.totalDurationMs
          break
        case 'lastSessionAt':
          cmp = a.lastSessionAt.localeCompare(b.lastSessionAt)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filtered, sortField, sortDir, projectMeta])

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  function renderSortIndicator(field: SortField) {
    if (field !== sortField) return null
    return <span className="ml-1">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900/50">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-800">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`cursor-pointer px-4 py-3 text-xs font-medium text-gray-400 hover:text-gray-200 ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {col.label}
                {renderSortIndicator(col.key)}
              </th>
            ))}
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((project) => {
            const meta = projectMeta[project.projectPath]
            const isPinned = meta?.pinned ?? false
            const isHidden = meta?.hidden ?? false
            return (
              <tr
                key={project.projectPath}
                className={`group border-b border-gray-800/50 transition-colors hover:bg-gray-800/30 ${
                  isHidden ? 'opacity-50' : ''
                }`}
              >
                <td className="px-4 py-3">
                  {renamingPath === project.projectPath ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { renameMutation.mutate({ projectPath: project.projectPath, customName: renameValue.trim() }); setRenamingPath(null) }
                          if (e.key === 'Escape') setRenamingPath(null)
                        }}
                        autoFocus
                        className="w-48 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-sm text-gray-100 outline-none focus:border-brand-500"
                        placeholder="Project name..."
                      />
                      <button type="button" onClick={() => { renameMutation.mutate({ projectPath: project.projectPath, customName: renameValue.trim() }); setRenamingPath(null) }}
                        className="rounded bg-brand-600 px-2 py-0.5 text-xs text-white hover:bg-brand-500">OK</button>
                      <button type="button" onClick={() => setRenamingPath(null)}
                        className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-600">X</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        title={isPinned ? 'Unstar project' : 'Star project'}
                        onClick={() => pinMutation.mutate({ projectPath: project.projectPath, pinned: !isPinned })}
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs transition-colors ${
                          isPinned
                            ? 'bg-amber-900/50 text-amber-400 hover:bg-amber-800/60'
                            : 'opacity-40 hover:opacity-100 text-gray-500 hover:text-amber-400'
                        }`}
                      >
                        {isPinned ? '\u2605' : '\u2606'}
                      </button>
                      <Link
                        to="/sessions"
                        search={{ project: project.projectName }}
                        className="text-sm text-brand-500 hover:underline"
                      >
                        {meta?.customName || anonymizeProjectName(project.projectName)}
                      </Link>
                      <button
                        type="button"
                        title="Rename project"
                        onClick={() => { setRenameValue(meta?.customName || project.projectName); setRenamingPath(project.projectPath) }}
                        className="rounded px-1 py-0.5 text-xs text-gray-500 opacity-0 group-hover:opacity-100 hover:text-gray-300 transition-opacity"
                      >
                        ✏️
                      </button>
                      {meta?.customName && (
                        <span className="text-[10px] text-gray-600 font-mono">{project.projectName}</span>
                      )}
                      {project.activeSessions > 0 && (
                        <span className="rounded-full bg-matrix/20 px-1.5 py-0.5 text-[10px] font-medium text-matrix">
                          {project.activeSessions} active
                        </span>
                      )}
                      {isHidden && (
                        <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">
                          hidden
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                  {project.totalSessions}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                  {project.totalMessages.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                  {formatDuration(project.totalDurationMs)}
                </td>
                <td className="px-4 py-3 text-right text-sm text-gray-400">
                  {formatRelativeTime(project.lastSessionAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      title={isHidden ? 'Unhide project' : 'Hide project'}
                      onClick={() => hideMutation.mutate({ projectPath: project.projectPath, hidden: !isHidden })}
                      className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
                        isHidden
                          ? 'bg-blue-900/50 text-blue-400 hover:bg-blue-800/60'
                          : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {isHidden ? 'Show' : 'Hide'}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
