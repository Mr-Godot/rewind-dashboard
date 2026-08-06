import { buildLaunchScript, buildPowerShellArgs, escapeSingleQuoted } from './powershell-launch'
import {
  TERMINAL_LABELS,
  TERMINAL_PROFILE_IDS,
  type TerminalPlatform,
  type TerminalProfileId,
} from './terminal-ids'

/**
 * The allowlist. A terminal preference is an ID and nothing else: never a path,
 * never a flag. Every launcher binary and every argument below is a literal in
 * this file, so a hostile settings.json can at worst make Launch open a
 * different terminal that is already installed on the machine.
 *
 * Server-only: imported by the Vite launch middleware and by the detection
 * server function, never by client code.
 */

export type ScriptFlavor = 'ps1' | 'bat' | 'command' | 'sh'

export type TerminalProbe =
  /** Executables that must all resolve on PATH. */
  | { kind: 'path'; exes: string[] }
  /** First existing file wins, and becomes the launcher path. */
  | { kind: 'file'; candidates: () => string[] }
  /** No probe: the profile is always available on its platform. */
  | { kind: 'always' }

export interface RecipeContext {
  /** Absolute path of the generated temp script. */
  scriptPath: string
  /** Validated session working directory. */
  sessionCwd: string
  windowTitle: string
  /** The launcher resolved by detection, for `file` probes. */
  launcherPath: string
}

export interface LaunchRecipe {
  id: TerminalProfileId
  platform: TerminalPlatform
  scriptFlavor: ScriptFlavor
  probe: TerminalProbe
  /** Executable spawned on PATH, or null when the probe resolves the path. */
  launcher: string | null
  argv: (ctx: RecipeContext) => string[]
}

// --- Script builders, one per flavor ---

/** Escape a value for embedding in a POSIX shell single-quoted string. */
export function escapeShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "'\\''")
}

export interface ScriptContext {
  sessionId: string
  sessionCwd: string
  windowTitle: string
}

/**
 * `%` is not escapable inside a .bat in any way that survives every Windows
 * shell setting, so a percent sign in the working directory is refused rather
 * than mangled. Every other flavor accepts it.
 */
export class UnsupportedCwdError extends Error {}

function buildBatScript(ctx: ScriptContext): string {
  if (ctx.sessionCwd.includes('%')) {
    throw new UnsupportedCwdError(
      'Command Prompt cannot open a directory containing a percent sign. Choose another terminal in Settings.',
    )
  }
  const lines = [
    '@echo off',
    `title ${ctx.windowTitle}`,
    `cd /d "${ctx.sessionCwd.replace(/\//g, '\\')}"`,
    `claude --resume ${ctx.sessionId} --dangerously-skip-permissions`,
    'pause',
    '(goto) 2>nul & del "%~f0"',
    '',
  ]
  return lines.join('\r\n')
}

/** macOS: `-l` loads the login PATH so `claude` resolves; `exec` keeps it open. */
function buildCommandScript(ctx: ScriptContext): string {
  const lines = [
    '#!/bin/bash -l',
    `cd '${escapeShellSingleQuoted(ctx.sessionCwd)}'`,
    `claude --resume ${ctx.sessionId} --dangerously-skip-permissions`,
    'exec "$SHELL"',
    '',
  ]
  return lines.join('\n')
}

/** Linux emulators and Git Bash: source the profile for PATH, stay open. */
function buildShScript(ctx: ScriptContext): string {
  const lines = [
    '#!/usr/bin/env bash',
    '[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"',
    '[ -f "$HOME/.profile" ] && source "$HOME/.profile"',
    `cd '${escapeShellSingleQuoted(ctx.sessionCwd)}'`,
    `claude --resume ${ctx.sessionId} --dangerously-skip-permissions`,
    'exec bash',
    '',
  ]
  return lines.join('\n')
}

export function buildScript(flavor: ScriptFlavor, ctx: ScriptContext): string {
  switch (flavor) {
    case 'ps1':
      return buildLaunchScript(ctx)
    case 'bat':
      return buildBatScript(ctx)
    case 'command':
      return buildCommandScript(ctx)
    case 'sh':
      return buildShScript(ctx)
  }
}

export const SCRIPT_EXTENSIONS: Record<ScriptFlavor, string> = {
  ps1: '.ps1',
  bat: '.bat',
  command: '.command',
  sh: '.sh',
}

// --- Probe candidate lists (hardcoded, never user input) ---

function mintty64(): string {
  return 'C:\\Program Files\\Git\\usr\\bin\\mintty.exe'
}

function minttyCandidates(): string[] {
  const local = process.env.LOCALAPPDATA
  const candidates = [mintty64(), 'C:\\Program Files (x86)\\Git\\usr\\bin\\mintty.exe']
  if (local) candidates.push(`${local}\\Programs\\Git\\usr\\bin\\mintty.exe`)
  return candidates
}

function appCandidates(bundle: string): string[] {
  const home = process.env.HOME
  const list = [`/Applications/${bundle}`]
  if (home) list.push(`${home}/Applications/${bundle}`)
  return list
}

// --- The registry ---

const RECIPES: LaunchRecipe[] = [
  {
    id: 'wt-pwsh',
    platform: 'win32',
    scriptFlavor: 'ps1',
    probe: { kind: 'path', exes: ['wt.exe', 'pwsh.exe'] },
    launcher: 'wt.exe',
    argv: ({ scriptPath, sessionCwd }) => [
      '-d',
      sessionCwd,
      'pwsh.exe',
      ...buildPowerShellArgs(scriptPath),
    ],
  },
  {
    id: 'wt-powershell',
    platform: 'win32',
    scriptFlavor: 'ps1',
    probe: { kind: 'path', exes: ['wt.exe', 'powershell.exe'] },
    launcher: 'wt.exe',
    argv: ({ scriptPath, sessionCwd }) => [
      '-d',
      sessionCwd,
      'powershell.exe',
      ...buildPowerShellArgs(scriptPath),
    ],
  },
  {
    id: 'pwsh',
    platform: 'win32',
    scriptFlavor: 'ps1',
    probe: { kind: 'path', exes: ['pwsh.exe'] },
    launcher: 'cmd.exe',
    // `start` is only a launcher: it opens a NEW VISIBLE console hosting
    // PowerShell and exits, so claude itself runs under PowerShell.
    argv: ({ scriptPath, windowTitle }) => [
      '/c',
      'start',
      windowTitle,
      'pwsh.exe',
      ...buildPowerShellArgs(scriptPath),
    ],
  },
  {
    id: 'powershell',
    platform: 'win32',
    scriptFlavor: 'ps1',
    probe: { kind: 'path', exes: ['powershell.exe'] },
    launcher: 'cmd.exe',
    argv: ({ scriptPath, windowTitle }) => [
      '/c',
      'start',
      windowTitle,
      'powershell.exe',
      ...buildPowerShellArgs(scriptPath),
    ],
  },
  {
    id: 'cmd',
    platform: 'win32',
    scriptFlavor: 'bat',
    probe: { kind: 'path', exes: ['cmd.exe'] },
    launcher: 'cmd.exe',
    argv: ({ scriptPath, windowTitle }) => ['/c', 'start', windowTitle, scriptPath],
  },
  {
    id: 'git-bash',
    platform: 'win32',
    scriptFlavor: 'sh',
    probe: { kind: 'file', candidates: minttyCandidates },
    launcher: null,
    // `-h always` is mintty's `-NoExit`. bash accepts the Windows script path
    // directly, so no cygpath round-trip is needed.
    argv: ({ scriptPath, windowTitle }) => [
      '-h',
      'always',
      '-t',
      windowTitle,
      '--',
      '/usr/bin/bash',
      '--login',
      '-i',
      scriptPath,
    ],
  },

  {
    id: 'macos-default',
    platform: 'darwin',
    scriptFlavor: 'command',
    probe: { kind: 'always' },
    launcher: 'open',
    argv: ({ scriptPath }) => [scriptPath],
  },
  {
    id: 'terminal-app',
    platform: 'darwin',
    scriptFlavor: 'command',
    probe: {
      kind: 'file',
      candidates: () => [
        '/System/Applications/Utilities/Terminal.app',
        '/Applications/Utilities/Terminal.app',
      ],
    },
    launcher: 'open',
    argv: ({ scriptPath }) => ['-a', 'Terminal', scriptPath],
  },
  {
    id: 'iterm2',
    platform: 'darwin',
    scriptFlavor: 'command',
    probe: { kind: 'file', candidates: () => appCandidates('iTerm.app') },
    launcher: 'open',
    argv: ({ scriptPath }) => ['-a', 'iTerm', scriptPath],
  },
  {
    id: 'ghostty',
    platform: 'darwin',
    scriptFlavor: 'sh',
    probe: { kind: 'file', candidates: () => appCandidates('Ghostty.app') },
    launcher: 'open',
    argv: ({ scriptPath, sessionCwd }) => [
      '-na',
      'Ghostty',
      '--args',
      `--working-directory=${sessionCwd}`,
      '-e',
      scriptPath,
    ],
  },
  {
    id: 'alacritty',
    platform: 'darwin',
    scriptFlavor: 'sh',
    probe: { kind: 'file', candidates: () => appCandidates('Alacritty.app') },
    launcher: 'open',
    argv: ({ scriptPath, sessionCwd }) => [
      '-na',
      'Alacritty',
      '--args',
      '--working-directory',
      sessionCwd,
      '-e',
      '/bin/bash',
      '-l',
      scriptPath,
    ],
  },

  {
    id: 'x-terminal-emulator',
    platform: 'linux',
    scriptFlavor: 'sh',
    probe: { kind: 'path', exes: ['x-terminal-emulator'] },
    launcher: 'x-terminal-emulator',
    argv: ({ scriptPath }) => ['-e', scriptPath],
  },
  {
    id: 'gnome-terminal',
    platform: 'linux',
    scriptFlavor: 'sh',
    probe: { kind: 'path', exes: ['gnome-terminal'] },
    launcher: 'gnome-terminal',
    argv: ({ scriptPath }) => ['--', scriptPath],
  },
  {
    id: 'konsole',
    platform: 'linux',
    scriptFlavor: 'sh',
    probe: { kind: 'path', exes: ['konsole'] },
    launcher: 'konsole',
    argv: ({ scriptPath }) => ['-e', scriptPath],
  },
  {
    id: 'xfce4-terminal',
    platform: 'linux',
    scriptFlavor: 'sh',
    probe: { kind: 'path', exes: ['xfce4-terminal'] },
    launcher: 'xfce4-terminal',
    argv: ({ scriptPath }) => ['-e', scriptPath],
  },
  {
    id: 'xterm',
    platform: 'linux',
    scriptFlavor: 'sh',
    probe: { kind: 'path', exes: ['xterm'] },
    launcher: 'xterm',
    argv: ({ scriptPath }) => ['-e', scriptPath],
  },
]

/**
 * A Map, not an object literal: `__proto__` and `constructor` are ordinary
 * misses here, where an object lookup would resolve them to inherited values.
 */
const REGISTRY = new Map<string, LaunchRecipe>(RECIPES.map((r) => [r.id, r]))

/**
 * Exact membership only. No trimming, no case folding, no prefix matching,
 * no whitespace splitting: the string either is a key or it is not.
 */
export function getRecipe(id: unknown): LaunchRecipe | undefined {
  if (typeof id !== 'string') return undefined
  return REGISTRY.get(id)
}

export function isTerminalProfileId(id: unknown): id is TerminalProfileId {
  return getRecipe(id) !== undefined
}

export function listRecipes(platform?: TerminalPlatform): LaunchRecipe[] {
  return platform ? RECIPES.filter((r) => r.platform === platform) : RECIPES.slice()
}

export function registryIds(): string[] {
  return RECIPES.map((r) => r.id)
}

/** Fallback order used when the stored preference is 'auto'. */
export const AUTO_ORDER: Record<TerminalPlatform, TerminalProfileId[]> = {
  win32: ['wt-pwsh', 'pwsh', 'powershell', 'git-bash', 'cmd'],
  darwin: ['macos-default'],
  linux: ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'],
}

export { TERMINAL_LABELS, TERMINAL_PROFILE_IDS, escapeSingleQuoted }
export type { TerminalPlatform, TerminalProfileId }
