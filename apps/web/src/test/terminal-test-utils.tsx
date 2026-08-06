import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { Settings } from '@/features/settings/settings.types'
import type { DetectionResult } from '@/lib/launch/terminal-detect'
import type { TerminalProfiles } from '@/features/settings/settings.types'

export const WIN_DETECTION: DetectionResult = {
  platform: 'win32',
  detected: [
    { id: 'wt-pwsh', label: 'Windows Terminal (PowerShell 7)' },
    { id: 'pwsh', label: 'PowerShell 7' },
    { id: 'cmd', label: 'Command Prompt' },
  ],
  autoResolvedId: 'wt-pwsh',
}

export function settingsWith(terminalProfiles: TerminalProfiles): Settings {
  return {
    version: 1,
    subscriptionTier: 'pro',
    pricingOverrides: {},
    terminalProfiles,
  }
}

/**
 * Renders with both queries pre-seeded so nothing hits a server function. Both
 * queries are configured with a long staleTime, so seeded data is used as-is.
 */
export function renderWithQueries(
  ui: ReactNode,
  options: { detection?: DetectionResult | null; settings?: Settings } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (options.detection !== null) {
    queryClient.setQueryData(['terminals'], options.detection ?? WIN_DETECTION)
  }
  queryClient.setQueryData(['settings'], options.settings ?? settingsWith({ win32: 'auto' }))
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  }
}
