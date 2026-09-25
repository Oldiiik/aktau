import type { NextRequest } from 'next/server'
import { loadEvents, resolveLocation } from '@aktau/server'
import { handle, json, langOf, locationOf, sql } from '@/lib/api'

export const GET = handle('events', async (req: NextRequest) => {
  const p = req.nextUrl.searchParams
  const db = sql()
  const loc = await resolveLocation(db, locationOf(req), langOf(req))
  const categories = p.get('category')?.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
  const current = p.get('status') !== 'all'
  const events = await loadEvents(db, { current, categories, areaIds: p.get('area') ? [p.get('area')!] : undefined, limit: 200 }, loc)
  return json({ events, location: loc.ctx })
})
