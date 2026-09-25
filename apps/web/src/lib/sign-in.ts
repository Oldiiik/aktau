// Shared by sign-in and sign-up: set the session cookie and bring the
// account's installation (saved places, alerts, inbox) to this device.
import { NextResponse, type NextRequest } from 'next/server'
import { adoptInstallation, type Account } from '@aktau/server'
import { COOKIE } from './session.ts'
import { SESSION_MAX_AGE, signSession } from './auth.ts'
import { sql } from './api.ts'

export async function startSession(req: NextRequest, a: Account) {
  const iid = await adoptInstallation(sql(), a.id, req.cookies.get(COOKIE.iid)?.value ?? null)
  const res = NextResponse.json({ account: { id: a.id, email: a.email, name: a.display_name, role: a.role } }, { headers: { 'cache-control': 'no-store' } })
  const secure = req.nextUrl.protocol === 'https:'
  res.cookies.set(COOKIE.session, await signSession({ a: a.id, r: a.role, v: a.session_version }), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE, secure })
  if (iid) res.cookies.set(COOKIE.iid, iid, { path: '/', maxAge: 60 * 60 * 24 * 400, sameSite: 'lax', httpOnly: false, secure })
  return res
}
