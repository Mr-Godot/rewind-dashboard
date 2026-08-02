import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import * as ReactQuery from '@tanstack/react-query'
import { useIsSessionActive } from './useIsSessionActive'
import type { LiveSessionState } from '@/lib/parsers/types'

// Mock the entire module
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(),
  }
})

describe('useIsSessionActive', () => {
  const live = (sessionId: string, sessionState: 'working' | 'waiting' = 'working'): LiveSessionState => ({
    sessionId,
    sessionState,
  })

  function mockLiveSessions(data: LiveSessionState[] | undefined) {
    vi.mocked(ReactQuery.useQuery).mockReturnValue({ data } as ReturnType<typeof ReactQuery.useQuery>)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return true when the session is working', () => {
    mockLiveSessions([live('session-1'), live('session-2'), live('session-3')])

    const { result } = renderHook(() => useIsSessionActive('session-2'))

    expect(result.current).toBe(true)
  })

  it('should return FALSE for a live but waiting session', () => {
    // A waiting session is live, not active: it must not show the working
    // banner or start a running timer.
    mockLiveSessions([live('session-1', 'waiting')])

    const { result } = renderHook(() => useIsSessionActive('session-1'))

    expect(result.current).toBe(false)
  })

  it('should return false when session is not in the live list', () => {
    mockLiveSessions([live('session-1'), live('session-2')])

    const { result } = renderHook(() => useIsSessionActive('session-999'))

    expect(result.current).toBe(false)
  })

  it('should return false when data is undefined', () => {
    mockLiveSessions(undefined)

    const { result } = renderHook(() => useIsSessionActive('session-1'))

    expect(result.current).toBe(false)
  })

  it('should return false when the live list is empty', () => {
    mockLiveSessions([])

    const { result } = renderHook(() => useIsSessionActive('session-1'))

    expect(result.current).toBe(false)
  })

  it('should handle multiple calls with different session IDs', () => {
    mockLiveSessions([
      live('session-active-1'),
      live('session-active-2'),
      live('session-waiting', 'waiting'),
    ])

    const { result: result1 } = renderHook(() => useIsSessionActive('session-active-1'))
    const { result: result2 } = renderHook(() => useIsSessionActive('session-active-2'))
    const { result: result3 } = renderHook(() => useIsSessionActive('session-waiting'))
    const { result: result4 } = renderHook(() => useIsSessionActive('session-inactive'))

    expect(result1.current).toBe(true)
    expect(result2.current).toBe(true)
    expect(result3.current).toBe(false)
    expect(result4.current).toBe(false)
  })
})
