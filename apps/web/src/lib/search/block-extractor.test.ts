import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { extractSearchBlocks, type SearchBlock } from './block-extractor'

let tmpDir: string

function writeJsonl(name: string, lines: object[], eol = '\r\n'): string {
  const file = path.join(tmpDir, name)
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join(eol) + eol, 'utf-8')
  return file
}

async function collect(file: string): Promise<SearchBlock[]> {
  const out: SearchBlock[] = []
  for await (const b of extractSearchBlocks(file)) out.push(b)
  return out
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-blockx-'))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('extractSearchBlocks', () => {
  it('extracts every block type across CRLF lines, skipping noise', async () => {
    const file = writeJsonl('all.jsonl', [
      { type: 'user', timestamp: 't1', message: { role: 'user', content: [{ type: 'text', text: 'hello world from user' }] } },
      {
        type: 'assistant',
        timestamp: 't2',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'let me ponder zebra' },
            { type: 'text', text: 'assistant reply apple' },
            { type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'ls -la widgetdir', description: 'list' } },
          ],
        },
      },
      { type: 'user', timestamp: 't3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'total 5 mango' }] }] } },
      // noise that must be ignored
      { type: 'file-history-snapshot', snapshot: { timestamp: 't0' } },
    ])
    // append a malformed (non-JSON) line
    fs.appendFileSync(file, '{ this is not json\r\n', 'utf-8')

    const blocks = await collect(file)
    const byType = blocks.map((b) => b.blockType)

    expect(byType).toEqual(['text', 'thinking', 'text', 'tool_use', 'tool_result'])

    const text0 = blocks[0]
    expect(text0.role).toBe('user')
    expect(text0.timestamp).toBe('t1')
    expect(text0.text).toContain('hello world')

    const thinking = blocks[1]
    expect(thinking.role).toBe('assistant')
    expect(thinking.text).toContain('ponder zebra')

    const toolUse = blocks[3]
    expect(toolUse.blockType).toBe('tool_use')
    expect(toolUse.text).toContain('Bash')
    expect(toolUse.text).toContain('ls -la widgetdir')

    const toolResult = blocks[4]
    expect(toolResult.blockType).toBe('tool_result')
    expect(toolResult.text).toContain('total 5 mango')

    // seq is contiguous across all yielded blocks
    expect(blocks.map((b) => b.seq)).toEqual([0, 1, 2, 3, 4])
  })

  it('caps oversized block text and skips pathological tool_result payloads', async () => {
    const bigText = 'x'.repeat(20 * 1024)
    const hugeResult = 'y'.repeat(300 * 1024)
    const file = writeJsonl('big.jsonl', [
      { type: 'assistant', timestamp: 't1', message: { role: 'assistant', content: [{ type: 'text', text: bigText }] } },
      { type: 'user', timestamp: 't2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: hugeResult }] }] } },
    ])

    const blocks = await collect(file)
    // The text block is kept but capped to 8KB; the huge tool_result is dropped.
    expect(blocks).toHaveLength(1)
    expect(blocks[0].blockType).toBe('text')
    expect(blocks[0].text.length).toBe(8 * 1024)
  })

  it('ignores non-user/assistant messages and empty content', async () => {
    const file = writeJsonl('empty.jsonl', [
      { type: 'system', timestamp: 't1', level: 'error', slug: 'boom' },
      { type: 'assistant', timestamp: 't2', message: { role: 'assistant', content: [] } },
      { type: 'user', timestamp: 't3', message: { role: 'user', content: [{ type: 'text', text: '   ' }] } },
    ])

    const blocks = await collect(file)
    expect(blocks).toHaveLength(0)
  })
})
