import type { NextRequest } from 'next/server'
import { getAktauNow } from '@aktau/server'
import { handle, json, langOf, locationOf, sql } from '@/lib/api'

export const GET = handle('services', async (req: NextRequest) => {
  const n = await getAktauNow(sql(), locationOf(req), langOf(req))
  return json({ location: n.location, services: n.services, generated_at: n.generated_at })
})
