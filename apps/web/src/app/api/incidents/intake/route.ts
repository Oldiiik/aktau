import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { previewSignal } from '@aktau/server'
import { handle, json, limited, sql } from '@/lib/api'

// Copilot preview of a resident message: what we understood, where, and whether
// 109 already knows about it. Nothing is written.
const Body = z.object({ text: z.string().trim().min(3).max(2000), lat: z.number().min(43).max(44.5).nullish(), lon: z.number().min(50).max(52).nullish(), session_id: z.string().uuid().nullish() })

export const POST = handle('incident-intake', async (req: NextRequest) => {
  const rl = await limited(req, 'intake', 60, 600)
  if (rl) return rl
  const b = Body.parse(await req.json())
  return json(await previewSignal(sql(), b.text, { lat: b.lat, lon: b.lon, sessionId: b.session_id ?? null }))
})
