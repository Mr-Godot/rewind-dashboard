import { describe, it, expect, afterEach, vi } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadSqliteDriver } from './sqlite-driver'

let errorSpy: ReturnType<typeof vi.spyOn> | null = null

afterEach(() => {
  errorSpy?.mockRestore()
  errorSpy = null
})

describe('loadSqliteDriver', () => {
  it('logs the underlying error instead of swallowing it, and still returns null', () => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Directory does not exist, so the native open fails. If better-sqlite3 is
    // not installed at all, the require fails instead. Both must be reported.
    const unopenable = path.join(os.tmpdir(), 'rewind-no-such-dir-3f9a1c', 'index.db')
    const driver = loadSqliteDriver(unopenable)

    expect(driver).toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(1)

    const call = errorSpy.mock.calls[0]
    expect(String(call[0])).toContain('[search]')
    expect(String(call[0])).toContain('better-sqlite3')
    // The real cause must be part of the log line, not discarded.
    expect(call[call.length - 1]).toBeTruthy()
  })
})
