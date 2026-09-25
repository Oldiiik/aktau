import type { NextRequest } from 'next/server'
import { mapEventsGeoJSON, resolveLocation } from '@aktau/server'
import { handle, json, langOf, locationOf, sql } from '@/lib/api'

export const GET = handle('map-events', async (req: NextRequest) => {
  const db = sql()
  const lang = langOf(req)
  const loc = await resolveLocation(db, locationOf(req), lang)
  const cats = req.nextUrl.searchParams.get('category')?.split(',').filter(Boolean)
  return json(await mapEventsGeoJSON(db, lang, loc, cats))
})
