import { useState, useCallback } from 'react'

interface LaunchButtonProps {
  sessionId: string
  cwd?: string
  size?: 'sm' | 'md'
  isActive?: boolean
}

export function LaunchButton({ sessionId, cwd, size = 'sm', isActive }: LaunchButtonProps) {
  const [status, setStatus] = useState<'idle' | 'launched' | 'error'>('idle')
  const padding = size === 'md' ? 'px-3 py-1' : 'px-2 py-0.5'

  const launch = useCallback(async () => {
    try {
      const res = await fetch('/api/launch-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, cwd }),
      })
      setStatus(res.ok ? 'launched' : 'error')
      setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2000)
    }
  }, [sessionId, cwd])

  if (isActive) {
    return (
      <span className={`shrink-0 border border-matrix/20 bg-matrix/10 ${padding} text-xs font-medium text-matrix/60`}>
        active
      </span>
    )
  }

  return (
    <button
      type="button"
      title="Launch session in terminal"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        launch()
      }}
      className={`shrink-0 border border-matrix/20 bg-matrix/10 ${padding} text-xs font-medium text-matrix transition-colors hover:border-matrix/30 hover:bg-matrix/15`}
    >
      {status === 'launched' ? 'Launched!' : status === 'error' ? 'Failed' : 'Launch'}
    </button>
  )
}
