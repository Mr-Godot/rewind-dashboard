export function ActiveSessionBanner() {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-matrix/30 bg-matrix/15 px-4 py-2 text-sm text-matrix">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-matrix opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-matrix" />
      </span>
      This session is currently active. Data refreshes automatically.
    </div>
  )
}
