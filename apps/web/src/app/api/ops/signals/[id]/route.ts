import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { decideSignal } from '@aktau/server'
import { fail, handle, json, requireOperator, sql } from '@/lib/api'

const Body = z.discriminatedUnion('action', [z.object({ action: z.literal('attach'), incident_id: z.string().uuid() }), z.object({ action: z.literal('create') })])

export const POST = handle('ops-signal-decide', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireOperator(req)
  if (admin instanceof Response) return admin
  try {
    return json(await decideSignal(sql(), (await ctx.params).id, Body.parse(await req.json()), 'operator'))
  } catch (e) {
    return fail(422, 'cannot_apply', (e as Error).message)
  }
})
