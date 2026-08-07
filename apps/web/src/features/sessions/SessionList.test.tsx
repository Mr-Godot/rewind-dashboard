import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SessionSummary } from '@/lib/parsers/types'
import type { PaginatedSessionsResult, SessionListItem } from './sessions.api'
import { STORAGE_KEY } from './useSessionFilterPreferences'

// --- Mocks -----------------------------------------------------------------
// The route module is mocked to break the SessionList <-> route cycle and to
// drive Route.useSearch() from the test. STATUS/SORT/VIEW_OPTIONS must stay
// exported: useSessionFilterPreferences (kept REAL, so the persisted-value
// assertions are end to end through localStorage) imports them from here.
const searchState = {
  page: 1,
  pageSize: 25,
  search: '',
  status: 'all' as 'all' | 'active' | 'completed',
  project: '',
  sort: 'latest',
  starFirst: true,
  view: 'flat',
  showHidden: false,
}

const navigateMock = vi.fn()

vi.mock('@/routes/_dashboard/sessions/index', () => ({
  Route: { useSearch: () => ({ ...searchState }) },
  STATUS_OPTIONS: ['all', 'active', 'completed'],
  SORT_OPTIONS: ['latest', 'mostActive', 'longest', 'largest', 'starred'],
  VIEW_OPTIONS: ['flat', 'grouped'],
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

let paginatedResult: () => Promise<PaginatedSessionsResult>

vi.mock('./sessions.queries', () => ({
  activeSessionsQuery: {
    queryKey: ['sessions', 'active'],
    queryFn: async () => [],
  },
  paginatedSessionListQuery: (params: Record<string, unknown>) => {
    const { hasActive: _hasActive, ...data } = params
    return {
      queryKey: ['sessions', 'paginated', data],
      queryFn: () => paginatedResult(),
      placeholderData: keepPreviousData,
    }
  },
}))

vi.mock('@/features/metadata/metadata.queries', () => ({
  metadataQuery: {
    queryKey: ['metadata'],
    queryFn: async () => ({ sessions: {}, projects: {} }),
  },
}))

const hideProjectMutate = vi.fn()
const hideSessionMutate = vi.fn()
vi.mock('@/features/metadata/useMetadataMutations', () => ({
  useHideProject: () => ({ mutate: hideProjectMutate }),
  useHideSession: () => ({ mutate: hideSessionMutate }),
}))

const rescanMutate = vi.fn()
vi.mock('./rescan.queries', () => ({
  useRescan: () => ({ mutate: rescanMutate, isPending: false }),
}))

vi.mock('./SessionFilters', () => ({
  SessionFilters: () => <div data-testid="session-filters" />,
}))
vi.mock('./PaginationControls', () => ({
  PaginationControls: () => <div data-testid="pagination" />,
}))
vi.mock('./SessionListGrouped', () => ({
  SessionListGrouped: () => <div data-testid="grouped" />,
}))
const ftsProps: Array<{ newestSessionAt?: string | null }> = []
vi.mock('./FullTextSearchResults', () => ({
  FullTextSearchResults: (props: { newestSessionAt?: string | null }) => {
    ftsProps.push(props)
    return <div data-testid="fts" />
  },
  MIN_FTS_QUERY_LENGTH: 3,
}))
vi.mock('./SessionCard', () => ({
  SessionCard: ({ session }: { session: SessionListItem }) => (
    <div data-testid="session-card" data-hidden-reason={session.hiddenReason ?? ''}>
      {session.sessionId}
    </div>
  ),
}))
vi.mock('./usePageSizePreference', () => ({
  usePageSizePreference: () => ({ storedPageSize: null, setPageSize: vi.fn() }),
}))

import { SessionList } from './SessionList'
import { PrivacyProvider } from '@/features/privacy/PrivacyContext'

// --- Fixtures --------------------------------------------------------------

function session(id: string): SessionSummary {
  return {
    sessionId: id,
    projectDir: 'C--Users-dev--work-rewind-dashboard',
    projectPath: 'C:/Users/dev/_work/rewind-dashboard',
    projectName: 'rewind-dashboard',
    realPath: 'C:\\Users\\dev\\_work\\rewind-dashboard',
    pathExists: true,
    branch: 'main',
    cwd: 'C:\\Users\\dev\\_work\\rewind-dashboard',
    startedAt: '2026-08-01T09:00:00.000Z',
    lastActiveAt: '2026-08-01T10:00:00.000Z',
    durationMs: 3_600_000,
    messageCount: 10,
    userMessageCount: 5,
    assistantMessageCount: 5,
    isActive: false,
    sessionState: 'inactive',
    model: 'claude-opus-5',
    version: '1.0.0',
    fileSizeBytes: 1024,
    totalTokens: 100,
    firstUserMessage: 'hello',
    claudeName: null,
  }
}

function result(over: Partial<PaginatedSessionsResult> = {}): PaginatedSessionsResult {
  const sessions = over.sessions ?? [session('s1'), session('s2'), session('s3')]
  return {
    sessions,
    totalCount: sessions.length,
    totalPages: 1,
    page: 1,
    pageSize: 25,
    projects: ['rewind-dashboard'],
    projectDirs: ['C--Users-dev--work-rewind-dashboard'],
    hiddenProjects: [],
    hiddenSessionCount: 0,
    hiddenSessions: [],
    hiddenSessionOnlyCount: 0,
    hiddenMatchCount: 0,
    ...over,
  }
}

let client: QueryClient

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <PrivacyProvider>{children}</PrivacyProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  navigateMock.mockReset()
  rescanMutate.mockReset()
  hideProjectMutate.mockReset()
  hideSessionMutate.mockReset()
  localStorage.clear()
  Object.assign(searchState, {
    page: 1,
    pageSize: 25,
    search: '',
    status: 'all',
    project: '',
    sort: 'latest',
    starFirst: true,
    view: 'flat',
    showHidden: false,
  })
  paginatedResult = async () => result()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  client.clear()
})

describe('SessionList empty states', () => {
  it('offers a Show-hidden action when every session is hidden and no filter is set', async () => {
    paginatedResult = async () =>
      result({
        sessions: [],
        totalCount: 0,
        hiddenSessionCount: 6,
        hiddenProjects: [
          { projectDir: 'dir-a', projectName: 'rewind-dashboard', sessionCount: 6 },
        ],
      })

    render(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('Every session is hidden')).toBeTruthy()
    })
    expect(screen.getByTestId('empty-state')).toBeTruthy()

    screen.getByRole('button', { name: /show hidden sessions/i }).click()

    expect(navigateMock).toHaveBeenCalled()
    const call = navigateMock.mock.calls.at(-1)![0]
    expect(call.to).toBe('/sessions')
    expect(call.search({ ...searchState })).toMatchObject({ showHidden: true, page: 1 })
  })

  it('offers a Show-hidden action when every session was hidden one by one', async () => {
    paginatedResult = async () =>
      result({
        sessions: [],
        totalCount: 0,
        hiddenSessionCount: 0,
        hiddenProjects: [],
        hiddenSessionOnlyCount: 2,
        hiddenSessions: [
          { sessionId: 's1', projectName: 'rewind-dashboard', claudeName: null, firstUserMessage: 'hello' },
          { sessionId: 's2', projectName: 'rewind-dashboard', claudeName: null, firstUserMessage: 'bye' },
        ],
      })

    render(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('Every session is hidden')).toBeTruthy()
    })
    expect(screen.getByText('All 2 sessions were hidden one by one.')).toBeTruthy()
    expect(screen.getByText('2 sessions hidden one by one')).toBeTruthy()
  })

  it('counts project-hidden and individually hidden sessions separately in the banner', async () => {
    paginatedResult = async () =>
      result({
        hiddenSessionCount: 6,
        hiddenProjects: [
          { projectDir: 'dir-a', projectName: 'rewind-dashboard', sessionCount: 6 },
        ],
        hiddenSessionOnlyCount: 1,
        hiddenSessions: [
          { sessionId: 'z9', projectName: 'other', claudeName: 'named one', firstUserMessage: null },
        ],
      })

    render(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(
        screen.getByText('6 sessions in 1 hidden project, plus 1 session hidden one by one'),
      ).toBeTruthy()
    })

    act(() => {
      screen.getByRole('button', { name: /list/i }).click()
    })

    const unhideButtons = screen.getAllByRole('button', { name: /^unhide$/i })
    expect(unhideButtons).toHaveLength(2)
    unhideButtons[1].click()
    expect(hideSessionMutate).toHaveBeenCalledWith({ sessionId: 'z9', hidden: false })
  })

  it('offers a Rescan action when nothing exists at all', async () => {
    paginatedResult = async () =>
      result({ sessions: [], totalCount: 0, hiddenSessionCount: 0, projects: [], projectDirs: [] })

    render(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('No sessions found in ~/.claude')).toBeTruthy()
    })

    screen.getByRole('button', { name: /^rescan$/i }).click()

    expect(rescanMutate).toHaveBeenCalledTimes(1)
  })

  it('enumerates the active filters and clears BOTH the URL and the persisted values', async () => {
    searchState.search = 'zzzzznomatch'
    searchState.status = 'active'
    searchState.project = 'rewind-dashboard'
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ status: 'active', project: 'rewind-dashboard', sort: 'latest' }),
    )
    paginatedResult = async () => result({ sessions: [], totalCount: 42 })

    render(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('No sessions match your filters')).toBeTruthy()
    })
    const hint = screen.getByText(/Active filters:/i).textContent ?? ''
    expect(hint).toContain('zzzzznomatch')
    expect(hint).toContain('status active')
    expect(hint).toContain('rewind-dashboard')

    navigateMock.mockClear()
    screen.getByRole('button', { name: /clear filters/i }).click()

    const call = navigateMock.mock.calls.at(-1)![0]
    expect(call.search({ ...searchState })).toMatchObject({
      search: '',
      status: 'all',
      project: '',
      page: 1,
    })
    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      expect(persisted.status).toBe('all')
      expect(persisted.project).toBe('')
    })
  })
})

describe('SessionList busy affordance', () => {
  it('KEEPS the previous rows on a placeholder refetch, dimmed, never a skeleton swap', async () => {
    const { rerender } = render(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('session-card')).toHaveLength(3)
    })
    expect(screen.queryByTestId('session-list-busy')).toBeNull()
    expect(screen.getByTestId('session-list-rows').className).not.toContain('opacity-50')

    // Simulate a search keystroke on the SAME mounted list: new query key,
    // response still in flight.
    let release: (r: PaginatedSessionsResult) => void = () => {}
    paginatedResult = () =>
      new Promise<PaginatedSessionsResult>((resolve) => {
        release = resolve
      })
    searchState.search = 'foo'
    rerender(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('session-list-busy')).toBeTruthy()
    })
    // The populated list is still on screen. keepPreviousData exists exactly to
    // prevent the grey-box flash a skeleton would reintroduce here.
    expect(screen.getAllByTestId('session-card')).toHaveLength(3)
    expect(screen.getByTestId('session-list-rows').className).toContain('opacity-50')
    expect(screen.queryByText('No sessions match your filters')).toBeNull()

    await act(async () => {
      release(result({ sessions: [session('s9')] }))
    })
  })

  it('never announces "No sessions found in ~/.claude" off a stale placeholder while clearing a filter', async () => {
    // Real sequence from the e2e run: a no-match search leaves totalCount 0 in
    // the cache, the user clicks Clear filters, and for one render the OLD
    // count is read against the NEW (empty) filter set.
    searchState.search = 'zzzzznomatch'
    paginatedResult = async () => result({ sessions: [], totalCount: 0 })

    const { rerender } = render(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('No sessions match your filters')).toBeTruthy()
    })

    let release: (r: PaginatedSessionsResult) => void = () => {}
    paginatedResult = () =>
      new Promise<PaginatedSessionsResult>((resolve) => {
        release = resolve
      })
    searchState.search = ''
    rerender(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('session-list-busy')).toBeTruthy()
    })
    expect(screen.queryByText('No sessions found in ~/.claude')).toBeNull()
    expect(screen.queryByTestId('empty-state')).toBeNull()

    await act(async () => {
      release(result())
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('session-card')).toHaveLength(3)
    })
  })

  it('renders the busy bar, NOT an empty state, while a stale project filter is being reconciled', async () => {
    // Persisted filter names a project dir that no longer exists (the reorg case).
    searchState.project = 'C--Users-dev-OneDrive-dead-project'
    paginatedResult = async () => result({ sessions: [], totalCount: 12 })

    render(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('session-list-busy')).toBeTruthy()
    })
    expect(screen.queryByText('No sessions match your filters')).toBeNull()
    expect(screen.queryByTestId('empty-state')).toBeNull()

    // ...and the reconcile navigate is what clears it.
    const call = navigateMock.mock.calls.at(-1)![0]
    expect(call.search({ ...searchState })).toMatchObject({ project: '', page: 1 })
  })

  it('hands the newest listed activity to the search results so index staleness can be surfaced', async () => {
    searchState.search = 'acme'
    const older = session('old')
    older.lastActiveAt = '2026-07-01T10:00:00.000Z'
    const newer = session('new')
    newer.lastActiveAt = '2026-08-01T10:00:00.000Z'
    paginatedResult = async () => result({ sessions: [older, newer] })
    ftsProps.length = 0

    render(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('fts')).toBeTruthy()
    })
    expect(ftsProps.at(-1)?.newestSessionAt).toBe('2026-08-01T10:00:00.000Z')
  })

  it('shows the empty state once the project filter is a real, still-present dir', async () => {
    searchState.project = 'C--Users-dev--work-rewind-dashboard'
    paginatedResult = async () => result({ sessions: [], totalCount: 12 })

    render(
      <Wrapper>
        <SessionList />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('No sessions match your filters')).toBeTruthy()
    })
    expect(screen.queryByTestId('session-list-busy')).toBeNull()
  })

  describe('matches revealed from behind the hidden flags', () => {
    it('passes hiddenReason through to the card and announces the count', async () => {
      searchState.search = 'orbit crm'
      const revealed: SessionListItem = { ...session('fee51982'), hiddenReason: 'project' }
      paginatedResult = async () =>
        result({ sessions: [revealed], totalCount: 1, hiddenMatchCount: 1 })

      render(
        <Wrapper>
          <SessionList />
        </Wrapper>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('hidden-match-notice')).toBeTruthy()
      })
      expect(screen.getByTestId('hidden-match-notice').textContent).toContain('1 of these matches')
      expect(screen.getByTestId('session-card').getAttribute('data-hidden-reason')).toBe('project')
    })

    it('stays silent when nothing was revealed', async () => {
      searchState.search = 'orbit crm'
      paginatedResult = async () => result({ hiddenMatchCount: 0 })

      render(
        <Wrapper>
          <SessionList />
        </Wrapper>,
      )

      await waitFor(() => {
        expect(screen.getAllByTestId('session-card')).toHaveLength(3)
      })
      expect(screen.queryByTestId('hidden-match-notice')).toBeNull()
    })
  })
})
