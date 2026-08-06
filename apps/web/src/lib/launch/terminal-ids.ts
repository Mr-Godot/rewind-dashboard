/**
 * The complete, cross-platform list of terminal profile IDs.
 *
 * Kept in its own dependency-free module because two very different consumers
 * need it: the Zod enum in `features/settings/settings.types.ts`, which is
 * bundled for the browser, and `terminal-registry.ts`, which pulls in
 * `node:child_process`. A drift test asserts this list equals the registry keys.
 */

export const TERMINAL_PROFILE_IDS = [
  // win32
  'wt-pwsh',
  'wt-powershell',
  'pwsh',
  'powershell',
  'cmd',
  'git-bash',
  // darwin
  'macos-default',
  'terminal-app',
  'iterm2',
  'ghostty',
  'alacritty',
  // linux
  'x-terminal-emulator',
  'gnome-terminal',
  'konsole',
  'xfce4-terminal',
  'xterm',
] as const

export type TerminalProfileId = (typeof TERMINAL_PROFILE_IDS)[number]

/** Stored preference: an explicit profile, or the literal 'auto'. */
export type TerminalChoice = TerminalProfileId | 'auto'

export type TerminalPlatform = 'win32' | 'darwin' | 'linux'

/**
 * Human labels live here rather than in the registry so the browser can name a
 * saved-but-no-longer-installed profile without importing server-only code.
 */
export const TERMINAL_LABELS: Record<TerminalProfileId, string> = {
  'wt-pwsh': 'Windows Terminal (PowerShell 7)',
  'wt-powershell': 'Windows Terminal (Windows PowerShell)',
  pwsh: 'PowerShell 7',
  powershell: 'Windows PowerShell',
  cmd: 'Command Prompt',
  'git-bash': 'Git Bash',
  'macos-default': 'Default terminal',
  'terminal-app': 'Terminal',
  iterm2: 'iTerm2',
  ghostty: 'Ghostty',
  alacritty: 'Alacritty',
  'x-terminal-emulator': 'Default terminal',
  'gnome-terminal': 'GNOME Terminal',
  konsole: 'Konsole',
  'xfce4-terminal': 'Xfce Terminal',
  xterm: 'xterm',
}
