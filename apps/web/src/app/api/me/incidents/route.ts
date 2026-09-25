import type { NextRequest } from 'next/server'
import { lite, myIncidentMessages, myIncidents } from '@aktau/server'
import { handle, installationOf, json, sql } from '@/lib/api'

export const GET = handle('me-incidents', async (req: NextRequest) => {
  const iid = installationOf(req)
  if (!iid) return json({ incidents: [], messages: [] })
  const [incidents, messages] = await Promise.all([myIncidents(sql(), iid), myIncidentMessages(sql(), iid)])
  return json({ incidents: incidents.map(lite), messages })
})
