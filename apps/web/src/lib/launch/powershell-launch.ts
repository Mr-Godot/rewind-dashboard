/**
 * Builds the PowerShell invocation used to open a visible `claude --resume`
 * terminal on Windows. Pure and side-effect free apart from `defaultProbe`,
 * so the shell selection and script contents are unit-testable.
 */

/** Escape a value for embedding in a PowerShell single-quoted string. */
export function escapeSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * `-NoExit` keeps the window open after claude exits. `-ExecutionPolicy Bypass`
 * is required: the generated .ps1 is unsigned and lives in %TEMP%, which the
 * default policy refuses to run.
 */
export function buildPowerShellArgs(scriptPath: string): string[] {
  return ['-NoExit', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
}

/**
 * The .ps1 self-deletes on its last line so no temp file leaks even if the Vite
 * dev server has already shut down. PowerShell reads the whole script into
 * memory before executing, so removing it mid-run is safe.
 */
export function buildLaunchScript(options: {
  sessionId: string
  sessionCwd: string
  windowTitle: string
}): string {
  const { sessionId, sessionCwd, windowTitle } = options
  const lines = [
    `$Host.UI.RawUI.WindowTitle = '${escapeSingleQuoted(windowTitle)}'`,
    `Set-Location -LiteralPath '${escapeSingleQuoted(sessionCwd.replace(/\//g, '\\'))}'`,
    `claude --resume ${sessionId} --dangerously-skip-permissions`,
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
    '',
  ]
  return lines.join('\r\n')
}
