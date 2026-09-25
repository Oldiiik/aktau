import type { NextRequest } from 'next/server'
import { deleteLocation, listLocations, saveLocation } from '@aktau/server'
import { SavedLocationInputSchema } from '@aktau/types'
import { fail, handle, installationOf, json, langOf, limited, sql } from '@/lib/api'

export const GET = handle('me-locations', async (req: NextRequest) => {
  const iid = installationOf(req)
  return json({ locations: iid ? await listLocations(sql(), iid) : [] })
})

export const POST = handle('me-locations-save', async (req: NextRequest) => {
  const iid = installationOf(req)
  if (!iid) return fail(400, 'no_installation', 'Missing installation id')
  const tooMany = await limited(req, 'write', 30, 60)
  if (tooMany) return tooMany
  const body = SavedLocationInputSchema.parse(await req.json())
  if (!body.area_id && !body.building_id && (body.lat == null || body.lon == null)) return fail(400, 'invalid_request', 'A place needs a district, building or point')
  const id = await saveLocation(sql(), iid, body, langOf(req))
  return json({ id })
})

export const DELETE = handle('me-locations-delete', async (req: NextRequest) => {
  const iid = installationOf(req)
  const id = req.nextUrl.searchParams.get('id')
  if (!iid || !id) return fail(400, 'invalid_request', 'Missing id')
  await deleteLocation(sql(), iid, id)
  return json({ ok: true })
})
