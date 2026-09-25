import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adminUpdateEvent, loadEventDetail } from '@aktau/server'
import { EVENT_STATUSES } from '@aktau/types'
import { handle, json, requireAdmin, sql } from '@/lib/api'

const Patch = z.object({
  status: z.enum(EVENT_STATUSES).optional(),
  expected_ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  message: z.string().max(300).nullable().optional(),
})

// Manual lifecycle change: always recorded in city_event_updates + audit_log.
export const PATCH = handle('admin-event-update', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const { id } = await ctx.params
  await adminUpdateEvent(sql(), id, Patch.parse(await req.json()), admin.actor)
  return json(await loadEventDetail(sql(), id, null))
})
