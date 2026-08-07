/**
 * Decides WHETHER a launch request is allowed to be read at all.
 * Server-only: imported by the Vite dev middleware, never by client code.
 *
 * `/api/launch-session` spawns `claude --resume --dangerously-skip-permissions`,
 * so any page in any open browser must not be able to drive it. A cross-origin
 * POST always carries an `Origin` the attacker cannot forge, so the header is
 * the whole gate: no token, no state, no cookie.
 */

export type OriginDecision = { ok: true } | { ok: false; status: 403; error: string }

/** The app is localhost-only, so these are the only hosts it can legitimately serve. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase())
}

const DENIED = (error: string): OriginDecision => ({ ok: false, status: 403, error })

/**
 * Allow only a same-origin request from a loopback address.
 *
 * The expected origin is derived from the request's own `Host` header rather
 * than a hardcoded port, because the port varies (3030 in normal use, 3000 by
 * default, 3001 under e2e). A browser writes `Host` from the URL it dialled and
 * `Origin` from the initiating document, so comparing the two catches exactly
 * the confused-deputy case. Requiring `Host` itself to be loopback also blocks
 * DNS rebinding, where a hostile name resolves to 127.0.0.1.
 *
 * A MISSING `Origin` is rejected: browsers send it on every POST, so only
 * non-browser clients omit it, and none exist in this app.
 */
export function validateRequestOrigin(headers: {
  origin?: string | string[] | null
  host?: string | string[] | null
}): OriginDecision {
  const origin = Array.isArray(headers.origin) ? headers.origin[0] : headers.origin
  const host = Array.isArray(headers.host) ? headers.host[0] : headers.host

  if (!origin) return DENIED('Forbidden: missing Origin header')
  // Sandboxed iframes and file:// documents send the literal string.
  if (origin === 'null') return DENIED('Forbidden: opaque Origin')
  if (!host) return DENIED('Forbidden: missing Host header')
  // Credentials or a path in Host would let a crafted value parse as loopback.
  if (host.includes('@') || host.includes('/')) return DENIED('Forbidden: malformed Host header')

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return DENIED('Forbidden: malformed Origin header')
  }
  if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
    return DENIED('Forbidden: unsupported Origin scheme')
  }
  if (!isLoopbackHostname(originUrl.hostname)) {
    return DENIED('Forbidden: non-loopback Origin')
  }

  // Parsing Host under the Origin's scheme makes default ports normalize the
  // same way on both sides, so `http://localhost` and `localhost:80` match.
  let hostUrl: URL
  try {
    hostUrl = new URL(`${originUrl.protocol}//${host}`)
  } catch {
    return DENIED('Forbidden: malformed Host header')
  }
  if (originUrl.host.toLowerCase() !== hostUrl.host.toLowerCase()) {
    return DENIED('Forbidden: cross-origin request')
  }

  return { ok: true }
}
