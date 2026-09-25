import type { NextRequest } from 'next/server'
import { geocodeFallback, searchLocal, searchPlaces } from '@aktau/server'
import { handle, json, langOf, limited, sql } from '@/lib/api'

// Order: local districts/buildings → cached places → 2GIS (if configured) → Nominatim (cached).
export const GET = handle('places-search', async (req: NextRequest) => {
  const tooMany = await limited(req, 'search', 60, 60)
  if (tooMany) return tooMany
  const p = req.nextUrl.searchParams
  const q = (p.get('q') ?? '').slice(0, 80)
  const lat = Number(p.get('lat')), lon = Number(p.get('lon'))
  const near = Number.isFinite(lat) && Number.isFinite(lon) && p.get('lat') ? { lat, lon } : null
  const db = sql()
  const local = await searchLocal(db, q, langOf(req), 6)
  const places = q.length >= 2 || p.get('category') ? await searchPlaces(db, q, near, { category: p.get('category'), limit: 10 }) : []
  const geocode = local.length + places.length === 0 && p.get('geocode') === '1' ? await geocodeFallback(db, q) : []
  return json({ results: [...local, ...places, ...geocode] })
})
