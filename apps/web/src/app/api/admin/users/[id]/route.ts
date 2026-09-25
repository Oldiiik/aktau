import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { updateAccount } from '@aktau/server'
import { handle, json, requireAdmin, sql } from '@/lib/api'

const Patch = z.object({ role: z.enum(['resident', 'operator', 'admin']).optional(), disabled: z.boolean().optional() })

export const PATCH = handle('admin-user-update', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const { installation_id, session_version, ...a } = await updateAccount(sql(), (await ctx.params).id, Patch.parse(await req.json()), admin.actor)
  return json({ account: a })
})
