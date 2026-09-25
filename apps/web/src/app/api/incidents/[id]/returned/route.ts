import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { reportReturned } from '@aktau/server'
import { fail, handle, installationOf, isStaffRequest, json, limitedPerDevice, sql } from '@/lib/api'

// "The problem came back": a new incident at the same place, linked to the
// earlier repair (who fixed it, when, how residents rated it).
const Photo = z.object({ media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(100).max(1_600_000).regex(/^[A-Za-z0-9+/=]+$/) })
const Body = z.object({ note: z.string().trim().max(1000).nullish(), photo: Photo.nullish() })

export const POST = handle('incident-returned', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const rl = await limitedPerDevice(req, 'signal', 12, 300, 600)
  if (rl) return rl
  const iid = installationOf(req)
  if (!iid) return fail(400, 'no_installation', 'Open the app once before reporting.')
  const b = Body.parse(await req.json().catch(() => ({})))
  const staff = await isStaffRequest(req)
  return json(await reportReturned(sql(), (await ctx.params).id, { installation_id: iid, note: b.note, photo: b.photo ?? null, origin: staff ? 'staff' : 'resident' }))
})
