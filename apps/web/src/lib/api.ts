// Route-handler helpers: consistent JSON, errors, language, location input,
// rate limits. Handlers stay thin; logic lives in @aktau/server.
import { NextResponse, type NextRequest } from 'next/server'
import { getAccount, getSql, log, rateLimit, type Account, type LocationInput } from '@aktau/server'
import type { Lang } from '@aktau/types'
import { ZodError } from 'zod'
import { COOKIE } from './session.ts'
import { canAdmin, canUseCopilot, readSession, type Role } from './auth.ts'

export const sql = () => getSql()

export function json(data: unknown, init: { status?: number; cache?: string } = {}) {
  return NextResponse.json(data, { status: init.status ?? 200, headers: { 'cache-control': init.cache ?? 'no-store' } })
}

export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers: { 'cache-control': 'no-store' } })
}

export function langOf(req: NextRequest): Lang {
  const q = req.nextUrl.searchParams.get('lang') ?? req.cookies.get(COOKIE.lang)?.value
  return q === 'ru' || q === 'kk' || q === 'en' ? q : 'en'
}

const num = (v: string | null) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

export function locationOf(req: NextRequest): LocationInput {
  const p = req.nextUrl.searchParams
  return {
    saved_location_id: p.get('saved_location_id'),
    building_id: p.get('building_id'),
    area_id: p.get('area_id'),
    lat: num(p.get('lat')),
    lon: num(p.get('lon')),
    installation_id: p.get('installation_id') ?? req.cookies.get(COOKIE.iid)?.value ?? null,
  }
}

export function installationOf(req: NextRequest): string | null {
  return req.headers.get('x-installation-id') ?? req.cookies.get(COOKIE.iid)?.value ?? null
}

export function clientKey(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || installationOf(req) || 'anonymous'
}

/** Returns a 429 response when over the limit, otherwise null. */
export async function limited(req: NextRequest, bucket: string, limit: number, windowSeconds: number) {
  const r = await rateLimit(sql(), bucket, clientKey(req), limit, windowSeconds)
  return r.ok ? null : fail(429, 'rate_limited', 'Too many requests — please slow down.')
}

/**
 * Per device (the installation cookie), and more loosely per network: a hall
 * of people on one Wi-Fi shares a public IP, and must not lock each other out.
 * Without a cookie the tight per-device limit applies to the address.
 */
export async function limitedPerDevice(req: NextRequest, bucket: string, perDevice: number, perNetwork: number, windowSeconds: number) {
  const iid = installationOf(req)
  if (iid) {
    const d = await rateLimit(sql(), `${bucket}:device`, iid, perDevice, windowSeconds)
    if (!d.ok) return fail(429, 'rate_limited', 'Too many requests — please slow down.')
  }
  const n = await rateLimit(sql(), `${bucket}:network`, clientKey(req), iid ? perNetwork : perDevice, windowSeconds)
  return n.ok ? null : fail(429, 'rate_limited', 'Too many requests — please slow down.')
}

/** The signed-in account behind this request, re-checked against the database. */
export async function accountOf(req: NextRequest): Promise<Account | null> {
  const claims = await readSession(req.cookies.get(COOKIE.session)?.value)
  if (!claims) return null
  const a = await getAccount(sql(), claims.a)
  return a && !a.disabled && a.session_version === claims.v ? a : null
}

async function requireRole(req: NextRequest, allowed: (r: Role) => boolean): Promise<{ actor: string; account: Account | null } | NextResponse> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (bearer && process.env.ADMIN_TOKEN && bearer === process.env.ADMIN_TOKEN) return { actor: 'admin:api', account: null }
  const a = await accountOf(req)
  if (!a) return fail(401, 'unauthorized', 'Sign in required.')
  if (!allowed(a.role)) return fail(403, 'forbidden', 'Your account does not have access.')
  return { actor: `${a.role}:${a.email}`, account: a }
}

/** The staff member behind this request (signed-in operator/admin, or the scripted ADMIN_TOKEN): their reports are staff, not resident, signals. */
export async function isStaffRequest(req: NextRequest): Promise<{ actor: string } | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (bearer && process.env.ADMIN_TOKEN && bearer === process.env.ADMIN_TOKEN) return { actor: 'admin:api' }
  const a = await accountOf(req)
  return a && canUseCopilot(a.role) ? { actor: `${a.role}:${a.email}` } : null
}

/** Editor console: admin accounts only. */
export const requireAdmin = (req: NextRequest) => requireRole(req, canAdmin)
/** 109 Copilot: operators and admins. */
export const requireOperator = (req: NextRequest) => requireRole(req, canUseCopilot)

export function requireCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

/** Wraps a handler: validation errors → 400, everything else → 500 with a logged id. */
export function handle<A extends unknown[]>(name: string, fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args)
    } catch (err) {
      if (err instanceof ZodError) return fail(400, 'invalid_request', 'Request validation failed.', { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
      if ((err as Error)?.name === 'AccountError') return fail(400, (err as Error & { code: string }).code, (err as Error).message)
      if ((err as Error)?.name === 'PublishError' || (err as Error)?.constructor?.name === 'PublishError') return fail(422, 'cannot_publish', (err as Error).message)
      if ((err as Error)?.name === 'IncidentError') {
        const code = (err as Error & { code: string }).code
        return fail(code === 'not_found' ? 404 : code === 'not_eligible' ? 403 : 409, code, (err as Error).message)
      }
      const id = Math.random().toString(36).slice(2, 10)
      log('error', 'api.error', { route: name, id, err: err as Error })
      return fail(500, 'internal_error', `Something went wrong (ref ${id}).`)
    }
  }
}
