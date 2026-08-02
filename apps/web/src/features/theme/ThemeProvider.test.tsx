import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider, useTheme } from './ThemeProvider'
import { ThemeToggle } from './ThemeToggle'
import { themeInitScript } from '@/routes/__root'

// happy-dom does not implement matchMedia — provide a configurable mock
function mockMatchMedia(prefersDark: boolean) {
  const mediaQueryList = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mediaQueryList),
  })
  return mediaQueryList
}

function TestComponent() {
  const { theme, toggleTheme, setTheme } = useTheme()
  return (
    <div>
      <div data-testid="theme">{theme}</div>
      <button data-testid="toggle" onClick={toggleTheme}>
        Toggle
      </button>
      <button data-testid="set-light" onClick={() => setTheme('light')}>
        Light
      </button>
      <button data-testid="set-dark" onClick={() => setTheme('dark')}>
        Dark
      </button>
    </div>
  )
}

describe('ThemeProvider and useTheme', () => {
  beforeEach(() => {
    // Reset data-theme attribute before each test
    document.documentElement.removeAttribute('data-theme')
    // localStorage is cleared by setup.ts
  })

  describe('initial theme resolution', () => {
    it('reads "dark" from localStorage as initial theme', () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'dark')

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      expect(screen.getByTestId('theme').textContent).toBe('dark')
    })

    it('reads "light" from localStorage as initial theme', () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'light')

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      expect(screen.getByTestId('theme').textContent).toBe('light')
    })

    it('defaults to "dark" when localStorage is empty and the OS prefers dark', () => {
      mockMatchMedia(true)

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      expect(screen.getByTestId('theme').textContent).toBe('dark')
    })

    it('defaults to "dark" when localStorage is empty and the OS prefers LIGHT', () => {
      // The old behaviour handed a half-built light palette to every user whose
      // OS is light. An unset preference is now dark, full stop.
      mockMatchMedia(false)

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      expect(screen.getByTestId('theme').textContent).toBe('dark')
    })

    it('ignores an invalid localStorage value and defaults to dark', () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'invalid-value')

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      expect(screen.getByTestId('theme').textContent).toBe('dark')
    })
  })

  describe('dark default agrees across BOTH resolution sites', () => {
    /** Run the real pre-paint script from routes/__root.tsx against this DOM. */
    function runInitScript() {
      document.documentElement.removeAttribute('data-theme')
      new Function(themeInitScript)()
      return document.documentElement.getAttribute('data-theme')
    }

    it('pre-paint script resolves an unset preference to dark under prefers-color-scheme: light', () => {
      mockMatchMedia(false)

      expect(runInitScript()).toBe('dark')
    })

    it('getInitialTheme resolves the SAME unset preference to dark, so nothing flips on hydration', () => {
      mockMatchMedia(false)

      const fromScript = runInitScript()
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      expect(screen.getByTestId('theme').textContent).toBe(fromScript)
      expect(fromScript).toBe('dark')
    })

    it('pre-paint script still honours an explicit light preference', () => {
      mockMatchMedia(true)
      localStorage.setItem('csd-theme', 'light')

      expect(runInitScript()).toBe('light')
    })

    it('an explicit toggle persists and overrides the OS preference on the next load', async () => {
      mockMatchMedia(true)

      const { getByTestId, unmount } = render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )
      getByTestId('toggle').click()

      await waitFor(() => {
        expect(localStorage.getItem('csd-theme')).toBe('light')
      })
      unmount()

      // Next load: both sources read the stored choice, not the OS and not the
      // dark default.
      expect(runInitScript()).toBe('light')
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )
      expect(screen.getByTestId('theme').textContent).toBe('light')
    })
  })

  describe('toggleTheme', () => {
    it('toggles from dark to light', async () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'dark')

      const { getByTestId } = render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      expect(getByTestId('theme').textContent).toBe('dark')

      getByTestId('toggle').click()

      await waitFor(() => {
        expect(getByTestId('theme').textContent).toBe('light')
      })
    })

    it('toggles from light to dark', async () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'light')

      const { getByTestId } = render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      expect(getByTestId('theme').textContent).toBe('light')

      getByTestId('toggle').click()

      await waitFor(() => {
        expect(getByTestId('theme').textContent).toBe('dark')
      })
    })

    it('toggles multiple times correctly', async () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'dark')

      const { getByTestId } = render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      const sequence = ['light', 'dark', 'light', 'dark']
      for (const expected of sequence) {
        getByTestId('toggle').click()
        await waitFor(() => {
          expect(getByTestId('theme').textContent).toBe(expected)
        })
      }
    })
  })

  describe('setTheme', () => {
    it('sets theme to light directly', async () => {
      mockMatchMedia(true)

      const { getByTestId } = render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      getByTestId('set-light').click()

      await waitFor(() => {
        expect(getByTestId('theme').textContent).toBe('light')
      })
    })

    it('sets theme to dark directly', async () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'light')

      const { getByTestId } = render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      getByTestId('set-dark').click()

      await waitFor(() => {
        expect(getByTestId('theme').textContent).toBe('dark')
      })
    })
  })

  describe('side effects', () => {
    it('applies data-theme attribute to document.documentElement', async () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'dark')

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      await waitFor(() => {
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      })
    })

    it('updates data-theme attribute when theme changes', async () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'dark')

      const { getByTestId } = render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      await waitFor(() => {
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      })

      getByTestId('toggle').click()

      await waitFor(() => {
        expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      })
    })

    it('persists theme to localStorage after toggle', async () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'dark')

      const { getByTestId } = render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      getByTestId('toggle').click()

      await waitFor(() => {
        expect(localStorage.getItem('csd-theme')).toBe('light')
      })
    })

    it('persists the dark default to localStorage on initial render, even under an OS light preference', async () => {
      mockMatchMedia(false)

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      await waitFor(() => {
        expect(localStorage.getItem('csd-theme')).toBe('dark')
      })
    })

    it('registers a matchMedia change listener for system theme sync', () => {
      const mediaQueryList = mockMatchMedia(false)

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      expect(mediaQueryList.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      )
    })

    it('removes the matchMedia change listener on unmount', () => {
      const mediaQueryList = mockMatchMedia(false)

      const { unmount } = render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      unmount()

      expect(mediaQueryList.removeEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      )
    })
  })

  describe('ThemeProvider renders children', () => {
    it('renders its children', () => {
      mockMatchMedia(false)

      render(
        <ThemeProvider>
          <div data-testid="child">hello</div>
        </ThemeProvider>
      )

      expect(screen.getByTestId('child').textContent).toBe('hello')
    })
  })

  describe('useTheme error handling', () => {
    it('throws when used outside ThemeProvider', () => {
      const originalError = console.error
      console.error = () => {}

      expect(() => {
        render(<TestComponent />)
      }).toThrow('useTheme must be used within a ThemeProvider')

      console.error = originalError
    })
  })

  describe('ThemeToggle', () => {
    it('renders a toggle button', () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'dark')

      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      )

      const button = screen.getByRole('button', { name: /toggle color theme/i })
      expect(button).toBeTruthy()
    })

    it('has aria-pressed=true when theme is dark', () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'dark')

      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      )

      const button = screen.getByRole('button', { name: /toggle color theme/i })
      expect(button.getAttribute('aria-pressed')).toBe('true')
    })

    it('has aria-pressed=false when theme is light', () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'light')

      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      )

      const button = screen.getByRole('button', { name: /toggle color theme/i })
      expect(button.getAttribute('aria-pressed')).toBe('false')
    })

    it('toggles theme when clicked', async () => {
      mockMatchMedia(false)
      localStorage.setItem('csd-theme', 'dark')

      render(
        <ThemeProvider>
          <ThemeToggle />
          <TestComponent />
        </ThemeProvider>
      )

      const button = screen.getByRole('button', { name: /toggle color theme/i })
      expect(screen.getByTestId('theme').textContent).toBe('dark')

      button.click()

      await waitFor(() => {
        expect(screen.getByTestId('theme').textContent).toBe('light')
        expect(button.getAttribute('aria-pressed')).toBe('false')
      })
    })
  })
})
