import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { SCOPE_KINDS } from '@aktau/city-core'
import { incidentAction, incidentDetail } from '@aktau/server'
import { fail, handle, json, requireOperator, sql } from '@/lib/api'

export const GET = handle('ops-incident', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireOperator(req)
  if (staff instanceof Response) return staff
  const d = await incidentDetail(sql(), (await ctx.params).id, { includeSignalText: true })
  return d ? json(d) : fail(404, 'not_found', 'Incident not found')
})

const Photo = z.object({ kind: z.enum(['before', 'after']), lat: z.number().nullable(), lon: z.number().nullable(), captured_at: z.string(), hash: z.string().regex(/^[0-9a-f]{16}$/), brightness: z.number().min(0).max(1), image: z.string().max(400_000).optional() })
const Iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')
const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('route'), org: z.string().max(120).optional(), team: z.string().max(120).nullish() }),
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('commit'), finish_at: Iso, start_at: Iso.nullish(), reason: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal('reject'), reason: z.string().min(2).max(300) }),
  z.object({ action: z.literal('dispatch'), message: z.string().max(500).optional() }),
  z.object({ action: z.literal('update'), message: z.string().min(2).max(500) }),
  z.object({ action: z.literal('evidence'), photos: z.array(Photo).min(1).max(4) }),
  z.object({ action: z.literal('complete'), note: z.string().max(2000), photos: z.array(Photo).max(4).optional(), cause: z.string().trim().max(300).nullish(), completed_at: Iso.nullish() }),
  z.object({ action: z.literal('respond'), text: z.string().min(1).max(2000) }),
  z.object({ action: z.literal('resolve'), force: z.boolean().optional(), reason: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal('close_rejected'), reason: z.string().min(2).max(300) }),
  z.object({ action: z.literal('request_evidence'), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal('escalate'), reason: z.string().trim().min(2).max(300) }),
  z.object({ action: z.literal('reopen'), reason: z.string().trim().min(2).max(300) }),
  z.object({ action: z.literal('merge'), into: z.string().min(5).max(40) }),
  z.object({ action: z.literal('scope'), scope: z.object({
    kind: z.enum(SCOPE_KINDS), radius_m: z.number().int().min(10).max(20000).nullish(), building_ids: z.array(z.string().uuid()).max(300).optional(),
    area_ids: z.array(z.string().uuid()).max(80).optional(), houses: z.array(z.string().trim().min(1).max(12)).max(300).optional(), designators: z.array(z.string().trim().min(1).max(8)).max(80).optional(),
  }) }),
  z.object({ action: z.literal('title'), title: z.string().trim().max(120) }),
])

// Every operator / team step; the signed-in staff member is recorded (steps
// taken for the responsible team appear as the team's, with who entered them).
export const POST = handle('ops-incident-action', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireOperator(req)
  if (staff instanceof Response) return staff
  const a = Action.parse(await req.json())
  return json(await incidentAction(sql(), (await ctx.params).id, a, staff.actor))
})
