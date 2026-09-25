import type { NextRequest } from 'next/server'
import { nearbyFor } from '@aktau/server'
import { handle, installationOf, json, langOf, sql } from '@/lib/api'

// Incidents that concern this person: in the scope of their saved home, close
// to it, in a live session they joined, or ones they reported / confirmed.
// The server decides who is affected; realtime only says "ask again".
export const GET = handle('me-nearby', async (req: NextRequest) => {
  return json(await nearbyFor(sql(), installationOf(req), { lang: langOf(req) }))
})
