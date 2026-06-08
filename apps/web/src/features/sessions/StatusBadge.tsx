import { useState, useEffect } from 'react'

type SessionState = 'working' | 'waiting' | 'inactive'

const SPINNER_CHARS = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F']

function BrailleSpinner({ offset }: { offset: number }) {
  // Start phase-shifted by `offset`, then advance one frame per tick. Avoids
  // Date.now() during render (impure) \u2014 the per-tick increment is equivalent.
  const [frame, setFrame] = useState(offset % SPINNER_CHARS.length)
  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_CHARS.length)
    }, 80)
    return () => clearInterval(id)
  }, [])
  return <span>{SPINNER_CHARS[frame]}</span>
}


function BlinkingCursor() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const id = setInterval(() => setVisible((v) => !v), 750)
    return () => clearInterval(id)
  }, [])
  return <span className={`font-mono text-matrix/40 ${visible ? 'opacity-100' : 'opacity-0'}`}>{'\u2588'}</span>
}

export function StatusBadge({ isActive, sessionState }: { isActive: boolean; sessionState?: SessionState }) {
  const state = sessionState ?? (isActive ? 'working' : 'inactive')

  if (state === 'working') {
    return (
      <span className="inline-flex items-center border border-matrix/20 bg-matrix/10 px-2 py-0.5 text-sm font-mono text-matrix tracking-tight border-l-0 working-glow">
        <BrailleSpinner offset={0} /><BrailleSpinner offset={2} /><BrailleSpinner offset={5} /><BrailleSpinner offset={7} /><BrailleSpinner offset={1} /><BrailleSpinner offset={4} /><BrailleSpinner offset={9} /><BrailleSpinner offset={3} /><BrailleSpinner offset={6} /><BrailleSpinner offset={8} />
      </span>
    )
  }

  if (state === 'waiting') {
    return (
      <span className="inline-flex items-center border border-matrix/20 bg-matrix/10 px-2 py-0.5 text-sm font-mono text-matrix/50 tracking-tight border-l-0 min-w-[6.5rem]">
        {'> waiting\u00a0'}<BlinkingCursor />{' '}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-500/15 px-2.5 py-0.5 text-xs font-medium text-gray-400">
      <span className="h-2 w-2 rounded-full bg-gray-500" />
      Completed
    </span>
  )
}
