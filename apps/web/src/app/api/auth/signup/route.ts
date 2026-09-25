import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createAccount } from '@aktau/server'
import { fail, handle, limited, sql } from '@/lib/api'
import { sessionsEnabled } from '@/lib/auth'
import { COOKIE } from '@/lib/session'
import { startSession } from '@/lib/sign-in'

const Body = z.object({ email: z.string().max(254), password: z.string().max(200), name: z.string().max(80).optional() })

// Public sign-up always creates a resident. Staff roles are granted by an admin.
export const POST = handle('auth-signup', async (req: NextRequest) => {
  const tooMany = await limited(req, 'auth-signup', 5, 3600)
  if (tooMany) return tooMany
  if (!sessionsEnabled()) return fail(503, 'not_configured', 'Accounts are not configured on this server (SESSION_SECRET).')
  const b = Body.parse(await req.json())
  const a = await createAccount(sql(), { email: b.email, password: b.password, display_name: b.name, role: 'resident', installation_id: req.cookies.get(COOKIE.iid)?.value ?? null })
  return startSession(req, a)
})
