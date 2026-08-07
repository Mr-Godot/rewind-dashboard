import { describe, it, expect } from 'vitest'
import { validateRequestOrigin, isLoopbackHostname } from './request-origin'

describe('isLoopbackHostname', () => {
  it('accepts the three loopback forms', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('LOCALHOST')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isLoopbackHostname('evil.com')).toBe(false)
    expect(isLoopbackHostname('localhost.evil.com')).toBe(false)
    expect(isLoopbackHostname('127.0.0.2')).toBe(false)
  })
})

describe('validateRequestOrigin', () => {
  it('allows a same-origin request on the configured port', () => {
    expect(validateRequestOrigin({ origin: 'http://localhost:3030', host: 'localhost:3030' })).toEqual({ ok: true })
  })

  it('allows the other loopback spellings and ports', () => {
    expect(validateRequestOrigin({ origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' })).toEqual({ ok: true })
    expect(validateRequestOrigin({ origin: 'http://[::1]:3001', host: '[::1]:3001' })).toEqual({ ok: true })
    expect(validateRequestOrigin({ origin: 'https://localhost:3030', host: 'localhost:3030' })).toEqual({ ok: true })
  })

  it('normalizes default ports on both sides', () => {
    expect(validateRequestOrigin({ origin: 'http://localhost', host: 'localhost:80' })).toEqual({ ok: true })
    expect(validateRequestOrigin({ origin: 'http://localhost:80', host: 'localhost' })).toEqual({ ok: true })
  })

  it('rejects a cross-origin request', () => {
    const result = validateRequestOrigin({ origin: 'https://evil.com', host: 'localhost:3030' })
    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden: non-loopback Origin' })
  })

  it('rejects an opaque null Origin', () => {
    const result = validateRequestOrigin({ origin: 'null', host: 'localhost:3030' })
    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden: opaque Origin' })
  })

  it('rejects a missing Origin', () => {
    expect(validateRequestOrigin({ host: 'localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: missing Origin header',
    })
    expect(validateRequestOrigin({ origin: '', host: 'localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: missing Origin header',
    })
  })

  it('rejects a non-loopback host that resolves to loopback', () => {
    expect(validateRequestOrigin({ origin: 'http://app.internal:3030', host: 'app.internal:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: non-loopback Origin',
    })
  })

  it('rejects a lookalike host', () => {
    expect(validateRequestOrigin({ origin: 'http://localhost.evil.com:3030', host: 'localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: non-loopback Origin',
    })
  })

  it('rejects a port mismatch', () => {
    expect(validateRequestOrigin({ origin: 'http://localhost:4000', host: 'localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: cross-origin request',
    })
  })

  it('rejects a loopback-alias mismatch, since they are distinct origins', () => {
    expect(validateRequestOrigin({ origin: 'http://127.0.0.1:3030', host: 'localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: cross-origin request',
    })
  })

  it('rejects a missing Host header', () => {
    expect(validateRequestOrigin({ origin: 'http://localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: missing Host header',
    })
  })

  it('rejects a Host carrying userinfo or a path', () => {
    expect(validateRequestOrigin({ origin: 'http://localhost:3030', host: 'evil.com@localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: malformed Host header',
    })
    expect(validateRequestOrigin({ origin: 'http://localhost:3030', host: 'localhost:3030/x' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: malformed Host header',
    })
  })

  it('rejects a non-http Origin scheme', () => {
    expect(validateRequestOrigin({ origin: 'file://localhost', host: 'localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: unsupported Origin scheme',
    })
    expect(validateRequestOrigin({ origin: 'chrome-extension://abcdef', host: 'localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: unsupported Origin scheme',
    })
  })

  it('rejects an unparseable Origin', () => {
    expect(validateRequestOrigin({ origin: 'not a url', host: 'localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: malformed Origin header',
    })
  })

  it('rejects an unparseable Host', () => {
    expect(validateRequestOrigin({ origin: 'http://localhost:3030', host: 'localhost:notaport' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: malformed Host header',
    })
  })

  it('reads the first value when a header arrives repeated', () => {
    expect(validateRequestOrigin({ origin: ['http://localhost:3030'], host: ['localhost:3030'] })).toEqual({ ok: true })
    expect(validateRequestOrigin({ origin: ['https://evil.com', 'http://localhost:3030'], host: 'localhost:3030' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden: non-loopback Origin',
    })
  })
})
