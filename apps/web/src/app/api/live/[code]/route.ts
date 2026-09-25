import type { NextRequest } from 'next/server'
import { joinSession, sessionState } from '@aktau/server'
import { fail, handle, installationOf, json, langOf, limitedPerDevice, sql } from '@/lib/api'

// A live demo session, public: no account, no GPS. GET = canonical state for
// this screen; POST = join (scanning the QR code is the location).
export const GET = handle('live-state', async (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  const s = await sessionState(sql(), (await ctx.params).code, installationOf(req))
  return s ? json(s) : fail(404, 'not_found', 'Session not found')
})

export const POST = handle('live-join', async (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  const rl = await limitedPerDevice(req, 'live-join', 30, 3000, 600)
  if (rl) return rl
  const iid = installationOf(req)
  if (!iid) return fail(400, 'no_installation', 'Cookies are needed to join.')
  const r = await joinSession(sql(), (await ctx.params).code, iid, langOf(req))
  return r ? json({ joined: r.joined, status: r.session.status }) : fail(404, 'not_found', 'Session not found')
})
