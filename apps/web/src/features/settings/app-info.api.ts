import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServerFn } from '@tanstack/react-start'

export interface AppInfo {
  version: string
  appPath: string
  nodeEnv: string
}

function readVersionFromPackageJson(): string {
  // Try multiple candidate paths relative to the compiled server file
  // (dist/server/assets/app-info.api-*.js), walking up to the package root.
  const candidates = [
    new URL('../../../package.json', import.meta.url),
    new URL('../../../../package.json', import.meta.url),
  ]

  for (const candidate of candidates) {
    try {
      const pkgPath = fileURLToPath(candidate)
      const raw = fs.readFileSync(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw) as { version?: string }
      if (pkg.version) return pkg.version
    } catch {
      // Try next candidate
    }
  }

  // Final fallback: process.cwd() (works during local dev)
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json')
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as { version?: string }
    if (pkg.version) return pkg.version
  } catch {
    // Fall back to unknown
  }

  return 'unknown'
}

export const getAppInfo = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AppInfo> => {
    return {
      version: readVersionFromPackageJson(),
      appPath: path.join(os.homedir(), '.claude'),
      nodeEnv: process.env.NODE_ENV ?? 'development',
    }
  },
)
