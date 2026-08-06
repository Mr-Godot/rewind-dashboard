import { describe, it, expect } from 'vitest'
import {
  buildLaunchScript,
  buildPowerShellArgs,
  escapeSingleQuoted,
  resolvePowerShellExe,
} from './powershell-launch'

const SESSION_ID = 'bb968dcf-5394-47a8-abc6-822ee9254871'

describe('resolvePowerShellExe', () => {
  it('prefers pwsh.exe when PowerShell 7 is on PATH', () => {
    expect(resolvePowerShellExe(() => true)).toBe('pwsh.exe')
  })

  it('falls back to powershell.exe when pwsh is absent', () => {
    expect(resolvePowerShellExe(() => false)).toBe('powershell.exe')
  })

  it('only probes for pwsh.exe', () => {
    const probed: string[] = []
    resolvePowerShellExe((exe) => {
      probed.push(exe)
      return false
    })

    expect(probed).toEqual(['pwsh.exe'])
  })
})

describe('buildPowerShellArgs', () => {
  it('keeps the window open, bypasses execution policy and runs the script file', () => {
    expect(buildPowerShellArgs('C:\\Temp\\launch-session-bb968dcf.ps1')).toEqual([
      '-NoExit',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\Temp\\launch-session-bb968dcf.ps1',
    ])
  })
})

describe('escapeSingleQuoted', () => {
  it("doubles literal single quotes", () => {
    expect(escapeSingleQuoted("C:\\Users\\o'brien\\proj")).toBe("C:\\Users\\o''brien\\proj")
  })

  it('leaves quote-free values untouched', () => {
    expect(escapeSingleQuoted('C:\\Users\\dev')).toBe('C:\\Users\\dev')
  })
})

describe('buildLaunchScript', () => {
  const script = buildLaunchScript({
    sessionId: SESSION_ID,
    sessionCwd: 'C:\\Users\\dev\\_work\\rewind-dashboard',
    windowTitle: 'Rewind Session bb968dcf',
  })

  it('sets the window title', () => {
    expect(script).toContain("$Host.UI.RawUI.WindowTitle = 'Rewind Session bb968dcf'")
  })

  it('changes to the session directory with -LiteralPath', () => {
    expect(script).toContain("Set-Location -LiteralPath 'C:\\Users\\dev\\_work\\rewind-dashboard'")
  })

  it('runs the resume command', () => {
    expect(script).toContain(`claude --resume ${SESSION_ID} --dangerously-skip-permissions`)
  })

  it('self-deletes so no temp file leaks', () => {
    expect(script).toContain('Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue')
  })

  it('runs the resume command before deleting itself', () => {
    const lines = script.split('\r\n')

    expect(lines.findIndex((l) => l.startsWith('claude --resume'))).toBeLessThan(
      lines.findIndex((l) => l.startsWith('Remove-Item')),
    )
  })

  it('escapes single quotes in the cwd and the title', () => {
    const escaped = buildLaunchScript({
      sessionId: SESSION_ID,
      sessionCwd: "C:\\Users\\o'brien\\it's here",
      windowTitle: "Rewind's Session",
    })

    expect(escaped).toContain("Set-Location -LiteralPath 'C:\\Users\\o''brien\\it''s here'")
    expect(escaped).toContain("$Host.UI.RawUI.WindowTitle = 'Rewind''s Session'")
  })

  it('normalizes forward slashes to backslashes in the cwd', () => {
    const normalized = buildLaunchScript({
      sessionId: SESSION_ID,
      sessionCwd: 'C:/Users/dev/_work',
      windowTitle: 'Rewind Session bb968dcf',
    })

    expect(normalized).toContain("Set-Location -LiteralPath 'C:\\Users\\dev\\_work'")
  })

  it('never hides the window', () => {
    expect(script).not.toContain('WindowStyle')
  })
})
