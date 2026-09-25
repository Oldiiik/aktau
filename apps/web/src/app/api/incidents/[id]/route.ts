import type { NextRequest } from 'next/server'
import { incidentDetail } from '@aktau/server'
import { fail, handle, installationOf, json, sql } from '@/lib/api'

// Public incident view. Raw signal text is never public (it can hold names and numbers).
export const GET = handle('incident', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  if (!/^([0-9a-f-]{36}|INC-\d+)$/i.test(id)) return fail(404, 'not_found', 'Incident not found')
  const d = await incidentDetail(sql(), id, { installation_id: installationOf(req) })
  return d ? json(d) : fail(404, 'not_found', 'Incident not found')
})
