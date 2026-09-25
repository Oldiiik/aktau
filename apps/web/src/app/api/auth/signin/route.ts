import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticate } from '@aktau/server'
import { fail, handle, limited, sql } from '@/lib/api'
import { sessionsEnabled } from '@/lib/auth'
import { startSession } from '@/lib/sign-in'

const Body = z.object({ email: z.string().max(254), password: z.string().max(200) })

export const POST = handle('auth-signin', async (req: NextRequest) => {
  const tooMany = await limited(req, 'auth-signin', 10, 600)
  if (tooMany) return tooMany
  if (!sessionsEnabled()) return fail(503, 'not_configured', 'Accounts are not configured on this server (SESSION_SECRET).')
  const b = Body.parse(await req.json())
  return startSession(req, await authenticate(sql(), b.email, b.password))
})
