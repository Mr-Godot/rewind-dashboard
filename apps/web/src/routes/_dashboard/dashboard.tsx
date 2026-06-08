import { useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { statsQuery } from '@/features/stats/stats.queries'
import { paginatedSessionListQuery } from '@/features/sessions/sessions.queries'
import { metadataQuery } from '@/features/metadata/metadata.queries'
import { ActivityChart } from '@/features/stats/ActivityChart'
import { ContributionHeatmap } from '@/features/stats/ContributionHeatmap'
import { TokenTrendChart } from '@/features/stats/TokenTrendChart'
import { ModelUsageChart } from '@/features/stats/ModelUsageChart'
import { HourlyDistribution } from '@/features/stats/HourlyDistribution'
import { SessionCard } from '@/features/sessions/SessionCard'
import { ExportDropdown } from '@/components/ExportDropdown'
import { TerminalLoader } from '@/components/TerminalLoader'
import {
  dailyActivityToCSV,
  dailyTokensToCSV,
  modelUsageToCSV,
  statsToJSON,
  downloadFile,
} from '@/lib/utils/export-utils'
import { useSessionCost } from '@/features/cost-estimation/useSessionCost'
import { formatDuration, formatTokenCount, formatUSD } from '@/lib/utils/format'
import type { TokenUsage } from '@/lib/parsers/types'

export const Route = createFileRoute('/_dashboard/dashboard')({
  component: DashboardPage,
})

const EMPTY_TOKENS_BY_MODEL: Record<string, TokenUsage> = {}

function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery(statsQuery)
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery(
    paginatedSessionListQuery({
      page: 1,
      pageSize: 5,
      search: '',
      status: 'all',
      project: '',
      sort: 'latest',
      starFirst: false,
    }),
  )
  const { data: metadata } = useQuery(metadataQuery)

  const tokensByModel = useMemo(() => {
    if (!stats) return EMPTY_TOKENS_BY_MODEL
    const result: Record<string, TokenUsage> = {}
    for (const [model, usage] of Object.entries(stats.modelUsage)) {
      result[model] = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
      }
    }
    return result
  }, [stats])

  const { cost } = useSessionCost(tokensByModel)

  // Time-period breakdowns
  const periods = useMemo(() => {
    if (!stats) return null
    const now = new Date()
    const dayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    function sumPeriod(since: Date) {
      const days = stats!.dailyActivity.filter((d) => new Date(d.date) >= since)
      const tokenDays = stats!.dailyModelTokens.filter((d) => new Date(d.date) >= since)
      const sessionCount = days.reduce((s, d) => s + d.sessionCount, 0)
      const toolCalls = days.reduce((s, d) => s + d.toolCallCount, 0)
      let totalTokens = 0
      for (const day of tokenDays) {
        for (const count of Object.values(day.tokensByModel)) {
          totalTokens += count
        }
      }
      return { sessionCount, toolCalls, totalTokens }
    }

    const total = {
      sessionCount: stats.totalSessions,
      toolCalls: stats.dailyActivity.reduce((s, d) => s + d.toolCallCount, 0),
      totalTokens: Object.values(stats.modelUsage).reduce((s, m) => s + m.inputTokens + m.outputTokens, 0),
      inputTokens: Object.values(stats.modelUsage).reduce((s, m) => s + m.inputTokens, 0),
      outputTokens: Object.values(stats.modelUsage).reduce((s, m) => s + m.outputTokens, 0),
    }

    return {
      today: sumPeriod(dayAgo),
      week: sumPeriod(weekAgo),
      month: sumPeriod(monthAgo),
      total,
    }
  }, [stats])

  const thisWeekSessions = periods?.week.sessionCount ?? 0

  if (statsLoading && sessionsLoading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-matrix">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-400">Overview of your Claude Code activity</p>
        <TerminalLoader />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-matrix">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-400">Overview of your Claude Code activity</p>
        </div>
        {stats && (
          <ExportDropdown
            options={[
              {
                label: 'Daily Activity (CSV)',
                onClick: () => downloadFile(dailyActivityToCSV(stats), 'daily-activity.csv', 'text/csv'),
              },
              {
                label: 'Token Usage (CSV)',
                onClick: () => downloadFile(dailyTokensToCSV(stats), 'daily-tokens.csv', 'text/csv'),
              },
              {
                label: 'Model Usage (CSV)',
                onClick: () => downloadFile(modelUsageToCSV(stats), 'model-usage.csv', 'text/csv'),
              },
              {
                label: 'Full Stats (JSON)',
                onClick: () => downloadFile(statsToJSON(stats), 'stats.json', 'application/json'),
              },
            ]}
          />
        )}
      </div>

      {/* Unified Stats Box */}
      <div className="mt-6 border border-gray-800 bg-gray-900/50 p-4">
        <div className="grid grid-cols-4 gap-4 md:gap-6">
          <Link to="/sessions" className="group">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Sessions</p>
            <p className="mt-1 text-xl font-bold text-gray-100 group-hover:text-matrix transition-colors">{stats ? String(stats.totalSessions) : '--'}</p>
            <p className="text-xs text-gray-500">{thisWeekSessions} this week</p>
          </Link>
          <Link to="/sessions" className="group">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Messages</p>
            <p className="mt-1 text-xl font-bold text-gray-100 group-hover:text-matrix transition-colors">{stats ? stats.totalMessages.toLocaleString() : '--'}</p>
            <p className="text-xs text-gray-500">{stats ? formatDuration(stats.longestSession.duration) : '--'} longest</p>
          </Link>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Tokens</p>
            <p className="mt-1 text-xl font-bold text-matrix/80">{periods ? formatTokenCount(periods.total.totalTokens) : '--'}</p>
            <p className="text-xs text-gray-500">{periods ? formatTokenCount(periods.week.totalTokens) : '--'} 7d</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Cost</p>
            <p className="mt-1 text-xl font-bold text-gray-100">{cost ? `~${formatUSD(cost.totalUSD)}` : '--'}</p>
            <p className="text-xs text-gray-500">{periods ? `${periods.today.sessionCount} today` : ''}</p>
          </div>
        </div>

        {/* Tokens & Cost period breakdown */}
        {periods && (
          <>
            <div className="my-3 border-t border-gray-800" />
            <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Tokens & Cost</p>
            <div className="grid grid-cols-4 gap-4 md:gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Today</p>
                <p className="mt-1 text-xl font-bold text-gray-100">{formatTokenCount(periods.today.totalTokens)}</p>
                <p className="text-xs text-gray-500">{periods.today.sessionCount} sessions</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500">7 Days</p>
                <p className="mt-1 text-xl font-bold text-gray-100">{formatTokenCount(periods.week.totalTokens)}</p>
                <p className="text-xs text-gray-500">{periods.week.sessionCount} sessions</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500">30 Days</p>
                <p className="mt-1 text-xl font-bold text-gray-100">{formatTokenCount(periods.month.totalTokens)}</p>
                <p className="text-xs text-gray-500">{periods.month.sessionCount} sessions</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500">All Time</p>
                <p className="mt-1 text-xl font-bold text-gray-100">{formatTokenCount(periods.total.totalTokens)}</p>
                <p className="text-xs text-gray-500">{cost ? `~${formatUSD(cost.totalUSD)}` : ''}</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Recent Sessions — uses SessionCard like sessions tab */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">Recent Sessions</h2>
          <Link to="/sessions" className="text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors">
            View all &rarr;
          </Link>
        </div>
        {sessionsData && sessionsData.sessions.length > 0 ? (
          <div className="mt-3 space-y-2">
            {sessionsData.sessions.map((session) => (
              <SessionCard
                key={session.sessionId}
                session={session}
                metadata={metadata?.sessions[session.sessionId]}
                projectMeta={metadata?.projects[session.projectPath]}
              />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-gray-500">No sessions found</div>
        )}
      </div>

      {/* Full Charts Section */}
      {stats && (
        <>
          <div className="mt-6">
            <ContributionHeatmap dailyActivity={stats.dailyActivity} dailyModelTokens={stats.dailyModelTokens} />
          </div>

          <div className="mt-4">
            <ActivityChart data={stats.dailyActivity} />
          </div>

          <div className="mt-4">
            <TokenTrendChart data={stats.dailyModelTokens} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <ModelUsageChart data={stats.modelUsage} />
            <HourlyDistribution hourCounts={stats.hourCounts} />
          </div>
        </>
      )}
    </div>
  )
}



