import { describe, it, expect, vi, afterEach } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'

// Pure functions can be imported directly
import {
  decodeProjectDirName,
  extractProjectName,
  extractSessionId,
} from './claude-path'

describe('claude-path', () => {
  describe('getClaudeDir', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it('returns default path when CLAUDE_HOME is not set', async () => {
      vi.stubEnv('CLAUDE_HOME', '')
      vi.resetModules()
      const { getClaudeDir } = await import('./claude-path')
      expect(getClaudeDir()).toBe(path.join(os.homedir(), '.claude'))
    })

    it('returns resolved CLAUDE_HOME when set', async () => {
      vi.stubEnv('CLAUDE_HOME', '/custom/claude/dir')
      vi.resetModules()
      const { getClaudeDir } = await import('./claude-path')
      expect(getClaudeDir()).toBe(path.resolve('/custom/claude/dir'))
    })

    it('resolves relative CLAUDE_HOME to absolute path', async () => {
      vi.stubEnv('CLAUDE_HOME', 'relative/claude')
      vi.resetModules()
      const { getClaudeDir } = await import('./claude-path')
      const result = getClaudeDir()
      expect(path.isAbsolute(result)).toBe(true)
      expect(result).toContain(path.normalize('relative/claude'))
    })
  })

  describe('getProjectsDir', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it('returns projects subdirectory under claude dir', async () => {
      vi.stubEnv('CLAUDE_HOME', '/custom/claude')
      vi.resetModules()
      const { getProjectsDir } = await import('./claude-path')
      expect(getProjectsDir()).toBe(path.join(path.resolve('/custom/claude'), 'projects'))
    })

    it('returns default projects path when CLAUDE_HOME not set', async () => {
      vi.stubEnv('CLAUDE_HOME', '')
      vi.resetModules()
      const { getProjectsDir } = await import('./claude-path')
      expect(getProjectsDir()).toBe(path.join(os.homedir(), '.claude', 'projects'))
    })
  })

  describe('getStatsPath', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it('returns stats-cache.json path under claude dir', async () => {
      vi.stubEnv('CLAUDE_HOME', '/custom/claude')
      vi.resetModules()
      const { getStatsPath } = await import('./claude-path')
      expect(getStatsPath()).toBe(path.join(path.resolve('/custom/claude'), 'stats-cache.json'))
    })
  })

  describe('getHistoryPath', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it('returns history.jsonl path under claude dir', async () => {
      vi.stubEnv('CLAUDE_HOME', '/custom/claude')
      vi.resetModules()
      const { getHistoryPath } = await import('./claude-path')
      expect(getHistoryPath()).toBe(path.join(path.resolve('/custom/claude'), 'history.jsonl'))
    })
  })

  describe('decodeProjectDirName', () => {
    // --- Unix paths (no double-dash) ---
    // These require mocking os.homedir() since the decoder uses it for prefix matching.

    it('decodes macOS path with hyphenated project name', () => {
      expect(decodeProjectDirName('-Users-alice-my-project', '/Users/alice')).toBe('/Users/alice/my-project')
    })

    it('decodes macOS path through common dirs', () => {
      expect(decodeProjectDirName('-Users-alice-Documents-GitHub-my-app', '/Users/alice')).toBe(
        '/Users/alice/Documents/GitHub/my-app'
      )
    })

    it('decodes Linux path with known intermediate dir', () => {
      expect(decodeProjectDirName('-home-user-projects-project-x', '/home/user')).toBe(
        '/home/user/projects/project-x'
      )
    })

    it('decodes simple macOS path (no hyphens to preserve)', () => {
      expect(decodeProjectDirName('-Users-alice-project', '/Users/alice')).toBe('/Users/alice/project')
    })

    it('preserves hyphens in deep path with unknown intermediate dirs', () => {
      // "work" is known, but "clients" is not — so "clients-my-cool-project" stays joined
      expect(decodeProjectDirName('-Users-alice-work-clients-my-cool-project', '/Users/alice')).toBe(
        '/Users/alice/work/clients-my-cool-project'
      )
    })

    it('handles a single segment path (no intermediate dashes)', () => {
      expect(decodeProjectDirName('-project', '/Users/alice')).toBe('/project')
    })

    it('handles a path with no dashes (returns string unchanged)', () => {
      const result = decodeProjectDirName('nodash', '/Users/alice')
      expect(result).toBe('/nodash')
    })

    it('handles deep nested Linux paths with known dirs', () => {
      expect(decodeProjectDirName('-home-user-work-clients-acme-frontend', '/home/user')).toBe(
        '/home/user/work/clients-acme-frontend'
      )
    })

    it('handles path where homedir partially matches', () => {
      // "Users" matches homedir prefix but "alice" != "bob", so match stops.
      // Remaining segments "alice-my-project" are joined (none are known dirs).
      expect(decodeProjectDirName('-Users-alice-my-project', '/Users/bob')).toBe('/Users/alice-my-project')
    })

    it('splits on multiple known dirs after homedir', () => {
      expect(decodeProjectDirName('-Users-alice-Documents-GitHub-my-app', '/Users/alice')).toBe(
        '/Users/alice/Documents/GitHub/my-app'
      )
    })

    // --- Windows paths (double-dash present) ---

    it('decodes Windows drive letter with double-dash', () => {
      expect(decodeProjectDirName('C--Users-godot--work')).toBe('C:/Users-godot/work')
    })

    it('preserves literal hyphens in folder names on Windows', () => {
      expect(decodeProjectDirName('C--Users-godot--work-project-x')).toBe(
        'C:/Users-godot/work-project-x'
      )
    })

    it('preserves hyphens in nested Windows paths', () => {
      expect(decodeProjectDirName('C--Users-godot--work-project-x-forms')).toBe(
        'C:/Users-godot/work-project-x-forms'
      )
    })

    it('handles Windows OneDrive paths with underscore dirs', () => {
      expect(decodeProjectDirName('C--Users-godot-OneDrive--LIVE--CODE-webapp')).toBe(
        'C:/Users-godot-OneDrive/LIVE/CODE-webapp'
      )
    })

    it('handles Windows root path', () => {
      expect(decodeProjectDirName('C--')).toBe('C:/')
    })

    it('handles Unix path with double-dash (underscore dirs)', () => {
      expect(decodeProjectDirName('-home-user--work-my-project')).toBe(
        '/home-user/work-my-project'
      )
    })
  })

  describe('extractProjectName', () => {
    it('extracts last segment from a decoded path', () => {
      expect(extractProjectName('/Users/username/Documents/GitHub/myproject')).toBe('myproject')
    })

    it('handles a short decoded path', () => {
      expect(extractProjectName('/project')).toBe('project')
    })

    it('returns the raw last segment for short basenames', () => {
      expect(extractProjectName('/a/b/c/d/e')).toBe('e')
    })

    it('returns the name portion from a typical project path', () => {
      expect(extractProjectName('/Users/alice/work/repos/dashboard')).toBe('dashboard')
    })

    it('includes parent for numeric basenames', () => {
      expect(extractProjectName('/Users/alice/AGENTS/CRM/1')).toBe('CRM/1')
    })

    it('handles root path', () => {
      const result = extractProjectName('/')
      expect(typeof result).toBe('string')
    })

    // --- Lossy decode noise-prefix stripping ---

    it('strips noise-word prefix from lossy-decoded basename', () => {
      // "C:\Users\godot\_work\project-x" decodes to "C:/Users-godot/work-project-x"
      expect(extractProjectName('C:/Users-godot/work-project-x')).toBe('project-x')
    })

    it('strips CODE noise prefix from OneDrive paths', () => {
      // "C:\Users\godot\OneDrive\_LIVE\_CODE\rewind-dashboard" → "C:/Users-godot-OneDrive/LIVE/CODE-rewind-dashboard"
      expect(extractProjectName('C:/Users-godot-OneDrive/LIVE/CODE-rewind-dashboard')).toBe('rewind-dashboard')
    })

    it('strips CODE noise prefix for other projects', () => {
      expect(extractProjectName('C:/Users-godot-OneDrive/LIVE/CODE-webapp')).toBe('webapp')
    })

    it('preserves hyphenated names without noise prefix', () => {
      expect(extractProjectName('/Users/alice/my-cool-project')).toBe('my-cool-project')
    })

    it('handles purely numeric basename with parent context', () => {
      expect(extractProjectName('C:/Users-godot/reports/26')).toBe('reports/26')
    })

    it('strips work prefix from lossy decode with forms suffix', () => {
      // "C:\Users\godot\_work\project-x-forms" decodes to "C:/Users-godot/work-project-x-forms"
      expect(extractProjectName('C:/Users-godot/work-project-x-forms')).toBe('project-x-forms')
    })

    it('returns full basename when no noise prefix present', () => {
      expect(extractProjectName('C:/Users-godot-OneDrive/LIVE/AGENTS-toolkit')).toBe('AGENTS-toolkit')
    })
  })

  describe('extractSessionId', () => {
    it('strips .jsonl extension from filename', () => {
      expect(extractSessionId('abc-123.jsonl')).toBe('abc-123')
    })

    it('handles UUID-style session filenames', () => {
      expect(extractSessionId('550e8400-e29b-41d4-a716-446655440000.jsonl')).toBe(
        '550e8400-e29b-41d4-a716-446655440000'
      )
    })

    it('returns filename unchanged when no .jsonl extension', () => {
      expect(extractSessionId('no-extension')).toBe('no-extension')
    })

    it('returns filename unchanged for other extensions', () => {
      expect(extractSessionId('session.json')).toBe('session.json')
    })

    it('handles filenames with multiple dots', () => {
      expect(extractSessionId('session.backup.jsonl')).toBe('session.backup')
    })

    it('handles empty string', () => {
      expect(extractSessionId('')).toBe('')
    })
  })
})
