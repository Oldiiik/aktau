import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { clearDemo, injectDemo } from '@aktau/server'
import { fail, handle, json, requireAdmin, sql } from '@/lib/api'

// DEMO_MODE only. Demo items flow through the real pipeline with is_demo = true.
export const POST = handle('admin-demo', async (req: NextRequest) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  if (process.env.DEMO_MODE !== 'true') return fail(403, 'demo_disabled', 'DEMO_MODE is off')
  const body = z.object({ scenario: z.enum(['aues_power', 'water_no_eta', 'road']).default('aues_power'), auto_approve: z.boolean().default(false) }).parse(await req.json().catch(() => ({})))
  return json(await injectDemo(sql(), admin.actor, { scenario: body.scenario, autoApprove: body.auto_approve }))
})

export const DELETE = handle('admin-demo-clear', async (req: NextRequest) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  return json({ removed: await clearDemo(sql(), admin.actor) })
})
