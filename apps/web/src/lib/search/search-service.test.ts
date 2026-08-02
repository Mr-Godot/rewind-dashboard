import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./index', () => ({ getSearchProvider: vi.fn() }))

import { runConversationSearch, rebuildSearchIndex, readSearchIndexStatus } from './search-service'
import { getSearchProvider } from './index'
import type { SearchProvider } from './provider'

const providerMock = vi.mocked(getSearchProvider)
let errorSpy: ReturnType<typeof vi.spyOn>

function fakeProvider(overrides: Partial<SearchProvider> = {}): SearchProvider {
  return {
    name: 'sqlite',
    isAvailable: () => true,
    refresh: vi.fn(async () => ({
      sessionsIndexed: 0,
      sessionsSkipped: 0,
      sessionsRemoved: 0,
      blocksIndexed: 0,
      durationMs: 0,
    })),
    search: vi.fn(async () => ({ hits: [], total: 0, tookMs: 1, provider: 'sqlite' })),
    ...overrides,
  }
}

beforeEach(() => {
  providerMock.mockReset()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('runConversationSearch', () => {
  it('reports degraded:true (never a bare []) when the provider factory throws', async () => {
    providerMock.mockImplementation(() => {
      throw new Error('driver exploded')
    })

    const res = await runConversationSearch({ query: 'acme' })

    expect(Array.isArray(res)).toBe(false)
    expect(res.hits).toEqual([])
    expect(res.degraded).toBe(true)
    expect(res.total).toBe(0)
    expect(errorSpy).toHaveBeenCalled()
    expect(String(errorSpy.mock.calls[0][0])).toContain('[search]')
  })

  it('reports degraded:true when search() rejects', async () => {
    providerMock.mockReturnValue(
      fakeProvider({
        search: vi.fn(async () => {
          throw new Error('SQLITE_CORRUPT')
        }),
      }),
    )

    const res = await runConversationSearch({ query: 'acme' })
    expect(res.degraded).toBe(true)
    expect(res.hits).toEqual([])
  })

  it('reports degraded:true when the index build (refresh) rejects', async () => {
    providerMock.mockReturnValue(
      fakeProvider({
        refresh: vi.fn(async () => {
          throw new Error('disk full')
        }),
      }),
    )

    const res = await runConversationSearch({ query: 'acme' })
    expect(res.degraded).toBe(true)
  })

  it('refreshes the index BEFORE searching so a cold index is not reported as empty', async () => {
    const order: string[] = []
    const provider = fakeProvider({
      refresh: vi.fn(async () => {
        order.push('refresh')
        return { sessionsIndexed: 1, sessionsSkipped: 0, sessionsRemoved: 0, blocksIndexed: 1, durationMs: 1 }
      }),
      search: vi.fn(async () => {
        order.push('search')
        return { hits: [], total: 0, tookMs: 1, provider: 'sqlite' }
      }),
    })
    providerMock.mockReturnValue(provider)

    await runConversationSearch({ query: 'acme' })
    expect(order).toEqual(['refresh', 'search'])
  })

  it('passes the full provider result through, including degraded and indexedThrough', async () => {
    providerMock.mockReturnValue(
      fakeProvider({
        search: vi.fn(async () => ({
          hits: [
            {
              sessionId: 's1',
              projectPath: '/p',
              projectName: 'p',
              snippet: 'x',
              timestamp: '2026-08-01T00:00:00.000Z',
            },
          ],
          total: 7,
          tookMs: 3,
          provider: 'sqlite',
          degraded: false,
          indexedThrough: '2026-07-25T15:47:10.106Z',
        })),
      }),
    )

    const res = await runConversationSearch({ query: 'acme' })
    expect(res.total).toBe(7)
    expect(res.hits).toHaveLength(1)
    expect(res.indexedThrough).toBe('2026-07-25T15:47:10.106Z')
  })

  it('short-circuits sub-2-char queries without touching the provider', async () => {
    const res = await runConversationSearch({ query: 'a' })
    expect(res.hits).toEqual([])
    expect(res.degraded).toBeUndefined()
    expect(providerMock).not.toHaveBeenCalled()
  })
})

describe('rebuildSearchIndex', () => {
  it('returns degraded stats and logs when the rebuild throws', async () => {
    providerMock.mockImplementation(() => {
      throw new Error('nope')
    })

    const stats = await rebuildSearchIndex()
    expect(stats.degraded).toBe(true)
    expect(stats.sessionsIndexed).toBe(0)
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('readSearchIndexStatus', () => {
  it('surfaces indexedThrough so the UI can tell a stale index from an empty one', async () => {
    providerMock.mockReturnValue(
      fakeProvider({ indexedThrough: () => '2026-07-25T15:47:10.106Z' }),
    )

    const status = await readSearchIndexStatus()
    expect(status).toEqual({
      provider: 'sqlite',
      available: true,
      indexedThrough: '2026-07-25T15:47:10.106Z',
    })
  })

  it('reports degraded rather than an innocuous-looking status when it throws', async () => {
    providerMock.mockImplementation(() => {
      throw new Error('nope')
    })

    const status = await readSearchIndexStatus()
    expect(status).toEqual({
      provider: 'none',
      available: false,
      indexedThrough: null,
      degraded: true,
    })
  })
})
