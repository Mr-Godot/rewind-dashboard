import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SessionList } from '@/features/sessions/SessionList'

export const STATUS_OPTIONS = ['all', 'active', 'completed'] as const
export const SORT_OPTIONS = ['latest', 'mostActive', 'longest', 'largest', 'starred'] as const
export const VIEW_OPTIONS = ['flat', 'grouped'] as const

const sessionsSearchSchema = z.object({
  page: z.number().int().min(1).default(1).catch(1),
  pageSize: z.number().int().min(5).max(100).default(25).catch(25),
  search: z.string().default('').catch(''),
  status: z.enum(STATUS_OPTIONS).default('all').catch('all'),
  project: z.string().default('').catch(''),
  sort: z.enum(SORT_OPTIONS).default('latest').catch('latest'),
  starFirst: z.boolean().default(true).catch(true),
  view: z.enum(VIEW_OPTIONS).default('flat').catch('flat'),
  showHidden: z.boolean().default(false).catch(false),
})

export type SessionsSearch = z.infer<typeof sessionsSearchSchema>

export const Route = createFileRoute('/_dashboard/sessions/')({
  validateSearch: sessionsSearchSchema,
  component: SessionsPage,
})

function SessionsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-matrix">Sessions</h1>
      <p className="mt-1 text-sm text-gray-400">
        All Claude Code sessions from ~/.claude
      </p>
      <div className="mt-6">
        <SessionList />
      </div>
    </div>
  )
}
