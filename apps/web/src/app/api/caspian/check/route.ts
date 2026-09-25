import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { canISwimHere } from '@aktau/server'
import { handle, json, langOf, limited, sql } from '@/lib/api'

const Q = z.object({ lat: z.coerce.number().min(42.9).max(44.1), lon: z.coerce.number().min(50.6).max(51.8) })

// "Can I swim here?" — the position is used for this answer only and not stored.
export const GET = handle('caspian-check', async (req: NextRequest) => {
  const tooMany = await limited(req, 'caspian-check', 60, 60)
  if (tooMany) return tooMany
  const { lat, lon } = Q.parse(Object.fromEntries(req.nextUrl.searchParams))
  return json(await canISwimHere(sql(), lat, lon, langOf(req)))
})
