import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { getStatsPath } from '../utils/claude-path'
import { readDiskCache, writeDiskCache, getCacheDir } from '../cache/disk-cache'
import { StatsCacheSchema, type StatsCache } from './types'
import type { SessionDetail, SessionSummary, TokenUsage } from './types'
import { discoverSubagentFiles } from './subagent-discovery'
import { scanAllSessionsWithPaths, type SessionSummaryWithPath } from '@/lib/scanner/session-scanner'
import { parseDetail } from '@/lib/parsers/session-parser'

let cachedStats: { mtimeMs: number; data: StatsCache } | null = null

/** Cache for the merged (stats + recent sessions) result to avoid re-scanning on every request */
let mergedCache: { mtimeMs: number; mergedAt: number; data: StatsCache } | null = null
const MERGE_STALENESS_MS = 300_000 // re-scan at most every 5 minutes

function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]
}

function extractDateString(isoOrDate: string): string {
  return isoOrDate.split('T')[0]
}

export async function parseStats(): Promise<StatsCache | null> {
  const statsPath = getStatsPath()

  const stat = await fs.promises.stat(statsPath).catch(() => null)
  if (!stat) {
    // No precomputed stats file available — compute a minimal fallback from sessions
    try {
      const computed = await computeStatsFromSessions()
      return computed
    } catch {
      return null
    }
  }

  // Tier 1: in-memory mtime cache
  if (cachedStats && cachedStats.mtimeMs === stat.mtimeMs) {
    return maybeEnrichWithRecentSessions(cachedStats.data, stat.mtimeMs)
  }

  // Tier 2: disk cache
  const diskResult = readDiskCache('stats', stat.mtimeMs, StatsCacheSchema)
  if (diskResult) {
    cachedStats = { mtimeMs: stat.mtimeMs, data: diskResult }
    return maybeEnrichWithRecentSessions(diskResult, stat.mtimeMs)
  }

  // Tier 3: full parse from source
  try {
    const raw = await fs.promises.readFile(statsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const result = StatsCacheSchema.parse(parsed)

    writeDiskCache('stats', statsPath, stat.mtimeMs, result)
    cachedStats = { mtimeMs: stat.mtimeMs, data: result }
    return maybeEnrichWithRecentSessions(result, stat.mtimeMs)
  } catch {
    // If the stats file is malformed or fails validation, fall back to computing
    const computed = await computeStatsFromSessions()
    return computed
  }
}

/**
 * If stats data is stale (lastComputedDate is before today), merge in recent sessions.
 * Uses a 60-second in-memory cache to avoid re-scanning on every request.
 */
async function maybeEnrichWithRecentSessions(
  stats: StatsCache,
  mtimeMs: number,
): Promise<StatsCache> {
  const today = getTodayDateString()
  const lastComputed = extractDateString(stats.lastComputedDate)

  // Stats are up-to-date, no enrichment needed
  if (lastComputed >= today) {
    return stats
  }

  // Check merge cache: same file mtime and merged recently enough
  if (
    mergedCache &&
    mergedCache.mtimeMs === mtimeMs &&
    Date.now() - mergedCache.mergedAt < MERGE_STALENESS_MS
  ) {
    return mergedCache.data
  }

  // Merge recent sessions
  try {
    const merged = await mergeRecentSessions(stats)
    mergedCache = { mtimeMs, mergedAt: Date.now(), data: merged }
    return merged
  } catch {
    // If merge fails, return original stats rather than nothing
    return stats
  }
}

/**
 * The only three aggregates the stats merge needs out of a full SessionDetail.
 * Reducing immediately and dropping the SessionDetail keeps peak RSS flat — the
 * old Map<string, SessionDetail> held ~1 GB of parsed transcripts in memory.
 */
export interface Contribution {
  messageCount: number
  toolCallCount: number
  tokensByModel: Record<string, TokenUsage>
}

/** Bump to invalidate every persisted contribution after a computation change. */
const STATS_CONTRIBUTIONS_VERSION = 1

const TokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadInputTokens: z.number(),
  cacheCreationInputTokens: z.number(),
})

const ContributionEntrySchema = z.object({
  key: z.string(),
  contribution: z.object({
    messageCount: z.number(),
    toolCallCount: z.number(),
    tokensByModel: z.record(z.string(), TokenUsageSchema),
  }),
})

const ContributionsFileSchema = z.object({
  version: z.number(),
  entries: z.record(z.string(), ContributionEntrySchema),
})

type ContributionEntry = z.infer<typeof ContributionEntrySchema>

const contributionCache = new Map<string, ContributionEntry>()
let contributionCacheHydrated = false

function contributionsCachePath(): string {
  return path.join(getCacheDir(), 'stats-contributions.json')
}

function hydrateContributionCache(): void {
  if (contributionCacheHydrated) return
  contributionCacheHydrated = true
  try {
    const raw = fs.readFileSync(contributionsCachePath(), 'utf-8')
    const parsed = ContributionsFileSchema.safeParse(JSON.parse(raw))
    if (!parsed.success || parsed.data.version !== STATS_CONTRIBUTIONS_VERSION) return
    for (const [sessionId, entry] of Object.entries(parsed.data.entries)) {
      contributionCache.set(sessionId, entry)
    }
  } catch {
    // Missing, truncated or unreadable — start cold. Never fatal.
  }
}

function persistContributionCache(): void {
  try {
    fs.mkdirSync(getCacheDir(), { recursive: true })
    const entries: Record<string, ContributionEntry> = {}
    for (const [sessionId, entry] of contributionCache) entries[sessionId] = entry
    const cachePath = contributionsCachePath()
    const tmpPath = `${cachePath}.tmp`
    fs.writeFileSync(
      tmpPath,
      JSON.stringify({ version: STATS_CONTRIBUTIONS_VERSION, entries }),
      'utf-8',
    )
    fs.renameSync(tmpPath, cachePath)
  } catch {
    // Cache write failure must never break stats.
  }
}

/**
 * Fingerprint of the session's subagent transcripts: file count, newest mtime and
 * which directory variants contributed. parseDetail reads these files, and real
 * sessions have subagent files NEWER than the parent JSONL, so keying on the
 * parent mtime alone would freeze wrong token totals forever.
 */
async function subagentFingerprint(filePath: string): Promise<string> {
  const sessionDir = filePath.replace(/\.jsonl$/, '')
  const files = await discoverSubagentFiles(sessionDir)
  let count = 0
  let newest = 0
  const variants = new Set<string>()
  for (const agentPath of files.values()) {
    const stat = await fs.promises.stat(agentPath).catch(() => null)
    if (!stat) continue
    count += 1
    if (stat.mtimeMs > newest) newest = stat.mtimeMs
    variants.add(path.basename(path.dirname(agentPath)))
  }
  return `${count}:${newest}:${Array.from(variants).sort().join('+')}`
}

/** Cache key: relative to the session only, so it survives moving the repo on disk. */
async function contributionKey(session: SessionSummaryWithPath): Promise<string> {
  const fingerprint = await subagentFingerprint(session.filePath)
  return `${session.mtimeMs}:${session.fileSizeBytes}:${fingerprint}`
}

function reduceDetail(detail: SessionDetail): Contribution {
  const tokensByModel: Record<string, TokenUsage> = {}
  for (const [model, usage] of Object.entries(detail.tokensByModel)) {
    tokensByModel[model] = { ...usage }
  }
  return {
    messageCount: detail.turns.length,
    toolCallCount: Object.values(detail.toolFrequency).reduce((sum, n) => sum + n, 0),
    tokensByModel,
  }
}

/**
 * Resolve the stats contribution of each session, reusing the persisted cache for
 * every session whose JSONL and subagent transcripts are unchanged.
 *
 * `knownSessionIds` is the full set of sessions currently on disk (which may be
 * wider than `sessions`, since the merge only looks at the post-cutoff window);
 * anything outside it is pruned so the cache file cannot grow without bound.
 */
async function collectContributions(
  sessions: SessionSummaryWithPath[],
  knownSessionIds: Set<string>,
  batchSize: number = 10,
): Promise<Map<string, Contribution>> {
  hydrateContributionCache()
  const results = new Map<string, Contribution>()
  let dirty = false

  for (let i = 0; i < sessions.length; i += batchSize) {
    const batch = sessions.slice(i, i + batchSize)
    const outcomes = await Promise.all(
      batch.map(async (s) => {
        const key = await contributionKey(s)
        const cached = contributionCache.get(s.sessionId)
        if (cached && cached.key === key) {
          return { sessionId: s.sessionId, key, contribution: cached.contribution, changed: false }
        }
        try {
          const detail = await parseDetail(
            s.filePath, s.sessionId, s.projectPath, s.projectName,
          )
          // Reduce immediately; the SessionDetail is unreachable after this line.
          return { sessionId: s.sessionId, key, contribution: reduceDetail(detail), changed: true }
        } catch {
          return null // Skip sessions that fail to parse — never cache a zero
        }
      }),
    )

    for (const outcome of outcomes) {
      if (!outcome) continue
      results.set(outcome.sessionId, outcome.contribution)
      if (outcome.changed) {
        contributionCache.set(outcome.sessionId, {
          key: outcome.key,
          contribution: outcome.contribution,
        })
        dirty = true
      }
    }
  }

  for (const sessionId of contributionCache.keys()) {
    if (!knownSessionIds.has(sessionId)) {
      contributionCache.delete(sessionId)
      dirty = true
    }
  }

  if (dirty) persistContributionCache()
  return results
}

/**
 * Scans all sessions, finds those with activity after the stats' lastComputedDate,
 * parses full details for accurate token/tool data, and merges into the stats result.
 */
async function mergeRecentSessions(stats: StatsCache): Promise<StatsCache> {
  const summaries = await scanAllSessionsWithPaths()
  const cutoffDate = extractDateString(stats.lastComputedDate)

  // Filter to sessions active after the cutoff date
  const recentSessions = summaries.filter((s) => {
    const sessionDate = extractDateString(s.lastActiveAt ?? s.startedAt)
    return sessionDate > cutoffDate
  })

  if (recentSessions.length === 0) {
    return stats
  }

  // Resolve contributions for recent sessions (batched, max 10 concurrent, cached)
  const contributions = await collectContributions(
    recentSessions,
    new Set(summaries.map((s) => s.sessionId)),
  )

  // Build a mutable copy of dailyActivity keyed by date
  const activityMap = new Map<string, { messageCount: number; sessionCount: number; toolCallCount: number }>()
  for (const entry of stats.dailyActivity) {
    activityMap.set(entry.date, {
      messageCount: entry.messageCount,
      sessionCount: entry.sessionCount,
      toolCallCount: entry.toolCallCount,
    })
  }

  // Build a mutable copy of dailyModelTokens keyed by date
  const modelTokensMap = new Map<string, Record<string, number>>()
  for (const entry of stats.dailyModelTokens) {
    modelTokensMap.set(entry.date, { ...entry.tokensByModel })
  }

  // Build a mutable copy of hourCounts
  const hourCounts: Record<string, number> = { ...stats.hourCounts }

  // Deep copy existing modelUsage for enrichment
  const modelUsage: Record<string, {
    inputTokens: number; outputTokens: number
    cacheReadInputTokens: number; cacheCreationInputTokens: number
  }> = {}
  for (const [model, usage] of Object.entries(stats.modelUsage)) {
    modelUsage[model] = { ...usage }
  }

  // Track new totals
  let additionalMessages = 0
  const additionalSessions = recentSessions.length
  let longestSession = { ...stats.longestSession }
  const existingSessionCount = stats.totalSessions

  for (const s of recentSessions) {
    const date = extractDateString(s.lastActiveAt ?? s.startedAt)
    const contribution = contributions.get(s.sessionId)

    const cur = activityMap.get(date) ?? { messageCount: 0, sessionCount: 0, toolCallCount: 0 }
    cur.sessionCount += 1

    if (contribution) {
      // Use accurate data from full parse
      cur.messageCount += contribution.messageCount
      cur.toolCallCount += contribution.toolCallCount

      // Populate dailyModelTokens with input+output tokens (matches stats-cache methodology;
      // cache tokens are excluded from daily totals but included in modelUsage aggregate)
      const dayTokens = modelTokensMap.get(date) ?? {}
      for (const [model, usage] of Object.entries(contribution.tokensByModel)) {
        const total = usage.inputTokens + usage.outputTokens
        dayTokens[model] = (dayTokens[model] ?? 0) + total
      }
      modelTokensMap.set(date, dayTokens)

      // Update aggregate modelUsage with per-category breakdown
      for (const [model, usage] of Object.entries(contribution.tokensByModel)) {
        const existing = modelUsage[model] ?? {
          inputTokens: 0, outputTokens: 0,
          cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        }
        existing.inputTokens += usage.inputTokens
        existing.outputTokens += usage.outputTokens
        existing.cacheReadInputTokens += usage.cacheReadInputTokens
        existing.cacheCreationInputTokens += usage.cacheCreationInputTokens
        modelUsage[model] = existing
      }

      additionalMessages += contribution.messageCount
    } else {
      // Fallback: use summary data if parseDetail() failed for this session
      cur.messageCount += s.messageCount
      additionalMessages += s.messageCount

      if (!modelTokensMap.has(date)) {
        modelTokensMap.set(date, {})
      }
    }

    activityMap.set(date, cur)

    // Update hourCounts from session timestamps
    updateHourCounts(hourCounts, s)

    // Check if this session is the longest
    if (s.durationMs > longestSession.duration) {
      longestSession = {
        sessionId: s.sessionId,
        duration: s.durationMs,
        messageCount: contribution?.messageCount ?? s.messageCount,
        timestamp: s.lastActiveAt ?? s.startedAt,
      }
    }
  }

  // Rebuild sorted dailyActivity
  const dailyActivity = Array.from(activityMap.entries())
    .map(([date, v]) => ({
      date,
      messageCount: v.messageCount,
      sessionCount: v.sessionCount,
      toolCallCount: v.toolCallCount,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  // Rebuild sorted dailyModelTokens
  const dailyModelTokens = Array.from(modelTokensMap.entries())
    .map(([date, tokensByModel]) => ({ date, tokensByModel }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  return {
    ...stats,
    dailyActivity,
    dailyModelTokens,
    modelUsage,
    totalSessions: existingSessionCount + additionalSessions,
    totalMessages: stats.totalMessages + additionalMessages,
    longestSession,
    hourCounts,
  }
}

/** Extract hour from session timestamps and increment hourCounts */
function updateHourCounts(hourCounts: Record<string, number>, session: SessionSummary): void {
  // Use startedAt for the hour bucket
  const startedAt = session.startedAt
  if (!startedAt) return

  try {
    const date = new Date(startedAt)
    const hour = date.getHours().toString()
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1
  } catch {
    // Ignore malformed timestamps
  }
}

/**
 * Compute stats from scratch by scanning all sessions and parsing full details.
 * Used as a fallback when ~/.claude/stats-cache.json does not exist.
 */
async function computeStatsFromSessions(): Promise<StatsCache | null> {
  try {
    const summaries = await scanAllSessionsWithPaths()

    // Resolve per-session token and tool contributions (cached across requests)
    const contributions = await collectContributions(
      summaries,
      new Set(summaries.map((s) => s.sessionId)),
    )

    // Group by date and aggregate
    const activityMap = new Map<string, { messageCount: number; sessionCount: number; toolCallCount: number }>()
    const modelTokensMap = new Map<string, Record<string, number>>()
    const modelUsage: Record<string, {
      inputTokens: number; outputTokens: number
      cacheReadInputTokens: number; cacheCreationInputTokens: number
    }> = {}
    const hourCounts: Record<string, number> = {}
    let totalMessages = 0
    let longestSession = { sessionId: '', duration: 0, messageCount: 0, timestamp: '' }
    let firstSessionDate: string | null = null

    for (const s of summaries) {
      const d = (s.lastActiveAt ?? s.startedAt).split('T')[0]
      const contribution = contributions.get(s.sessionId)

      const cur = activityMap.get(d) ?? { messageCount: 0, sessionCount: 0, toolCallCount: 0 }
      cur.sessionCount += 1

      if (contribution) {
        cur.messageCount += contribution.messageCount
        cur.toolCallCount += contribution.toolCallCount
        totalMessages += contribution.messageCount

        // Per-day model tokens (input+output only, matching stats-cache methodology)
        const dayTokens = modelTokensMap.get(d) ?? {}
        for (const [model, usage] of Object.entries(contribution.tokensByModel)) {
          const total = usage.inputTokens + usage.outputTokens
          dayTokens[model] = (dayTokens[model] ?? 0) + total
        }
        modelTokensMap.set(d, dayTokens)

        // Aggregate model usage
        for (const [model, usage] of Object.entries(contribution.tokensByModel)) {
          const existing = modelUsage[model] ?? {
            inputTokens: 0, outputTokens: 0,
            cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
          }
          existing.inputTokens += usage.inputTokens
          existing.outputTokens += usage.outputTokens
          existing.cacheReadInputTokens += usage.cacheReadInputTokens
          existing.cacheCreationInputTokens += usage.cacheCreationInputTokens
          modelUsage[model] = existing
        }
      } else {
        // Fallback: use summary data if parseDetail() failed
        cur.messageCount += s.messageCount
        totalMessages += s.messageCount
        if (!modelTokensMap.has(d)) modelTokensMap.set(d, {})
      }

      activityMap.set(d, cur)
      updateHourCounts(hourCounts, s)

      const msgCount = contribution?.messageCount ?? s.messageCount
      if (s.durationMs > longestSession.duration) {
        longestSession = {
          sessionId: s.sessionId,
          duration: s.durationMs,
          messageCount: msgCount,
          timestamp: s.lastActiveAt ?? s.startedAt,
        }
      }

      if (!firstSessionDate || s.startedAt < firstSessionDate) {
        firstSessionDate = s.startedAt
      }
    }

    const dailyActivity = Array.from(activityMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => (a.date < b.date ? -1 : 1))

    const dailyModelTokens = Array.from(modelTokensMap.entries())
      .map(([date, tokensByModel]) => ({ date, tokensByModel }))
      .sort((a, b) => (a.date < b.date ? -1 : 1))

    return {
      version: 1,
      lastComputedDate: new Date().toISOString(),
      dailyActivity,
      dailyModelTokens,
      modelUsage,
      totalSessions: summaries.length,
      totalMessages,
      longestSession: {
        sessionId: longestSession.sessionId,
        duration: longestSession.duration,
        messageCount: longestSession.messageCount,
        timestamp: longestSession.timestamp || new Date().toISOString(),
      },
      firstSessionDate: firstSessionDate ?? new Date().toISOString(),
      hourCounts,
    }
  } catch {
    return null
  }
}
