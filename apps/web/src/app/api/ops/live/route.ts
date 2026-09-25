import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSession, listSessions } from '@aktau/server'
import { handle, json, requireOperator, sql } from '@/lib/api'

// Live demo sessions (staff): create one, list them.
const Body = z.object({
  title: z.string().trim().min(2).max(120).default('Smart City Aktau Demo'),
  venue: z.string().trim().min(2).max(120).default('Mangystau Hub'),
  lat: z.number().min(43).max(44.5).nullish(),
  lon: z.number().min(50).max(52).nullish(),
})

export const GET = handle('ops-live-list', async (req: NextRequest) => {
  const staff = await requireOperator(req)
  if (staff instanceof Response) return staff
  return json({ sessions: await listSessions(sql()) })
})

export const POST = handle('ops-live-create', async (req: NextRequest) => {
  const staff = await requireOperator(req)
  if (staff instanceof Response) return staff
  const b = Body.parse(await req.json().catch(() => ({})))
  const s = await createSession(sql(), { ...b, actor: staff.actor })
  return json({ id: s.id, code: s.code })
})
