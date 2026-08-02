import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the title alone, with no hint, icon or action nodes', () => {
    render(<EmptyState title="No sessions found" />)

    expect(screen.getByText('No sessions found')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTestId('empty-state').textContent).toBe('No sessions found')
  })

  it('renders the optional hint and icon when supplied', () => {
    render(
      <EmptyState
        icon={<span>ICON</span>}
        title="No projects found"
        hint="Sessions will appear here once scanned."
      />,
    )

    expect(screen.getByText('ICON')).toBeTruthy()
    expect(screen.getByText('Sessions will appear here once scanned.')).toBeTruthy()
  })

  it('fires the action handler when the action is clicked', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="Every session is hidden"
        action={
          <button type="button" onClick={onClick}>
            Show hidden sessions
          </button>
        }
      />,
    )

    screen.getByRole('button', { name: /show hidden sessions/i }).click()

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('switches padding between py-14 (default) and py-8 (compact)', () => {
    const { unmount } = render(<EmptyState title="default" />)
    const full = screen.getByTestId('empty-state').className
    expect(full).toContain('py-14')
    expect(full).not.toContain('py-8')
    unmount()

    render(<EmptyState title="compact" compact />)
    const compact = screen.getByTestId('empty-state').className
    expect(compact).toContain('py-8')
    expect(compact).not.toContain('py-14')
  })

  it('uses only gray tokens so it survives the light-mode ramp inversion', () => {
    render(<EmptyState title="titled" hint="hinted" icon={<span>i</span>} />)

    const card = screen.getByTestId('empty-state')
    // text-gray-300 (#cdc8b8 dark / #3d3b36 light) clears 4.5:1 in both palettes;
    // the old text-gray-500 did not.
    expect(card.querySelector('.text-gray-300')).toBeTruthy()
    expect(card.className).toContain('border-gray-800')
    expect(card.className).toContain('bg-gray-900/40')
  })
})
