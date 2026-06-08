import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectAnalyticsQuery } from './project-analytics.queries'
import { ProjectTable } from './ProjectTable'
import { formatDuration } from '@/lib/utils/format'
import { usePrivacy } from '@/features/privacy/PrivacyContext'
import { metadataQuery } from '@/features/metadata/metadata.queries'

export function ProjectAnalytics() {
  const { anonymizeProjectName } = usePrivacy()
  const { data, isLoading } = useQuery(projectAnalyticsQuery)
  const { data: metadata } = useQuery(metadataQuery)
  const [showHidden, setShowHidden] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl bg-gray-900/50"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-gray-900/50" />
      </div>
    )
  }

  const allProjects = data?.projects ?? []

  if (allProjects.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-500">
        No projects found. Sessions will appear here once scanned.
      </div>
    )
  }

  const projectMeta = metadata?.projects ?? {}
  const hiddenCount = allProjects.filter((p) => projectMeta[p.projectPath]?.hidden).length

  // Summary cards use visible projects only (unless showHidden)
  const visibleProjects = showHidden
    ? allProjects
    : allProjects.filter((p) => !projectMeta[p.projectPath]?.hidden)

  const totalSessions = visibleProjects.reduce((sum, p) => sum + p.totalSessions, 0)
  const totalDurationMs = visibleProjects.reduce((sum, p) => sum + p.totalDurationMs, 0)

  const mostActive = visibleProjects.length > 0
    ? visibleProjects.reduce((max, p) => (p.totalSessions > max.totalSessions ? p : max))
    : null

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Total Projects" value={String(visibleProjects.length)} />
        <SummaryCard
          label="Total Sessions"
          value={totalSessions.toLocaleString()}
        />
        <SummaryCard
          label="Total Duration"
          value={formatDuration(totalDurationMs)}
        />
        {mostActive && (
          <SummaryCard
            label="Most Active"
            value={anonymizeProjectName(mostActive.projectName)}
            sub={`${mostActive.totalSessions} sessions`}
          />
        )}
      </div>

      {/* Toolbar */}
      {hiddenCount > 0 && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800"
            />
            Show hidden projects ({hiddenCount})
          </label>
        </div>
      )}

      {/* Project table */}
      <ProjectTable projects={allProjects} showHidden={showHidden} />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 truncate text-xl font-bold text-gray-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  )
}
