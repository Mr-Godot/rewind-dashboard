import * as fs from 'node:fs'
import * as readline from 'node:readline'
import { safeParse, extractToolResultText } from '../parsers/session-parser'
import type { BlockType } from './provider'

export interface SearchBlock {
  role: string
  blockType: BlockType
  timestamp: string
  /** Position of the block within the file (0-based, across all messages). */
  seq: number
  text: string
}

/** Cap on stored text per block to keep the index small and queries fast. */
const MAX_BLOCK_TEXT = 8 * 1024
/** tool_result blocks above this raw size are skipped entirely (pathological). */
const MAX_TOOL_RESULT_RAW = 256 * 1024
/** Input fields worth surfacing verbatim from a tool_use block. */
const TOOL_INPUT_KEYS = ['command', 'file_path', 'pattern', 'prompt'] as const

function cap(text: string): string {
  return text.length > MAX_BLOCK_TEXT ? text.slice(0, MAX_BLOCK_TEXT) : text
}

/**
 * Build a searchable text representation of a tool_use block: the tool name,
 * the most useful string inputs, and a capped JSON dump of the whole input so
 * that less-common fields are still searchable.
 */
function describeToolUse(name: string | undefined, input: unknown): string {
  const parts: string[] = []
  if (name) parts.push(name)
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>
    for (const key of TOOL_INPUT_KEYS) {
      const v = rec[key]
      if (typeof v === 'string' && v) parts.push(v)
    }
    try {
      const json = JSON.stringify(input)
      if (json) parts.push(json.slice(0, MAX_BLOCK_TEXT))
    } catch {
      // Non-serializable input — the name + string fields above still apply.
    }
  }
  return parts.join(' ')
}

/**
 * Stream a session JSONL file and yield one SearchBlock per searchable content
 * block. Bounded memory: the file is read line-by-line via readline, and only
 * one block is held at a time.
 *
 * Covered blocks: assistant/user `text`, assistant `thinking`, `tool_use`
 * (name + key inputs), and `tool_result` text. This is the core gain over the
 * old text-only scan.
 */
export async function* extractSearchBlocks(
  filePath: string,
): AsyncGenerator<SearchBlock> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let seq = 0

  try {
    for await (const line of rl) {
      const msg = safeParse(line)
      if (!msg) continue
      if (msg.type !== 'user' && msg.type !== 'assistant') continue
      const content = msg.message?.content
      if (!Array.isArray(content)) continue

      const role = msg.message?.role ?? msg.type
      const timestamp = msg.timestamp ?? ''

      for (const block of content) {
        let blockType: BlockType | null = null
        let text = ''

        if (block.type === 'text' && block.text) {
          blockType = 'text'
          text = block.text
        } else if (block.type === 'thinking' && block.thinking) {
          blockType = 'thinking'
          text = block.thinking
        } else if (block.type === 'tool_use') {
          blockType = 'tool_use'
          text = describeToolUse(block.name, block.input)
        } else if (block.type === 'tool_result') {
          const raw = extractToolResultText(block)
          if (!raw) continue
          // Skip pathological tool_result payloads (e.g. huge file dumps).
          if (raw.length > MAX_TOOL_RESULT_RAW) continue
          blockType = 'tool_result'
          text = raw
        }

        if (!blockType) continue
        text = cap(text.trim())
        if (!text) continue

        yield { role, blockType, timestamp, seq, text }
        seq++
      }
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}
