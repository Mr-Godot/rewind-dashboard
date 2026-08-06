import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { FirstRunTerminalDialog } from './FirstRunTerminalDialog'
import { WIN_DETECTION } from '@/test/terminal-test-utils'

function setup(overrides: Partial<Parameters<typeof FirstRunTerminalDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onDismiss = vi.fn()
  const view = render(
    <FirstRunTerminalDialog
      detected={WIN_DETECTION.detected}
      autoResolvedId={WIN_DETECTION.autoResolvedId}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
      {...overrides}
    />,
  )
  return { onConfirm, onDismiss, ...view }
}

describe('FirstRunTerminalDialog', () => {
  it('lists every detected terminal plus Automatic', () => {
    setup()
    const values = (screen.getAllByRole('radio') as HTMLInputElement[]).map((r) => r.value)
    expect(values).toEqual(['wt-pwsh', 'pwsh', 'cmd', 'auto'])
  })

  it('renders nothing when zero terminals are detected', () => {
    const { container } = setup({ detected: [] })
    expect(container.firstChild).toBeNull()
  })

  it('is shown even when only one terminal is detected', () => {
    setup({ detected: [{ id: 'cmd', label: 'Command Prompt' }], autoResolvedId: 'cmd' })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('confirms with the preselected profile', () => {
    const { onConfirm } = setup()
    screen.getByRole('button', { name: 'Use this terminal' }).click()
    expect(onConfirm).toHaveBeenCalledWith('wt-pwsh')
  })

  it("confirms with the literal 'auto', not undefined, when Automatic is picked", () => {
    const { onConfirm } = setup()
    const auto = screen.getAllByRole('radio').find((r) => (r as HTMLInputElement).value === 'auto')!
    auto.click()
    screen.getByRole('button', { name: 'Use this terminal' }).click()
    expect(onConfirm).toHaveBeenCalledWith('auto')
  })

  it('dismisses on Escape without confirming', async () => {
    const { onConfirm, onDismiss } = setup()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitFor(() => expect(onDismiss).toHaveBeenCalled())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('dismisses on a backdrop click but not on a click inside the panel', () => {
    const { onDismiss } = setup()
    screen.getByRole('dialog').click()
    expect(onDismiss).not.toHaveBeenCalled()
    screen.getByTestId('first-run-backdrop').click()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
