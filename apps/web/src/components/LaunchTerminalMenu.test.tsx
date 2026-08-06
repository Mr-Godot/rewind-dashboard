import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { LaunchTerminalMenu } from './LaunchTerminalMenu'
import { WIN_DETECTION } from '@/test/terminal-test-utils'

function setup(overrides: Partial<Parameters<typeof LaunchTerminalMenu>[0]> = {}) {
  const onLaunchWith = vi.fn()
  const onPin = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <LaunchTerminalMenu
      detected={WIN_DETECTION.detected}
      saved="wt-pwsh"
      autoResolvedId={WIN_DETECTION.autoResolvedId}
      onLaunchWith={onLaunchWith}
      onPin={onPin}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { onLaunchWith, onPin, onClose, ...view }
}

describe('LaunchTerminalMenu', () => {
  it('lists only detected terminals and marks the default', () => {
    setup()
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(screen.getByRole('menuitem', { name: /Windows Terminal \(PowerShell 7\) \(default\)/ })).toBeTruthy()
    expect(screen.getByText('Launch with')).toBeTruthy()
  })

  it("marks what 'auto' resolves to when the default is Automatic", () => {
    setup({ saved: 'auto' })
    expect(screen.getByRole('menuitem', { name: /Windows Terminal \(PowerShell 7\) \(default\)/ })).toBeTruthy()
  })

  it('says so when no default is set, and still lists every terminal', () => {
    setup({ saved: undefined })
    expect(screen.getByText('Launch with (no default set)')).toBeTruthy()
    expect(screen.queryByText(/\(default\)/)).toBeNull()
  })

  it('renders the stale header in amber and no default marker', () => {
    setup({ saved: 'git-bash' })
    const header = screen.getByText('Launch with (default Git Bash is not installed)')
    expect(header.className).toContain('text-amber-400')
    expect(screen.queryByText(/\(default\)/)).toBeNull()
  })

  it('launches with the clicked row and pins with the pin button', () => {
    const { onLaunchWith, onPin } = setup()
    screen.getByRole('menuitem', { name: /Command Prompt/ }).click()
    expect(onLaunchWith).toHaveBeenCalledWith('cmd')

    screen.getByRole('button', { name: 'Set PowerShell 7 as the default' }).click()
    expect(onPin).toHaveBeenCalledWith('pwsh')
  })

  it('closes on Escape and on an outside click', async () => {
    const { onClose } = setup()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2))
  })
})
