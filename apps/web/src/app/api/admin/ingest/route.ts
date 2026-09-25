import type { NextRequest } from 'next/server'
import { candidateQueue, ingestManual } from '@aktau/server'
import { IngestRequestSchema } from '@aktau/types'
import { handle, json, limited, requireAdmin, sql } from '@/lib/api'

// Manual ingestion: Source + URL + pasted announcement → raw item → candidates (preview).
export const POST = handle('admin-ingest', async (req: NextRequest) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const tooMany = await limited(req, 'ingest', 60, 600)
  if (tooMany) return tooMany
  const body = IngestRequestSchema.parse(await req.json())
  const r = await ingestManual(sql(), { ...body, is_demo: process.env.DEMO_MODE === 'true' && body.is_demo === true, actor: admin.actor })
  const all = await candidateQueue(sql(), 'ALL', 200)
  return json({ ...r, candidates: all.filter((c) => r.candidate_ids.includes(c.id as string)) })
})
