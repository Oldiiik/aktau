import type { NextRequest } from 'next/server'
import { deleteSession, endSession } from '@aktau/server'
import { fail, handle, json, requireOperator, sql } from '@/lib/api'

// End a session (it stays readable) or delete it with its demo incidents.
export const PATCH = handle('ops-live-end', async (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  const staff = await requireOperator(req)
  if (staff instanceof Response) return staff
  const r = await endSession(sql(), (await ctx.params).code, staff.actor)
  return r ? json(r) : fail(404, 'not_found', 'Session not found')
})

export const DELETE = handle('ops-live-delete', async (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  const staff = await requireOperator(req)
  if (staff instanceof Response) return staff
  const r = await deleteSession(sql(), (await ctx.params).code, staff.actor)
  return r ? json(r) : fail(404, 'not_found', 'Session not found')
})
