import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { LaunchButton } from './LaunchButton'
import { renderWithQueries, settingsWith, WIN_DETECTION } from '@/test/terminal-test-utils'
import type { Settings } from '@/features/settings/settings.types'

const SESSION_ID = 'bb968dcf-5394-47a8-abc6-822ee9254871'
const DEAD_PATH = 'C:\\Users\\dev\\OneDrive\\_LIVE\\_CODE\\rewind-dashboard'
const WORK_PATH = 'C:\\Users\\dev\\_work'

/** Ordered log of every side effect, so "saved then launched" is assertable. */
const calls: string[] = []
const saveSettingsMock = vi.fn(async ({ data }: { data: Settings }) => {
  calls.push('save')
  return data
})

vi.mock('@/features/settings/settings.api', () => ({
  getSettings: vi.fn(),
  saveSettings: (args: { data: Settings }) => saveSettingsMock(args),
}))

/** The terminalProfiles map sent on the nth save. */
function savedProfiles(n = 0) {
  return saveSettingsMock.mock.calls[n][0].data.terminalProfiles
}

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => {
    calls.push('launch')
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastBody(fetchMock: ReturnType<typeof mockFetch>) {
  const [, init] = fetchMock.mock.calls.at(-1) as unknown as [string, { body: string }]
  return JSON.parse(init.body)
}

beforeEach(() => {
  vi.useRealTimers()
  calls.length = 0
  saveSettingsMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LaunchButton', () => {
  it('surfaces the 409 message when the recorded working directory is gone', async () => {
    const error = `Session working directory no longer exists: ${DEAD_PATH}`
    mockFetch(409, { error })

    renderWithQueries(<LaunchButton sessionId={SESSION_ID} cwd={DEAD_PATH} />)
    screen.getByRole('button', { name: 'Launch' }).click()

    // Without this the user got a silent no-op: the server refused and nothing said so.
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(error)
    expect(alert.getAttribute('title')).toContain(DEAD_PATH)
    expect(screen.getByRole('button', { name: 'Failed' })).toBeTruthy()
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

    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />)
    screen.getByRole('button', { name: 'Launch' }).click()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('500')
  })

  it('shows no error and reports success on a 200', async () => {
    mockFetch(200, { ok: true })

    renderWithQueries(<LaunchButton sessionId={SESSION_ID} cwd={WORK_PATH} />)
    screen.getByRole('button', { name: 'Launch' }).click()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Launched!' })).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('posts the sessionId and cwd, with no terminalId when the default is used', async () => {
    const fetchMock = mockFetch(200, { ok: true })

    renderWithQueries(<LaunchButton sessionId={SESSION_ID} cwd={WORK_PATH} />)
    screen.getByRole('button', { name: 'Launch' }).click()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(lastBody(fetchMock)).toEqual({ sessionId: SESSION_ID, cwd: WORK_PATH })
  })

  it('renders a static badge (no launch affordance) for an active session', () => {
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} isActive />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('active')).toBeTruthy()
  })
})

describe('LaunchButton terminal gating', () => {
  it('renders the gear when two or more terminals are detected', () => {
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />)
    expect(screen.getByRole('button', { name: 'Choose terminal' })).toBeTruthy()
  })

  it('renders no gear when only one terminal is detected', () => {
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, {
      detection: {
        platform: 'win32',
        detected: [{ id: 'cmd', label: 'Command Prompt' }],
        autoResolvedId: 'cmd',
      },
    })
    expect(screen.queryByRole('button', { name: 'Choose terminal' })).toBeNull()
  })

  it('disables Launch with a tooltip and renders no gear when nothing is detected', () => {
    const fetchMock = mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, {
      detection: { platform: 'win32', detected: [], autoResolvedId: null },
    })

    const button = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('No supported terminal detected. See Settings.')
    expect(screen.queryByRole('button', { name: 'Choose terminal' })).toBeNull()
    button.click()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('LaunchButton first-run dialog', () => {
  const noChoice = { settings: settingsWith({}) }

  it('opens on the first Launch click and launches nothing yet', async () => {
    const fetchMock = mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, noChoice)

    screen.getByRole('button', { name: 'Launch' }).click()

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not open when the platform key is present', () => {
    mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />)
    screen.getByRole('button', { name: 'Launch' }).click()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not open when zero terminals are detected', () => {
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, {
      ...noChoice,
      detection: { platform: 'win32', detected: [], autoResolvedId: null },
    })
    screen.getByRole('button', { name: 'Launch' }).click()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('preselects the auto-resolved profile and tags it recommended', async () => {
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, noChoice)
    screen.getByRole('button', { name: 'Launch' }).click()
    await screen.findByRole('dialog')

    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    const checked = radios.filter((r) => r.checked)
    expect(checked).toHaveLength(1)
    expect(checked[0].value).toBe(WIN_DETECTION.autoResolvedId)
    expect(screen.getByText('recommended')).toBeTruthy()
  })

  it('saves the choice and then posts, in that order', async () => {
    const fetchMock = mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} cwd={WORK_PATH} />, noChoice)
    screen.getByRole('button', { name: 'Launch' }).click()
    await screen.findByRole('dialog')

    screen.getByRole('button', { name: 'Use this terminal' }).click()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(calls).toEqual(['save', 'launch'])
    expect(savedProfiles()).toEqual({ win32: 'wt-pwsh' })
  })

  it("stores the literal 'auto' when Automatic is selected", async () => {
    mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, noChoice)
    screen.getByRole('button', { name: 'Launch' }).click()
    await screen.findByRole('dialog')

    const auto = screen.getAllByRole('radio').find((r) => (r as HTMLInputElement).value === 'auto')!
    auto.click()
    screen.getByRole('button', { name: 'Use this terminal' }).click()

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalled())
    expect(savedProfiles()).toEqual({ win32: 'auto' })
  })

  it('saves nothing and posts nothing on Not now, and reopens on the next click', async () => {
    const fetchMock = mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, noChoice)
    screen.getByRole('button', { name: 'Launch' }).click()
    await screen.findByRole('dialog')

    screen.getByRole('button', { name: 'Not now' }).click()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(saveSettingsMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    screen.getByRole('button', { name: 'Launch' }).click()
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('saves nothing on a backdrop click', async () => {
    const fetchMock = mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, noChoice)
    screen.getByRole('button', { name: 'Launch' }).click()
    await screen.findByRole('dialog')

    screen.getByTestId('first-run-backdrop').click()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(saveSettingsMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('saves nothing on the close button', async () => {
    const fetchMock = mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, noChoice)
    screen.getByRole('button', { name: 'Launch' }).click()
    await screen.findByRole('dialog')

    screen.getByRole('button', { name: 'Close' }).click()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(saveSettingsMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('LaunchButton terminal menu', () => {
  it('launches once with the picked terminal and leaves an existing default alone', async () => {
    const fetchMock = mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} cwd={WORK_PATH} />, {
      settings: settingsWith({ win32: 'wt-pwsh' }),
    })

    screen.getByRole('button', { name: 'Choose terminal' }).click()
    ;(await screen.findByRole('menuitem', { name: /Command Prompt/ })).click()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(lastBody(fetchMock)).toEqual({
      sessionId: SESSION_ID,
      cwd: WORK_PATH,
      terminalId: 'cmd',
    })
    expect(saveSettingsMock).not.toHaveBeenCalled()
  })

  it('launches and stores the default when no default is set yet', async () => {
    const fetchMock = mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, { settings: settingsWith({}) })

    screen.getByRole('button', { name: 'Choose terminal' }).click()
    ;(await screen.findByRole('menuitem', { name: /PowerShell 7$/ })).click()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(calls).toEqual(['save', 'launch'])
    expect(savedProfiles()).toEqual({ win32: 'pwsh' })
  })

  it('pinning a row saves the default and launches nothing', async () => {
    const fetchMock = mockFetch(200, { ok: true })
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, {
      settings: settingsWith({ win32: 'wt-pwsh' }),
    })

    screen.getByRole('button', { name: 'Choose terminal' }).click()
    ;(await screen.findByRole('button', { name: 'Set Command Prompt as the default' })).click()

    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalled())
    expect(savedProfiles()).toEqual({ win32: 'cmd' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks the current default, and marks nothing when the default is stale', async () => {
    const { unmount } = renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, {
      settings: settingsWith({ win32: 'cmd' }),
    })
    screen.getByRole('button', { name: 'Choose terminal' }).click()
    expect(await screen.findByRole('menuitem', { name: /Command Prompt \(default\)/ })).toBeTruthy()
    unmount()

    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />, {
      settings: settingsWith({ win32: 'git-bash' }),
    })
    screen.getByRole('button', { name: 'Choose terminal' }).click()
    expect(await screen.findByText('Launch with (default Git Bash is not installed)')).toBeTruthy()
    expect(screen.queryByText(/\(default\)/)).toBeNull()
  })

  it('closes on Escape', async () => {
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />)
    screen.getByRole('button', { name: 'Choose terminal' }).click()
    expect(await screen.findByRole('menu')).toBeTruthy()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('closes on an outside click', async () => {
    renderWithQueries(<LaunchButton sessionId={SESSION_ID} />)
    screen.getByRole('button', { name: 'Choose terminal' }).click()
    expect(await screen.findByRole('menu')).toBeTruthy()

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})
