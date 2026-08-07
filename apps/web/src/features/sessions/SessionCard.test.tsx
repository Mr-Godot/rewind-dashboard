import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { SessionListItem } from './sessions.api'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
  useNavigate: () => vi.fn(),
}))
vi.mock('@/features/metadata/useMetadataMutations', () => ({
  usePinSession: () => ({ mutate: vi.fn() }),
  useRenameSession: () => ({ mutate: vi.fn() }),
  useHideProject: () => ({ mutate: vi.fn() }),
  useHideSession: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/components/LaunchButton', () => ({
  LaunchButton: () => <button type="button">launch</button>,
}))

import { SessionCard } from './SessionCard'
import { PrivacyProvider } from '@/features/privacy/PrivacyContext'

function item(over: Partial<SessionListItem> = {}): SessionListItem {
  return {
    sessionId: 'fee51982',
    projectDir: 'C--Users-dev-OneDrive--LIVE-AGENTS',
    projectPath: 'C:/Users/dev/OneDrive/_LIVE/AGENTS',
    projectName: 'AGENTS',
    realPath: null,
    pathExists: true,
    branch: 'main',
    cwd: null,
    startedAt: '2026-08-01T09:00:00.000Z',
    lastActiveAt: '2026-08-01T10:00:00.000Z',
    durationMs: 1000,
    messageCount: 1,
    userMessageCount: 1,
    assistantMessageCount: 0,
    isActive: false,
    sessionState: 'inactive',
    model: null,
    version: null,
    fileSizeBytes: 10,
    totalTokens: 0,
    firstUserMessage: null,
    claudeName: 'orbit-crm-v2',
    ...over,
  }
}

function renderCard(session: SessionListItem) {
  return render(
    <PrivacyProvider>
      <SessionCard session={session} />
    </PrivacyProvider>,
  )
}

describe('SessionCard hidden-match chip', () => {
  it('says so when a search revealed a row from a hidden project', () => {
    renderCard(item({ hiddenReason: 'project' }))
    expect(screen.getByText('hidden project')).toBeTruthy()
  })

  it('says so when a search revealed an individually hidden row', () => {
    renderCard(item({ hiddenReason: 'session' }))
    expect(screen.getByText('hidden session')).toBeTruthy()
  })

  it('renders no chip on an ordinary row', () => {
    renderCard(item())
    expect(screen.queryByText(/^hidden (project|session)$/)).toBeNull()
  })
})
