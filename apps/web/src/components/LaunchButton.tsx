import { useState, useCallback } from 'react'

interface LaunchButtonProps {
  sessionId: string
  cwd?: string
  size?: 'sm' | 'md'
  isActive?: boolean
}

export function LaunchButton({ sessionId, cwd, size = 'sm', isActive }: LaunchButtonProps) {
  const [status, setStatus] = useState<'idle' | 'launched' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const padding = size === 'md' ? 'px-3 py-1' : 'px-2 py-0.5'

  const launch = useCallback(async () => {
    try {
      const res = await fetch('/api/launch-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, cwd }),
      })
      if (res.ok) {
        setError(null)
        setStatus('launched')
        setTimeout(() => setStatus('idle'), 2000)
        return
      }
      // The server refused (e.g. 409: the recorded working directory is gone).
      // Show its reason instead of a silent no-op.
      const body = await res.json().catch(() => null)
      setError(body?.error ?? `Launch failed (${res.status})`)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 8000)
    } catch {
      setError('Launch failed: the dashboard server did not respond')
      setStatus('error')
      setTimeout(() => setStatus('idle'), 8000)
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
    <>
      <button
        type="button"
        title={status === 'error' && error ? error : 'Launch session in terminal'}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          launch()
        }}
        className={`shrink-0 border border-matrix/20 bg-matrix/10 ${padding} text-xs font-medium text-matrix transition-colors hover:border-matrix/30 hover:bg-matrix/15`}
      >
        {status === 'launched' ? 'Launched!' : status === 'error' ? 'Failed' : 'Launch'}
      </button>
      {status === 'error' && error && (
        <span role="alert" title={error} className="max-w-64 truncate text-[10px] text-red-400">
          {error}
        </span>
      )}
    </>
  )
}
