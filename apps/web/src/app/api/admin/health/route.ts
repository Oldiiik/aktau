import type { NextRequest } from 'next/server'
import { sourceHealth } from '@aktau/server'
import { handle, json, requireAdmin, sql } from '@/lib/api'

export const GET = handle('admin-health', async (req: NextRequest) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  return json({ sources: await sourceHealth(sql()) })
})
