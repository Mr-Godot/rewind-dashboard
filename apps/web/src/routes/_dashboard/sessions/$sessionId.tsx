import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { metadataQuery } from '@/features/metadata/metadata.queries'
import { usePinSession, useRenameSession } from '@/features/metadata/useMetadataMutations'
import { LaunchButton } from '@/components/LaunchButton'
import { sessionDetailQuery } from '@/features/session-detail/session-detail.queries'
import { chatQuery } from '@/features/sessions/chat.queries'
import type { ChatMessage } from '@/features/sessions/chat.api'
import { TimelineEventsChart } from '@/features/session-detail/timeline-chart'
import { ContextWindowPanel } from '@/features/session-detail/ContextWindowPanel'
import { ToolUsagePanel } from '@/features/session-detail/ToolUsagePanel'
import { ErrorPanel } from '@/features/session-detail/ErrorPanel'
import { AgentDispatchesPanel, SkillInvocationsPanel } from '@/features/session-detail/AgentsSkillsPanel'
import { TasksPanel } from '@/features/session-detail/TasksPanel'
import { CostEstimationPanel } from '@/features/cost-estimation/CostEstimationPanel'
import { CostSummaryLine } from '@/features/cost-estimation/CostSummaryLine'
import { ActiveSessionBanner } from '@/features/session-detail/ActiveSessionBanner'
import { useIsSessionActive } from '@/features/sessions/useIsSessionActive'
import { formatDuration, formatDateTime } from '@/lib/utils/format'
import { sessionToJSON, downloadFile } from '@/lib/utils/export-utils'
import { ExportDropdown } from '@/components/ExportDropdown'
import { usePrivacy } from '@/features/privacy/PrivacyContext'
import { z } from 'zod'

const searchSchema = z.object({
  project: z.string().optional(),
})

export const Route = createFileRoute('/_dashboard/sessions/$sessionId')({
  validateSearch: searchSchema,
  component: SessionDetailPage,
})

function DetailPinButton({ sessionId, pinned }: { sessionId: string; pinned: boolean }) {
  const mutation = usePinSession()
  return (
    <button
      type="button"
      title={pinned ? 'Unpin session' : 'Pin session'}
      onClick={() => mutation.mutate({ sessionId, pinned: !pinned })}
      className={`shrink-0 rounded px-2 py-1 text-xs transition-colors ${
        pinned
          ? 'bg-amber-900/50 text-amber-400 hover:bg-amber-800/60'
          : 'bg-gray-800 text-gray-500 hover:text-amber-400'
      }`}
    >
      {pinned ? '\u2605 Pinned' : '\u2606 Pin'}
    </button>
  )
}

function DetailRenameButton({
  sessionId,
  currentName,
}: {
  sessionId: string
  currentName: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentName)
  const mutation = useRenameSession()

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              mutation.mutate({ sessionId, customName: value.trim() })
              setEditing(false)
            }
            if (e.key === 'Escape') setEditing(false)
          }}
          autoFocus
          className="rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-xs text-gray-100 outline-none focus:border-brand-500"
          placeholder="Session name..."
        />
        <button
          type="button"
          onClick={() => {
            mutation.mutate({ sessionId, customName: value.trim() })
            setEditing(false)
          }}
          className="rounded bg-brand-600 px-2 py-0.5 text-xs text-white hover:bg-brand-500"
        >
          OK
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-600"
        >
          X
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      title="Rename session"
      onClick={() => { setValue(currentName); setEditing(true) }}
      className="shrink-0 rounded bg-gray-800 px-2 py-1 text-xs text-gray-500 transition-colors hover:text-gray-300"
    >
      ✏️ Rename
    </button>
  )
}

function SessionDetailPage() {
  const { sessionId } = Route.useParams()
  const { project = '' } = Route.useSearch()

  const { privacyMode, anonymizeProjectName, anonymizeBranch } = usePrivacy()
  const isActive = useIsSessionActive(sessionId)
  const { data: metadata } = useQuery(metadataQuery)
  const sessionMeta = metadata?.sessions[sessionId]

  const { data: detail, isLoading, error } = useQuery(
    sessionDetailQuery(sessionId, project, isActive),
  )

  const queryClient = useQueryClient()
  const isGone = !!detail && 'notFound' in detail
  useEffect(() => {
    // Session's file is gone — drop the stale/phantom card from the list now
    // instead of waiting up to 30s for the next refetch.
    if (isGone) queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }, [isGone, queryClient])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
        <div className="h-64 animate-pulse rounded-xl bg-gray-900/50" />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-red-400">
          Failed to load session: {error?.message ?? 'Not found'}
        </p>
        <Link
          to="/sessions"
          className="mt-2 inline-block text-sm text-brand-300 hover:underline"
        >
          Back to sessions
        </Link>
      </div>
    )
  }

  if ('notFound' in detail) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-gray-300">this session no longer exists</p>
        <p className="mt-1 text-xs text-gray-500">
          its log file may have been deleted or rotated.
        </p>
        <Link
          to="/sessions"
          className="mt-2 inline-block text-sm text-brand-300 hover:underline"
        >
          Back to sessions
        </Link>
      </div>
    )
  }

  const firstUserTurn = detail.turns.find((t) => t.type === 'user' && t.message)
  const sessionTitle = sessionMeta?.customName || firstUserTurn?.message?.slice(0, 120) || detail.projectName

  const startedAt = detail.turns[0]?.timestamp
  const endedAt = detail.turns[detail.turns.length - 1]?.timestamp
  const durationMs =
    startedAt && endedAt
      ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
      : 0

  return (
    <div>
      {isActive && <ActiveSessionBanner />}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            to="/sessions"
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            &larr; Sessions
          </Link>
          <h1 className="mt-1 text-xl font-bold text-gray-100" title={sessionTitle}>
            {privacyMode
              ? anonymizeProjectName(detail.projectName)
              : sessionTitle}
          </h1>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="rounded bg-blue-900/20 border border-blue-800/40 px-1.5 py-0.5 text-xs text-blue-300">
              Project: {detail.projectName}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
            {detail.branch && (
              <span className="font-mono">{anonymizeBranch(detail.branch)}</span>
            )}
            {startedAt && <span>{formatDateTime(startedAt)}</span>}
            <span>{formatDuration(durationMs)}</span>
            <span>{detail.turns.length} turns</span>
            <CostSummaryLine tokensByModel={detail.tokensByModel} />
          </div>
          {detail.models.length > 0 && (
            <div className="mt-1 flex gap-1">
              {detail.models.map((m) => (
                <span
                  key={m}
                  className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-mono text-gray-400"
                >
                  {m.replace(/^claude-/, '').split('-202')[0]}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DetailPinButton sessionId={sessionId} pinned={sessionMeta?.pinned ?? false} />
          <DetailRenameButton sessionId={sessionId} currentName={sessionMeta?.customName || ''} />
          <LaunchButton sessionId={sessionId} cwd={detail.cwd || detail.projectPath} size="md" />
          <ExportDropdown
            options={[
              {
                label: 'Export Session (JSON)',
                onClick: () =>
                  downloadFile(
                    sessionToJSON(detail),
                    `session-${sessionId.slice(0, 8)}.json`,
                    'application/json',
                  ),
              },
            ]}
          />
          <span className="font-mono text-xs text-gray-600">
            {sessionId.slice(0, 8)}
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <ContextWindowPanel contextWindow={detail.contextWindow} tokens={detail.totalTokens} />
        <ToolUsagePanel toolFrequency={detail.toolFrequency} />
      </div>

      {/* Cost estimation */}
      <div className="mt-4">
        <CostEstimationPanel tokensByModel={detail.tokensByModel} />
      </div>

      {/* Agent Dispatches */}
      {detail.agents.length > 0 && (
        <div className="mt-4">
          <AgentDispatchesPanel agents={detail.agents} />
        </div>
      )}

      {/* Tasks */}
      {detail.tasks.length > 0 && (
        <div className="mt-4">
          <TasksPanel tasks={detail.tasks} />
        </div>
      )}

      <div className="mt-4">
        <ErrorPanel errors={detail.errors} />
      </div>

      {/* Timeline Events Chart */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-gray-300">Timeline</h2>
        <TimelineEventsChart
          turns={detail.turns}
          agents={detail.agents}
          skills={detail.skills}
          errors={detail.errors}
        />
      </div>

      {/* Skill Invocations */}
      {(detail.skills.length > 0 || detail.agents.some(a => (a.skills?.length ?? 0) > 0)) && (
        <div className="mt-6">
          <SkillInvocationsPanel agents={detail.agents} skills={detail.skills} />
        </div>
      )}

      {/* Conversation */}
      <div className="mt-6">
        <ConversationSection sessionId={sessionId} projectPath={detail.projectPath} />
      </div>

    </div>
  )
}

function ConversationSection({ sessionId, projectPath }: { sessionId: string; projectPath: string }) {
  const [expanded, setExpanded] = useState(false)
  const { data: messages, isLoading } = useQuery({
    ...chatQuery(sessionId, projectPath),
    enabled: expanded,
  })

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-300 hover:text-gray-100"
      >
        <span>Conversation</span>
        <span className="text-xs text-gray-500">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="border-t border-gray-800 px-4 py-4 space-y-3 max-h-[600px] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-800/50" />
              ))}
            </div>
          ) : messages && messages.length > 0 ? (
            messages.map((msg: ChatMessage, i: number) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-brand-600/30 text-gray-100'
                    : 'bg-gray-800 text-gray-300'
                }`}>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    {msg.role === 'user' ? 'You' : 'Claude'}
                    {msg.timestamp && (
                      <span className="ml-2 font-normal normal-case">{formatDateTime(msg.timestamp)}</span>
                    )}
                  </p>
                  <div className="whitespace-pre-wrap break-words">
                    {msg.text.length > 5000 ? msg.text.slice(0, 5000) + '\n\n[truncated...]' : msg.text}
                  </div>
                  {msg.toolNames && msg.toolNames.length > 0 && (
                    <p className="mt-1.5 text-[10px] text-gray-500">
                      Tools: {msg.toolNames.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-sm text-gray-500">No messages found</p>
          )}
        </div>
      )}
    </div>
  )
}
