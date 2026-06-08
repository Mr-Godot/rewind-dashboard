import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { createServerFn } from '@tanstack/react-start'
import { MetadataSchema, DEFAULT_METADATA, type Metadata } from './metadata.types'

const METADATA_DIR = '.claude-dashboard'
const METADATA_FILE = 'session-metadata.json'

function getMetadataPath(): string {
  return path.join(os.homedir(), METADATA_DIR, METADATA_FILE)
}

function getMetadataDir(): string {
  return path.join(os.homedir(), METADATA_DIR)
}

function readMetadataSync(): Metadata {
  try {
    const raw = fs.readFileSync(getMetadataPath(), 'utf-8')
    const json = JSON.parse(raw) as unknown
    const result = MetadataSchema.safeParse(json)
    if (result.success) return result.data
    console.warn('Invalid metadata file, using defaults:', result.error.message)
    return DEFAULT_METADATA
  } catch {
    return DEFAULT_METADATA
  }
}

function writeMetadataSync(metadata: Metadata): void {
  const withTimestamp: Metadata = {
    ...metadata,
    updatedAt: new Date().toISOString(),
  }
  const dir = getMetadataDir()
  const filePath = getMetadataPath()
  const tmpPath = filePath + '.tmp'

  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmpPath, JSON.stringify(withTimestamp, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch (_) { /* cleanup failure is non-fatal */ }
    throw new Error(
      `Failed to save metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

function cleanEntry<T extends Record<string, unknown>>(entry: T): T | null {
  const cleaned = { ...entry }
  for (const [k, v] of Object.entries(cleaned)) {
    if (v === undefined || v === false || v === '') delete cleaned[k]
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null
}

// --- Server Functions ---

export const getMetadata = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Metadata> => {
    return readMetadataSync()
  },
)

export const pinSession = createServerFn({ method: 'POST' })
  .inputValidator((input: { sessionId: string; pinned: boolean }) => input)
  .handler(async ({ data }) => {
    const metadata = readMetadataSync()
    const entry = { ...metadata.sessions[data.sessionId], pinned: data.pinned || undefined }
    const cleaned = cleanEntry(entry)
    if (cleaned) {
      metadata.sessions[data.sessionId] = cleaned
    } else {
      delete metadata.sessions[data.sessionId]
    }
    writeMetadataSync(metadata)
  })

export const renameSession = createServerFn({ method: 'POST' })
  .inputValidator((input: { sessionId: string; customName: string }) => input)
  .handler(async ({ data }) => {
    const metadata = readMetadataSync()
    const entry = {
      ...metadata.sessions[data.sessionId],
      customName: data.customName || undefined,
    }
    const cleaned = cleanEntry(entry)
    if (cleaned) {
      metadata.sessions[data.sessionId] = cleaned
    } else {
      delete metadata.sessions[data.sessionId]
    }
    writeMetadataSync(metadata)
  })

export const pinProject = createServerFn({ method: 'POST' })
  .inputValidator((input: { projectPath: string; pinned: boolean }) => input)
  .handler(async ({ data }) => {
    const metadata = readMetadataSync()
    const entry = { ...metadata.projects[data.projectPath], pinned: data.pinned || undefined }
    const cleaned = cleanEntry(entry)
    if (cleaned) {
      metadata.projects[data.projectPath] = cleaned
    } else {
      delete metadata.projects[data.projectPath]
    }
    writeMetadataSync(metadata)
  })

export const hideProject = createServerFn({ method: 'POST' })
  .inputValidator((input: { projectPath: string; hidden: boolean }) => input)
  .handler(async ({ data }) => {
    const metadata = readMetadataSync()
    const entry = { ...metadata.projects[data.projectPath], hidden: data.hidden || undefined }
    const cleaned = cleanEntry(entry)
    if (cleaned) {
      metadata.projects[data.projectPath] = cleaned
    } else {
      delete metadata.projects[data.projectPath]
    }
    writeMetadataSync(metadata)
  })

export const renameProject = createServerFn({ method: 'POST' })
  .inputValidator((input: { projectPath: string; customName: string }) => input)
  .handler(async ({ data }) => {
    const metadata = readMetadataSync()
    const entry = {
      ...metadata.projects[data.projectPath],
      customName: data.customName || undefined,
    }
    const cleaned = cleanEntry(entry)
    if (cleaned) {
      metadata.projects[data.projectPath] = cleaned
    } else {
      delete metadata.projects[data.projectPath]
    }
    writeMetadataSync(metadata)
  })

// Exported for server-side use in sessions.api.ts
export { readMetadataSync }
