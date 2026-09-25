import type { NextRequest } from 'next/server'
import { askAktau } from '@aktau/server'
import { AskRequestSchema } from '@aktau/types'
import { handle, installationOf, json, limited, sql } from '@/lib/api'

export const POST = handle('ask', async (req: NextRequest) => {
  const tooMany = await limited(req, 'ask', 20, 60)
  if (tooMany) return tooMany
  const body = AskRequestSchema.parse(await req.json())
  const answer = await askAktau(sql(), {
    question: body.question,
    lang: body.lang,
    location: { saved_location_id: body.saved_location_id, lat: body.lat, lon: body.lon, installation_id: installationOf(req) },
  })
  return json(answer)
})
