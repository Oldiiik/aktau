import type { NextRequest } from 'next/server'
import { handle, json, requireAdmin, sql } from '@/lib/api'

export const GET = handle('admin-audit', async (req: NextRequest) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const rows = await sql()`select id, actor, action, entity_type, entity_id, before, after, created_at from audit_log order by id desc limit 200`
  return json({ entries: rows })
})
