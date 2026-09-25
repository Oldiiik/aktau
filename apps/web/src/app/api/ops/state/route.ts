import type { NextRequest } from 'next/server'
import { listIncidents, opsStats, pendingSignals } from '@aktau/server'
import { handle, json, requireOperator, sql } from '@/lib/api'

export const GET = handle('ops-state', async (req: NextRequest) => {
  const admin = await requireOperator(req)
  if (admin instanceof Response) return admin
  const db = sql()
  const [stats, incidents, pending] = await Promise.all([opsStats(db), listIncidents(db, { open: true }), pendingSignals(db)])
  return json({ stats, incidents, pending })
})
