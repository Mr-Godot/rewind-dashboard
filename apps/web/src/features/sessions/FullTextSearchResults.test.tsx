import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('./search.api', () => ({ searchConversations: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}))

import { FullTextSearchResults } from './FullTextSearchResults'
import { searchConversations } from './search.api'
import type { SearchHit, SearchResult } from './search.api'

const searchMock = vi.mocked(searchConversations)

function hit(sessionId: string, extra: Partial<SearchHit> = {}): SearchHit {
  return {
    sessionId,
    projectPath: 'C:\\Users\\dev\\_work\\rewind-dashboard',
    projectName: 'rewind-dashboard',
    snippet: 'some matching text',
    timestamp: '2026-08-01T10:00:00.000Z',
    ...extra,
  }
}

function result(hits: SearchHit[], extra: Partial<SearchResult> = {}): SearchResult {
  return { hits, total: hits.length, tookMs: 1, provider: 'sqlite', ...extra }
}

let client: QueryClient
let errorSpy: ReturnType<typeof vi.spyOn>

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  searchMock.mockReset()
  // Deliberately NO `retry` default here. The real app client
  // (src/routes/__root.tsx) sets only staleTime and refetchOnWindowFocus, so
  // react-query's default retry:3 applies in production and the component's own
  // `retry: false` is the only thing preventing a request storm. Setting it here
  // would mask that and let a future edit drop it with no test signal.
  client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  client.clear()
  errorSpy.mockRestore()
})

describe('FullTextSearchResults', () => {
  it('issues EXACTLY ONE request for a rejected search and shows a visible error', async () => {
    searchMock.mockRejectedValue(new Error('provider exploded'))

    const { rerender } = render(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={new Set(['a'])} />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Conversation search unavailable/i)).toBeTruthy()
    })

    // A fresh Set identity on every render is exactly what the parent produces.
    // The old effect re-fired the request on each one because it only recorded
    // the query on the success path.
    rerender(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={new Set(['a'])} />
      </Wrapper>,
    )
    rerender(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={new Set(['b'])} />
      </Wrapper>,
    )
    await sleep(60)

    expect(searchMock).toHaveBeenCalledTimes(1)
  })

  it('renders the degraded state when the server reports degraded:true', async () => {
    searchMock.mockResolvedValue(
      result([], { provider: 'none', degraded: true, indexedThrough: null }),
    )

    render(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={new Set()} />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Conversation search unavailable/i)).toBeTruthy()
    })
    expect(screen.queryByText(/No conversation text matched/i)).toBeNull()
  })

  it('shows a loading affordance instead of null while the search is in flight', async () => {
    let release: (r: SearchResult) => void = () => {}
    searchMock.mockReturnValue(
      new Promise<SearchResult>((resolve) => {
        release = resolve
      }) as ReturnType<typeof searchConversations>,
    )

    render(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={new Set()} />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Searching conversations/i)).toBeTruthy()
    })
    // The no-match copy must NOT appear on the pre-search render.
    expect(screen.queryByText(/No conversation text matched/i)).toBeNull()

    release(result([hit('s1')]))
    await waitFor(() => {
      expect(screen.queryByText(/Searching conversations/i)).toBeNull()
    })
  })

  it('renders an explicit no-match row (never null) when there are zero raw hits', async () => {
    searchMock.mockResolvedValue(result([]))

    const { container } = render(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={new Set()} />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText(/No conversation text matched/i)).toBeTruthy()
    })
    expect(screen.getByText(/acme/)).toBeTruthy()
    expect(container.innerHTML).not.toBe('')
  })

  it('does NOT claim "no match" when every hit was already listed above', async () => {
    searchMock.mockResolvedValue(result([hit('s1'), hit('s2'), hit('s3')]))

    render(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={new Set(['s1', 's2', 's3'])} />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getAllByText(/already listed above/i)).toHaveLength(3)
    })
    expect(screen.queryByText(/No conversation text matched/i)).toBeNull()
    // Every hit is still a rendered, clickable row.
    expect(screen.getAllByText(/some matching text/)).toHaveLength(3)
  })

  it('renders hits that are already listed too, chipped rather than dropped', async () => {
    searchMock.mockResolvedValue(result([hit('s1'), hit('s2')]))

    render(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={new Set(['s1'])} />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getAllByText(/some matching text/)).toHaveLength(2)
    })
    expect(screen.getAllByText(/already listed above/i)).toHaveLength(1)
  })

  it('keeps server order for 50 hits and chips the 35 already on the page', async () => {
    // Timestamps are deliberately shuffled relative to the server order: a
    // client-side re-sort would reorder these rows and fail the assertion.
    const hits = Array.from({ length: 50 }, (_, i) =>
      hit(`s${String(i).padStart(2, '0')}`, {
        snippet: `snippet-${String(i).padStart(2, '0')}`,
        timestamp: `2026-08-${String(((i * 7) % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
      }),
    )
    const alreadyListed = new Set(hits.slice(0, 35).map((h) => h.sessionId))
    searchMock.mockResolvedValue(result(hits, { total: 137 }))

    render(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={alreadyListed} />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getAllByText(/snippet-\d\d/)).toHaveLength(50)
    })
    const rendered = screen
      .getAllByText(/snippet-\d\d/)
      .map((el) => el.textContent?.match(/snippet-\d\d/)?.[0])
    expect(rendered).toEqual(hits.map((h) => h.snippet))
    expect(screen.getAllByText(/already listed above/i)).toHaveLength(35)
    expect(screen.getByText(/Showing 50 of 137/i)).toBeTruthy()
  })

  it('shows the match count when a session has more than one matching block', async () => {
    searchMock.mockResolvedValue(
      result([hit('s1', { matchCount: 412 }), hit('s2', { matchCount: 1 })]),
    )

    render(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={new Set()} />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText(/412 matches/i)).toBeTruthy()
    })
    expect(screen.queryByText(/1 matches/i)).toBeNull()
  })

  it('asks the server for 50 sessions, not 10', async () => {
    searchMock.mockResolvedValue(result([]))

    render(
      <Wrapper>
        <FullTextSearchResults query="acme" existingIds={new Set()} />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledTimes(1)
    })
    expect(searchMock).toHaveBeenCalledWith({ data: { query: 'acme', limit: 50 } })
  })

  describe('index staleness', () => {
    it('warns when a listed session is NEWER than the index high-water mark', async () => {
      searchMock.mockResolvedValue(
        result([hit('s1')], { indexedThrough: '2026-07-25T15:47:10.106Z' }),
      )

      render(
        <Wrapper>
          <FullTextSearchResults
            query="acme"
            existingIds={new Set()}
            newestSessionAt="2026-08-01T10:00:00.000Z"
          />
        </Wrapper>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('fts-stale-notice')).toBeTruthy()
      })
      expect(screen.getByText(/newer sessions are not\s+searchable yet/i)).toBeTruthy()
      // The results are still rendered: this is additive, not a replacement.
      expect(screen.getByText(/some matching text/)).toBeTruthy()
    })

    it('warns on the ZERO-hit branch too, so a stale index never reads as a definitive no-match', async () => {
      searchMock.mockResolvedValue(result([], { indexedThrough: '2026-07-25T15:47:10.106Z' }))

      render(
        <Wrapper>
          <FullTextSearchResults
            query="acme"
            existingIds={new Set()}
            newestSessionAt="2026-08-01T10:00:00.000Z"
          />
        </Wrapper>,
      )

      await waitFor(() => {
        expect(screen.getByText(/No conversation text matched/i)).toBeTruthy()
      })
      expect(screen.getByTestId('fts-stale-notice')).toBeTruthy()
    })

    it('stays silent when the index already covers the newest listed session', async () => {
      searchMock.mockResolvedValue(
        result([hit('s1')], { indexedThrough: '2026-08-02T00:00:00.000Z' }),
      )

      render(
        <Wrapper>
          <FullTextSearchResults
            query="acme"
            existingIds={new Set()}
            newestSessionAt="2026-08-01T10:00:00.000Z"
          />
        </Wrapper>,
      )

      await waitFor(() => {
        expect(screen.getByText(/some matching text/)).toBeTruthy()
      })
      expect(screen.queryByTestId('fts-stale-notice')).toBeNull()
    })

    it('stays silent when the provider reports no high-water mark at all', async () => {
      searchMock.mockResolvedValue(result([hit('s1')], { indexedThrough: null }))

      render(
        <Wrapper>
          <FullTextSearchResults
            query="acme"
            existingIds={new Set()}
            newestSessionAt="2026-08-01T10:00:00.000Z"
          />
        </Wrapper>,
      )

      await waitFor(() => {
        expect(screen.getByText(/some matching text/)).toBeTruthy()
      })
      expect(screen.queryByTestId('fts-stale-notice')).toBeNull()
    })

    it('stays silent when the caller supplies no newest-session reference', async () => {
      searchMock.mockResolvedValue(
        result([hit('s1')], { indexedThrough: '2026-07-25T15:47:10.106Z' }),
      )

      render(
        <Wrapper>
          <FullTextSearchResults query="acme" existingIds={new Set()} />
        </Wrapper>,
      )

      await waitFor(() => {
        expect(screen.getByText(/some matching text/)).toBeTruthy()
      })
      expect(screen.queryByTestId('fts-stale-notice')).toBeNull()
    })
  })

  it('stays idle (and issues no request) below the minimum query length', async () => {
    searchMock.mockResolvedValue(result([]))

    const { container } = render(
      <Wrapper>
        <FullTextSearchResults query="ab" existingIds={new Set()} />
      </Wrapper>,
    )

    await sleep(30)
    expect(container.innerHTML).toBe('')
    expect(searchMock).not.toHaveBeenCalled()
  })
})
