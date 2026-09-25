import { NextResponse, type NextRequest } from 'next/server'
import { canAdmin, canUseCopilot, readSession, SESSION_COOKIE } from './lib/auth.ts'

// 1) Give every browser an anonymous installation id (personalisation without
//    an account). 2) Route by account role: the editor console is for admin
//    accounts, 109 Copilot for operators and admins. Handlers re-check the
//    account against the database; this is only the front door.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const api = pathname.startsWith('/api/')
  const adminOnly = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  // A live session's audience page (/live/:code) is public; its presenter screen is staff-only.
  const staff = pathname.startsWith('/copilot') || pathname.startsWith('/ops') || pathname.startsWith('/demo') || pathname.startsWith('/api/ops')
    || (pathname.startsWith('/live/') && pathname.endsWith('/present'))
  if (adminOnly || staff) {
    const bearer = api && !!process.env.ADMIN_TOKEN && req.headers.get('authorization') === `Bearer ${process.env.ADMIN_TOKEN}`
    const claims = await readSession(req.cookies.get(SESSION_COOKIE)?.value)
    const ok = bearer || (adminOnly ? canAdmin(claims?.r) : canUseCopilot(claims?.r))
    if (!ok) {
      if (api) return NextResponse.json({ error: { code: claims ? 'forbidden' : 'unauthorized', message: claims ? 'Your account does not have access.' : 'Sign in required.' } }, { status: claims ? 403 : 401 })
      const to = new URL('/signin', req.url)
      to.searchParams.set('next', pathname + req.nextUrl.search)
      if (claims) to.searchParams.set('need', adminOnly ? 'admin' : 'operator')
      return NextResponse.redirect(to)
    }
  }
  if (req.cookies.get('aktau_iid')) return NextResponse.next()
  // First visit: mint the id and make it visible to this very render too.
  const iid = crypto.randomUUID()
  const headers = new Headers(req.headers)
  headers.set('cookie', [req.headers.get('cookie'), `aktau_iid=${iid}`].filter(Boolean).join('; '))
  const res = NextResponse.next({ request: { headers } })
  res.cookies.set('aktau_iid', iid, { path: '/', maxAge: 60 * 60 * 24 * 400, sameSite: 'lax', httpOnly: false, secure: req.nextUrl.protocol === 'https:' })
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|icons/|images/|favicon|sw.js|manifest).*)'],
}
