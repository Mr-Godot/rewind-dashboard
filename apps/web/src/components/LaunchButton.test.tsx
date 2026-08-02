import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { LaunchButton } from './LaunchButton'

const SESSION_ID = 'bb968dcf-5394-47a8-abc6-822ee9254871'
const DEAD_PATH = 'C:\\Users\\dev\\OneDrive\\_LIVE\\_CODE\\rewind-dashboard'
const WORK_PATH = 'C:\\Users\\dev\\_work'

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LaunchButton', () => {
  it('surfaces the 409 message when the recorded working directory is gone', async () => {
    const error = `Session working directory no longer exists: ${DEAD_PATH}`
    mockFetch(409, { error })

    render(<LaunchButton sessionId={SESSION_ID} cwd={DEAD_PATH} />)
    screen.getByRole('button').click()

    // Without this the user got a silent no-op: the server refused and nothing said so.
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(error)
    expect(alert.getAttribute('title')).toContain(DEAD_PATH)
    expect(screen.getByRole('button').textContent).toBe('Failed')
  })

  it('shows a generic failure when the error body is unreadable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json')
        },
      })),
    )

    render(<LaunchButton sessionId={SESSION_ID} />)
    screen.getByRole('button').click()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('500')
  })

  it('shows no error and reports success on a 200', async () => {
    mockFetch(200, { ok: true })

    render(<LaunchButton sessionId={SESSION_ID} cwd={WORK_PATH} />)
    screen.getByRole('button').click()

    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('Launched!'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('posts the sessionId and cwd', async () => {
    const fetchMock = mockFetch(200, { ok: true })

    render(<LaunchButton sessionId={SESSION_ID} cwd={WORK_PATH} />)
    screen.getByRole('button').click()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(JSON.parse(init.body)).toEqual({ sessionId: SESSION_ID, cwd: WORK_PATH })
  })

  it('renders a static badge (no launch affordance) for an active session', () => {
    render(<LaunchButton sessionId={SESSION_ID} isActive />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('active')).toBeTruthy()
  })
})
