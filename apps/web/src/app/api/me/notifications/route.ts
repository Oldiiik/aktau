import type { NextRequest } from 'next/server'
import { inbox } from '@aktau/server'
import { handle, installationOf, json, sql } from '@/lib/api'

export const GET = handle('me-inbox', async (req: NextRequest) => {
  const iid = installationOf(req)
  return json({ notifications: iid ? await inbox(sql(), iid) : [] })
})
