import type { NextRequest } from 'next/server'
import { clearIncidentDemo, seedIncidentDemo } from '@aktau/server'
import { fail, handle, json, requireOperator, sql } from '@/lib/api'

// DEMO_MODE only: a labelled 109 scenario (is_demo = true) through the real engine.
export const POST = handle('ops-demo', async (req: NextRequest) => {
  const admin = await requireOperator(req)
  if (admin instanceof Response) return admin
  if (process.env.DEMO_MODE !== 'true') return fail(403, 'demo_disabled', 'DEMO_MODE is off')
  return json(await seedIncidentDemo(sql(), admin.actor))
})

export const DELETE = handle('ops-demo-clear', async (req: NextRequest) => {
  const admin = await requireOperator(req)
  if (admin instanceof Response) return admin
  return json({ removed: await clearIncidentDemo(sql()) })
})
