import type { NextRequest } from 'next/server'
import { loadEventDetail, resolveLocation } from '@aktau/server'
import { fail, handle, json, langOf, locationOf, sql } from '@/lib/api'

export const GET = handle('event', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, 'not_found', 'Event not found')
  const db = sql()
  const loc = await resolveLocation(db, locationOf(req), langOf(req))
  const e = await loadEventDetail(db, id, loc)
  return e ? json(e) : fail(404, 'not_found', 'Event not found')
})
