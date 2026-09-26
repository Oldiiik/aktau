// Account sessions. The cookie holds signed claims { account id, role,
// session_version, expiry } — HMAC-SHA256 with SESSION_SECRET (falls back to
// ADMIN_TOKEN, then to the server-only key the Supabase integration adds on
// Vercel; hmac() prefixes it, so it is never used as-is). Web Crypto only, so
// the proxy can check it without the DB.
// The proxy trusts the role claim just to route; route handlers and server
// pages re-read the account (role, disabled, session_version) from the DB.
export type Role = 'resident' | 'operator' | 'admin'
export type Claims = { a: string; r: Role; v: number; e: number }

export const SESSION_COOKIE = 'aktau_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30

const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null
const enc = new TextEncoder()
const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url')

async function hmac(data: string, key: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(`aktau-session-v1:${key}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64(await crypto.subtle.sign('HMAC', k, enc.encode(data)))
}

export const sessionsEnabled = () => !!secret()

export async function signSession(c: Omit<Claims, 'e'>, maxAge = SESSION_MAX_AGE): Promise<string> {
  const key = secret()
  if (!key) throw new Error('SESSION_SECRET is not set')
  const body = b64(enc.encode(JSON.stringify({ ...c, e: Math.floor(Date.now() / 1000) + maxAge })))
  return `${body}.${await hmac(body, key)}`
}

export async function readSession(value: string | undefined | null): Promise<Claims | null> {
  const key = secret()
  if (!key || !value) return null
  const [body, sig] = value.split('.')
  if (!body || !sig) return null
  const expected = await hmac(body, key)
  if (expected.length !== sig.length) return null
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  if (diff !== 0) return null
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims
    return c.e > Date.now() / 1000 ? c : null
  } catch { return null }
}

export const canUseCopilot = (r: Role | null | undefined) => r === 'operator' || r === 'admin'
export const canAdmin = (r: Role | null | undefined) => r === 'admin'
