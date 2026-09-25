import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyIncident } from '@aktau/server'
import { fail, handle, installationOf, json, limitedPerDevice, sql } from '@/lib/api'

// Resident verification after the team reports completion: yes / partially /
// no, optional ratings, comment and photo. Only people who reported or
// confirmed the problem can answer; the aggregate closes or reopens it.
const Photo = z.object({ media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(100).max(1_600_000).regex(/^[A-Za-z0-9+/=]+$/) })
const Body = z.union([
  z.object({
    answer: z.enum(['yes', 'partial', 'no']),
    quality: z.number().int().min(1).max(5).nullish(),
    speed: z.number().int().min(1).max(5).nullish(),
    comment: z.string().trim().max(1000).nullish(),
    photo: Photo.nullish(),
  }),
  // Older clients: { fixed: boolean }.
  z.object({ fixed: z.boolean() }).transform((b) => ({ answer: b.fixed ? 'yes' as const : 'no' as const })),
])

export const POST = handle('incident-verify', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const rl = await limitedPerDevice(req, 'verify', 30, 2000, 600)
  if (rl) return rl
  const iid = installationOf(req)
  if (!iid) return fail(400, 'no_installation', 'Open the app once before answering.')
  const b = Body.parse(await req.json())
  return json(await verifyIncident(sql(), (await ctx.params).id, iid, { quality: null, speed: null, comment: null, photo: null, ...b }))
})
