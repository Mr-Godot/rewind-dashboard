import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const searchState = {
  page: 1,
  pageSize: 25,
  search: '',
  status: 'all' as 'all' | 'active' | 'completed',
  project: '',
  sort: 'latest',
  starFirst: false,
  view: 'flat',
  showHidden: true,
}

const navigateMock = vi.fn()

vi.mock('@/routes/_dashboard/sessions/index', () => ({
  Route: { useSearch: () => ({ ...searchState }) },
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))
vi.mock('./rescan.queries', () => ({
  useRescan: () => ({ mutate: vi.fn(), isPending: false }),
}))

import { SessionFilters } from './SessionFilters'
import { PrivacyProvider } from '@/features/privacy/PrivacyContext'

function Wrapper({ children }: { children: ReactNode }) {
  return <PrivacyProvider>{children}</PrivacyProvider>
}

/** Resolve the navigate call's `search` updater against the current URL state. */
function nextSearch(callIndex = 0): Record<string, unknown> {
  const arg = navigateMock.mock.calls[callIndex][0] as {
    search: (prev: typeof searchState) => Record<string, unknown>
  }
  expect(typeof arg.search).toBe('function')
  return arg.search({ ...searchState })
}

beforeEach(() => {
  navigateMock.mockReset()
  vi.useRealTimers()
})

describe('SessionFilters', () => {
  it('preserves showHidden and starFirst while typing a query', async () => {
    render(
      <Wrapper>
        <SessionFilters projects={['a', 'b']} activeCount={0} />
      </Wrapper>,
    )

    fireEvent.change(screen.getByPlaceholderText(/Search sessions/i), {
      target: { value: 'orbit crm' },
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled()
    })

    const next = nextSearch()
    expect(next.search).toBe('orbit crm')
    expect(next.page).toBe(1)
    // Rebuilding the whole object here reset both of these on every keystroke.
    expect(next.showHidden).toBe(true)
    expect(next.starFirst).toBe(false)
  })

  it('preserves them through the sort, project, view and status controls', async () => {
    render(
      <Wrapper>
        <SessionFilters projects={['a', 'b']} activeCount={0} />
      </Wrapper>,
    )

    fireEvent.change(screen.getByDisplayValue('Sort: Latest'), { target: { value: 'largest' } })
    fireEvent.change(screen.getByDisplayValue('All projects'), { target: { value: 'a' } })
    fireEvent.click(screen.getByText('Projects'))
    fireEvent.click(screen.getByText('completed'))

    expect(navigateMock).toHaveBeenCalledTimes(4)
    for (let i = 0; i < 4; i++) {
      const next = nextSearch(i)
      expect(next.showHidden, `call ${i}`).toBe(true)
      expect(next.starFirst, `call ${i}`).toBe(false)
    }
  })

  it('still clears the project filter when status goes back to all', () => {
    render(
      <Wrapper>
        <SessionFilters projects={['a', 'b']} activeCount={0} />
      </Wrapper>,
    )

    fireEvent.click(screen.getByText('all'))
    expect(nextSearch().project).toBe('')
  })
})
