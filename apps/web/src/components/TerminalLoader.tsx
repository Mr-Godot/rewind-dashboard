import { useState, useEffect, useRef } from 'react'

const PHRASES = [
  'scanning sessions',
  'parsing tokens',
  'loading matrix',
  'connecting to claude',
  'reading JSONL',
  'counting messages',
  'indexing tool calls',
  'decoding conversations',
  'crunching stats',
  'mapping projects',
]

// Braille spinner frames
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// Fake log lines that trickle in
const LOG_LINES = [
  'init    session parser v2.1',
  'scan    ~/.claude/projects/',
  'found   %d session files',
  'parse   jsonl stream opened',
  'index   building token map',
  'stats   aggregating daily data',
  'cache   warming model usage',
  'render  preparing charts',
]

export function TerminalLoader() {
  const [spinnerIdx, setSpinnerIdx] = useState(0)
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [dots, setDots] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])
  const [cursorVisible, setCursorVisible] = useState(true)
  const logIdxRef = useRef(0)

  // Spinner rotation — 80ms per frame
  useEffect(() => {
    const id = setInterval(() => setSpinnerIdx((i) => (i + 1) % SPINNER.length), 80)
    return () => clearInterval(id)
  }, [])

  // Phrase cycling — every 2s
  useEffect(() => {
    const id = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % PHRASES.length)
      setDots('')
    }, 2000)
    return () => clearInterval(id)
  }, [])

  // Dot animation — every 400ms
  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'))
    }, 400)
    return () => clearInterval(id)
  }, [])

  // Cursor blink — 530ms
  useEffect(() => {
    const id = setInterval(() => setCursorVisible((v) => !v), 530)
    return () => clearInterval(id)
  }, [])

  // Log lines trickle in
  useEffect(() => {
    const addLine = () => {
      const line = LOG_LINES[logIdxRef.current % LOG_LINES.length]
      const formatted = line.replace('%d', String(Math.floor(Math.random() * 400) + 50))
      setLogLines((prev) => {
        const next = [...prev, formatted]
        return next.length > 6 ? next.slice(-6) : next
      })
      logIdxRef.current++
    }
    // First line quick
    const t1 = setTimeout(addLine, 300)
    const id = setInterval(addLine, 1100 + Math.random() * 600)
    return () => {
      clearTimeout(t1)
      clearInterval(id)
    }
  }, [])

  return (
    <div className="flex flex-col items-start py-8">
      {/* Main spinner + phrase */}
      <div className="flex items-center gap-3 font-mono text-lg">
        <span className="text-matrix text-2xl w-6 text-center">{SPINNER[spinnerIdx]}</span>
        <span className="text-matrix/90">{PHRASES[phraseIdx]}{dots}</span>
        <span
          className="text-matrix text-2xl transition-opacity duration-100"
          style={{ opacity: cursorVisible ? 1 : 0 }}
        >
          _
        </span>
      </div>

      {/* Terminal log output */}
      <div className="mt-8 w-full max-w-md border border-matrix/20 bg-gray-950/80 p-4 font-mono text-xs">
        <div className="mb-2 flex items-center gap-2 text-matrix/40 text-[10px] uppercase tracking-widest">
          <span>rewind</span>
          <span className="text-gray-700">|</span>
          <span>loading</span>
        </div>
        <div className="space-y-1">
          {logLines.map((line, i) => {
            const isLatest = i === logLines.length - 1
            return (
              <div
                key={`${logIdxRef.current - logLines.length + i}`}
                className="flex gap-2 transition-opacity duration-300"
                style={{ opacity: isLatest ? 1 : 0.4 }}
              >
                <span className="text-matrix/50 select-none">{'>'}</span>
                <span className={isLatest ? 'text-matrix/90' : 'text-matrix/30'}>
                  {line}
                </span>
              </div>
            )
          })}
        </div>
        {/* Empty line with blinking cursor */}
        <div className="mt-1 flex gap-2">
          <span className="text-matrix/50 select-none">{'>'}</span>
          <span
            className="text-matrix"
            style={{ opacity: cursorVisible ? 0.7 : 0 }}
          >
            _
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 w-full max-w-md">
        <div className="h-px bg-matrix/10 overflow-hidden">
          <div className="h-full bg-matrix/40 animate-terminal-progress" />
        </div>
      </div>
    </div>
  )
}
