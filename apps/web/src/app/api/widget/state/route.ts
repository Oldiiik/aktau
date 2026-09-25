import type { NextRequest } from 'next/server'
import { getWidgetState } from '@aktau/server'
import { handle, installationOf, json, langOf, sql } from '@/lib/api'

// Minimal precomputed payload for WidgetKit. The widget never recomputes relevance.
export const GET = handle('widget-state', async (req: NextRequest) => {
  const p = req.nextUrl.searchParams
  return json(await getWidgetState(sql(), { installation_id: p.get('installation') ?? installationOf(req), saved_location_id: p.get('saved_location') }, langOf(req)))
})
