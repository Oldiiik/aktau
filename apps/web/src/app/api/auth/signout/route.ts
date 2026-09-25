import { NextResponse, type NextRequest } from 'next/server'
import { signOutEverywhere } from '@aktau/server'
import { accountOf, handle, sql } from '@/lib/api'
import { COOKIE } from '@/lib/session'

// ?everywhere=1 also ends the account's sessions on every other device.
export const POST = handle('auth-signout', async (req: NextRequest) => {
  if (req.nextUrl.searchParams.get('everywhere') === '1') {
    const a = await accountOf(req)
    if (a) await signOutEverywhere(sql(), a.id)
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(COOKIE.session)
  // Leave this device on a fresh anonymous id so the account's places don't linger.
  res.cookies.set(COOKIE.iid, crypto.randomUUID(), { path: '/', maxAge: 60 * 60 * 24 * 400, sameSite: 'lax', httpOnly: false, secure: req.nextUrl.protocol === 'https:' })
  return res
})
