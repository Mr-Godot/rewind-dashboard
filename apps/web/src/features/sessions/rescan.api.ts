import { createServerFn } from '@tanstack/react-start'
import { clearSummaryCache } from '@/lib/scanner/session-scanner'
import { pruneOrphans, listProjectDirsSync } from '@/features/metadata/metadata.api'

/**
 * Force a cold rescan: wipe the summary cache (in-memory + on-disk) and prune
 * metadata.projects keys for projects that no longer exist on disk.
 */
export const rescanSessions = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ cleared: boolean }> => {
    try {
      clearSummaryCache()
      pruneOrphans(listProjectDirsSync())
      return { cleared: true }
    } catch {
      return { cleared: false }
    }
  },
)
