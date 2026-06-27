import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  useSessionFilterPreferences,
  shouldRehydrate,
  reconcileStoredProject,
  type StoredFilters,
  STORAGE_KEY,
} from './useSessionFilterPreferences'

function TestComponent({ persistArg }: { persistArg?: StoredFilters }) {
  const { storedFilters, persistFilters } = useSessionFilterPreferences()
  return (
    <div>
      <div data-testid="stored">{JSON.stringify(storedFilters)}</div>
      <button data-testid="persist" onClick={() => persistFilters(persistArg ?? {})}>
        persist
      </button>
    </div>
  )
}

function readStored(): string {
  return screen.getByTestId('stored').textContent ?? ''
}

describe('useSessionFilterPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('reading stored filters', () => {
    it('returns an empty object when localStorage is empty', () => {
      render(<TestComponent />)
      expect(JSON.parse(readStored())).toEqual({})
    })

    it('round-trips a full set of valid filters', async () => {
      const filters: StoredFilters = {
        status: 'active',
        sort: 'longest',
        starFirst: false,
        view: 'grouped',
        project: 'my-project',
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
      render(<TestComponent />)

      await waitFor(() => {
        expect(JSON.parse(readStored())).toEqual(filters)
      })
    })

    it('drops invalid enum values but keeps valid ones', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ status: 'bogus', sort: 'latest', view: 'weird', project: 'x', starFirst: true }),
      )
      render(<TestComponent />)

      expect(JSON.parse(readStored())).toEqual({ sort: 'latest', project: 'x', starFirst: true })
    })

    it('ignores non-boolean starFirst', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ starFirst: 'yes', sort: 'latest' }))
      render(<TestComponent />)
      expect(JSON.parse(readStored())).toEqual({ sort: 'latest' })
    })

    it('ignores malformed JSON', () => {
      localStorage.setItem(STORAGE_KEY, 'not-json{')
      render(<TestComponent />)
      expect(JSON.parse(readStored())).toEqual({})
    })

    it('handles localStorage read errors gracefully', () => {
      const getItemSpy = vi.spyOn(localStorage, 'getItem')
      getItemSpy.mockImplementation(() => {
        throw new Error('localStorage unavailable')
      })

      render(<TestComponent />)
      expect(JSON.parse(readStored())).toEqual({})

      getItemSpy.mockRestore()
    })
  })

  describe('persistFilters', () => {
    it('writes JSON to localStorage', async () => {
      const { getByTestId } = render(
        <TestComponent persistArg={{ status: 'active', sort: 'longest' }} />,
      )

      getByTestId('persist').click()

      await waitFor(() => {
        const raw = localStorage.getItem(STORAGE_KEY)
        expect(raw).not.toBeNull()
        expect(JSON.parse(raw as string)).toEqual({ status: 'active', sort: 'longest' })
      })
    })

    it('merges with previously stored filters', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ view: 'grouped' }))
      const { getByTestId } = render(<TestComponent persistArg={{ status: 'active' }} />)

      getByTestId('persist').click()

      await waitFor(() => {
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({
          view: 'grouped',
          status: 'active',
        })
      })
    })

    it('handles localStorage write errors gracefully', async () => {
      const setItemSpy = vi.spyOn(localStorage, 'setItem')
      setItemSpy.mockImplementation(() => {
        throw new Error('localStorage unavailable')
      })

      const { getByTestId } = render(<TestComponent persistArg={{ status: 'active' }} />)

      // Should not throw
      getByTestId('persist').click()
      await new Promise((resolve) => setTimeout(resolve, 50))

      setItemSpy.mockRestore()
    })
  })

  describe('SSR safety', () => {
    it('initializes with an empty object', () => {
      render(<TestComponent />)
      expect(JSON.parse(readStored())).toEqual({})
    })
  })
})

describe('shouldRehydrate', () => {
  it('returns false when there are no stored filters', () => {
    expect(shouldRehydrate('?page=2', {})).toBe(false)
  })

  it('returns true when the URL has no persisted keys and filters exist', () => {
    expect(shouldRehydrate('?page=2&pageSize=25', { status: 'active' })).toBe(true)
  })

  it('returns true for a bare URL with stored filters', () => {
    expect(shouldRehydrate('', { sort: 'longest' })).toBe(true)
  })

  it('returns false when any persisted key is present in the URL', () => {
    expect(shouldRehydrate('?status=active', { sort: 'latest' })).toBe(false)
    expect(shouldRehydrate('?sort=longest', { status: 'active' })).toBe(false)
    expect(shouldRehydrate('?starFirst=false', { status: 'active' })).toBe(false)
    expect(shouldRehydrate('?view=grouped', { status: 'active' })).toBe(false)
    expect(shouldRehydrate('?project=foo', { status: 'active' })).toBe(false)
  })

  it('returns false for a bare URL when there are no stored filters', () => {
    expect(shouldRehydrate('', {})).toBe(false)
  })
})

describe('reconcileStoredProject', () => {
  it('keeps a project that still exists in the list', () => {
    expect(reconcileStoredProject('foo', ['foo', 'bar'])).toBe('foo')
  })

  it('drops a project that no longer exists', () => {
    expect(reconcileStoredProject('baz', ['foo', 'bar'])).toBe('')
  })

  it('returns empty string for an empty project (all projects)', () => {
    expect(reconcileStoredProject('', ['foo', 'bar'])).toBe('')
  })

  it('drops any project when the list is empty', () => {
    expect(reconcileStoredProject('foo', [])).toBe('')
  })
})
