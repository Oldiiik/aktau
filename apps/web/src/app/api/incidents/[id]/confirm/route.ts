import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { confirmIncident } from '@aktau/server'
import { accountOf, fail, handle, installationOf, json, limitedPerDevice, sql } from '@/lib/api'

// "Yes, I also experience this" (or "No, not me"). One record per person:
// who, when, where they stood, an optional note or photo. Not a like.
const Photo = z.object({ media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(100).max(1_600_000).regex(/^[A-Za-z0-9+/=]+$/) })
const Body = z.object({
  state: z.enum(['confirmed', 'not_affected', 'withdrawn']).default('confirmed'),
  note: z.string().trim().max(1000).nullish(),
  photo: Photo.nullish(),
  lat: z.number().min(43).max(44.5).nullish(),
  lon: z.number().min(50).max(52).nullish(),
})

export const POST = handle('incident-confirm', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const rl = await limitedPerDevice(req, 'confirm', 40, 2000, 600)
  if (rl) return rl
  const iid = installationOf(req)
  if (!iid) return fail(400, 'no_installation', 'Open the app once before confirming.')
  const b = Body.parse(await req.json())
  const account = await accountOf(req)
  return json(await confirmIncident(sql(), (await ctx.params).id, { installation_id: iid, account_id: account?.id ?? null, state: b.state, note: b.note, photo: b.photo ?? null, lat: b.lat, lon: b.lon }))
})
