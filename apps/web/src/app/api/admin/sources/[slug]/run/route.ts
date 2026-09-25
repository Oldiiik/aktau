import type { NextRequest } from 'next/server'
import { audit, runSource } from '@aktau/server'
import { handle, json, requireAdmin, sql } from '@/lib/api'

export const POST = handle('admin-source-run', async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const { slug } = await ctx.params
  const r = await runSource(sql(), slug)
  await audit(sql(), admin.actor, 'source.run', 'source', slug, null, r)
  return json(r)
})
