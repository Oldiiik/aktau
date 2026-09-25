import type { NextRequest } from 'next/server'
import { loadEvents, rankAroundMe, resolveLocation, searchPlaces } from '@/lib/server-bridge'
import { fail, handle, json, langOf, sql } from '@/lib/api'

export const GET = handle('around-me', async (req: NextRequest) => {
  const p = req.nextUrl.searchParams
  const lat = Number(p.get('lat')), lon = Number(p.get('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fail(400, 'invalid_request', 'lat and lon are required')
  const radius = Math.min(5000, Math.max(200, Number(p.get('radius') ?? 1500)))
  const db = sql()
  const loc = await resolveLocation(db, { lat, lon }, langOf(req))
  const events = (await loadEvents(db, { current: true }, loc)).filter((e) => e.relevance !== 'NO' || (e.distance_m ?? Infinity) <= radius)
  const places = (await searchPlaces(db, '', { lat, lon }, { limit: 12 })).filter((h) => h.kind === 'place' && (h.distance_m ?? 0) <= radius)
  return json({ radius_m: radius, location: loc.ctx, events: rankAroundMe(events, new Date()), places })
})
