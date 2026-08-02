// @vitest-environment jsdom
// jsdom on purpose: this file must import cleanly in a browser-like environment
// with no node builtins available, which is what proves session-title.ts is
// client-safe (a node:fs import here would crash the SSR client bundle).
import { describe, it, expect } from 'vitest'
import { resolveSessionTitle } from './session-title'

describe('resolveSessionTitle', () => {
  const base = {
    customName: 'rewind rename',
    claudeName: 'kanban-board',
    firstUserMessage: 'why is the list empty?',
    fallback: 'my-project',
  }

  it('prefers the Rewind customName above everything', () => {
    expect(resolveSessionTitle(base)).toBe('rewind rename')
  })

  it('falls back to the JSONL custom-title when there is no customName', () => {
    expect(resolveSessionTitle({ ...base, customName: null })).toBe('kanban-board')
  })

  it('falls back to the first user message when there is no name at all', () => {
    expect(resolveSessionTitle({ ...base, customName: null, claudeName: null })).toBe(
      'why is the list empty?',
    )
  })

  it('falls back to the project name last', () => {
    expect(
      resolveSessionTitle({ ...base, customName: null, claudeName: null, firstUserMessage: null }),
    ).toBe('my-project')
  })

  it('treats blank/whitespace names as absent', () => {
    expect(resolveSessionTitle({ ...base, customName: '   ' })).toBe('kanban-board')
    expect(resolveSessionTitle({ ...base, customName: '', claudeName: '  ' })).toBe(
      'why is the list empty?',
    )
  })

  it('never uses a derived-looking fallback ahead of a real name', () => {
    expect(resolveSessionTitle({ customName: null, claudeName: 'F17', fallback: 'agents-0a' })).toBe('F17')
  })

  describe('privacy mode', () => {
    it('suppresses the verbatim first user message', () => {
      expect(
        resolveSessionTitle({ ...base, customName: null, claudeName: null, privacyMode: true }),
      ).toBe('my-project')
    })

    it('keeps claudeName — it is a user-authored label, not a prompt', () => {
      expect(resolveSessionTitle({ ...base, customName: null, privacyMode: true })).toBe('kanban-board')
    })

    it('keeps customName', () => {
      expect(resolveSessionTitle({ ...base, privacyMode: true })).toBe('rewind rename')
    })
  })

  it('imports no node builtins (client bundle safety)', async () => {
    const source = String((await import('./session-title?raw')).default)
    expect(source).toContain('export function resolveSessionTitle') // reading the real source
    expect(source).not.toMatch(/from ['"]node:/)
    expect(source).not.toMatch(/require\(['"]node:/)
    expect(typeof window).toBe('object')
  })
})
