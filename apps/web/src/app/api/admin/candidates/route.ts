import type { NextRequest } from 'next/server'
import { candidateQueue } from '@aktau/server'
import { handle, json, requireAdmin, sql } from '@/lib/api'

export const GET = handle('admin-candidates', async (req: NextRequest) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  return json({ candidates: await candidateQueue(sql(), req.nextUrl.searchParams.get('status') ?? 'REVIEW_REQUIRED', 100) })
})
