import type { NextRequest } from 'next/server'
import { listAccounts } from '@aktau/server'
import { handle, json, requireAdmin, sql } from '@/lib/api'

export const GET = handle('admin-users', async (req: NextRequest) => {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  return json({ accounts: (await listAccounts(sql())).map(({ installation_id, session_version, ...a }) => a) })
})
