import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { publishCandidate, rejectCandidate } from '@aktau/server'
import { ExtractionSchema } from '@aktau/types'
import { handle, json, requireAdmin, sql } from '@/lib/api'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), edits: ExtractionSchema.partial().optional(), merge_into: z.string().uuid().nullable().optional(), force_new: z.boolean().optional() }),
  z.object({ action: z.literal('reject'), note: z.string().max(500).nullable().optional() }),
])

export const POST = handle('admin-candidate', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const { id } = await ctx.params
  const body = Body.parse(await req.json())
  if (body.action === 'reject') {
    await rejectCandidate(sql(), id, admin.actor, body.note ?? null)
    return json({ ok: true, status: 'REJECTED' })
  }
  return json(await publishCandidate(sql(), id, { actor: admin.actor, edits: body.edits, mergeInto: body.merge_into, forceNew: body.force_new }))
})
