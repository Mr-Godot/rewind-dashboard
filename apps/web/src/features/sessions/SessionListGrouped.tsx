import { useState, useMemo } from 'react'
import type { SessionSummary } from '@/lib/parsers/types'
import type { Metadata } from '@/features/metadata/metadata.types'
import { useHideProject, usePinProject } from '@/features/metadata/useMetadataMutations'
import { SessionCard } from './SessionCard'

interface SessionListGroupedProps {
  sessions: SessionSummary[]
  metadata?: Metadata
}

function ProjectHeader({
  projectName,
  projectPath,
  sessionCount,
  isPinned,
  isExpanded,
  onToggle,
}: {
  projectName: string
  projectPath: string
  sessionCount: number
  isPinned: boolean
  isExpanded: boolean
  onToggle: () => void
}) {
  const hideMutation = useHideProject()
  const pinMutation = usePinProject()

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/80 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          title={isPinned ? 'Unstar project' : 'Star project'}
          onClick={() => pinMutation.mutate({ projectPath, pinned: !isPinned })}
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs transition-colors ${
            isPinned
              ? 'bg-amber-900/50 text-amber-400 hover:bg-amber-800/60'
              : 'opacity-40 hover:opacity-100 text-gray-500 hover:text-amber-400'
          }`}
        >
          {isPinned ? '\u2605' : '\u2606'}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-sm font-semibold text-gray-200 hover:text-gray-100"
        >
          <span className="text-gray-500 text-xs">{isExpanded ? '\u25BC' : '\u25B6'}</span>
          {projectName}
        <span className="text-xs font-normal text-gray-500">
          {sessionCount} on page
        </span>
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="Hide project"
          onClick={() => hideMutation.mutate({ projectPath, hidden: true })}
          className="rounded px-1.5 py-0.5 text-xs text-gray-500 transition-colors hover:text-gray-300"
        >
          Hide
        </button>
      </div>
    </div>
  )
}

export function SessionListGrouped({ sessions, metadata }: SessionListGroupedProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('rewind-collapsed-projects')
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch {
      return new Set()
    }
  })

  function toggleProject(projectPath: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(projectPath)) {
        next.delete(projectPath)
      } else {
        next.add(projectPath)
      }
      try {
        localStorage.setItem('rewind-collapsed-projects', JSON.stringify([...next]))
      } catch {
        // ignore
      }
      return next
    })
  }

  const grouped = useMemo(() => {
    const map = new Map<string, { projectName: string; projectPath: string; sessions: SessionSummary[] }>()
    for (const s of sessions) {
      const existing = map.get(s.projectPath)
      if (existing) {
        existing.sessions.push(s)
      } else {
        map.set(s.projectPath, { projectName: s.projectName, projectPath: s.projectPath, sessions: [s] })
      }
    }
    return [...map.values()]
  }, [sessions])

  const projectMeta = metadata?.projects ?? {}

  return (
    <div className="space-y-3">
      {grouped.map((group) => {
        const isExpanded = !collapsed.has(group.projectPath)
        return (
          <div key={group.projectPath}>
            <ProjectHeader
              projectName={group.projectName}
              projectPath={group.projectPath}
              sessionCount={group.sessions.length}
              isPinned={projectMeta[group.projectPath]?.pinned ?? false}
              isExpanded={isExpanded}
              onToggle={() => toggleProject(group.projectPath)}
            />
            {isExpanded && (
              <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-800 pl-3">
                {group.sessions.map((session) => (
                  <SessionCard
                    key={session.sessionId}
                    session={session}
                    metadata={metadata?.sessions[session.sessionId]}
                    projectMeta={projectMeta[session.projectPath]}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
