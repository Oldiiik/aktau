import type { NextRequest } from 'next/server'
import { publishCandidate } from '@aktau/server'
import { ExtractionSchema } from '@aktau/types'
import { handle, json, requireAdmin, sql } from '@/lib/api'

// Contract alias: POST /api/admin/events/:id/approve where :id is the extraction
// candidate awaiting review. Body may carry edits to the extracted fields.
export const POST = handle('admin-approve', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { edits?: unknown }
  const edits = body.edits ? ExtractionSchema.partial().parse(body.edits) : undefined
  return json(await publishCandidate(sql(), id, { actor: admin.actor, edits }))
})
