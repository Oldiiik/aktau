import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { setZoneStatus } from '@aktau/server'
import { fail, handle, json, requireAdmin, sql } from '@/lib/api'

const Patch = z.object({
  status: z.enum(['UNKNOWN', 'OPEN', 'RESTRICTED', 'CLOSED']),
  note: z.string().max(300).nullable().optional(),
  // Which authority published this status (ДЧС, акимат…). Required: we never set it on our own judgement.
  source: z.string().min(3).max(200),
  rescue_post: z.boolean().nullable().optional(),
})

// Temporary beach status from an authority. Legal status (official / prohibited)
// is not editable here: it changes only with the source document.
export const PATCH = handle('admin-caspian-status', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) return fail(400, 'invalid_request', 'Bad zone id.')
  const r = await setZoneStatus(sql(), id, Patch.parse(await req.json()), admin.actor, admin.account?.id ?? null)
  return r ? json(r) : fail(404, 'not_found', 'No such zone.')
})
