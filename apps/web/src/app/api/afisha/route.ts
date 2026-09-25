import type { NextRequest } from 'next/server'
import { whatsOn } from '@aktau/server'
import { handle, json, limited, sql } from '@/lib/api'

// What's on in Aktau: cinema sessions (today, tomorrow) and shows from the
// city's listings, merged across sites, each linked to its publisher.
export const GET = handle('afisha', async (req: NextRequest) => {
  const rl = await limited(req, 'afisha', 120, 600)
  if (rl) return rl
  return json(await whatsOn(sql()), { cache: 'public, max-age=60' })
})
