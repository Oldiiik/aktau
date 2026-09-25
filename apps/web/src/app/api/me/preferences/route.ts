import type { NextRequest } from 'next/server'
import { DEFAULT_PREFS, getPreferences, setPreferences } from '@aktau/server'
import { AlertPreferencesSchema } from '@aktau/types'
import { fail, handle, installationOf, json, langOf, limited, sql } from '@/lib/api'

export const GET = handle('me-prefs', async (req: NextRequest) => {
  const iid = installationOf(req)
  return json(iid ? await getPreferences(sql(), iid) : DEFAULT_PREFS)
})

export const PUT = handle('me-prefs-save', async (req: NextRequest) => {
  const iid = installationOf(req)
  if (!iid) return fail(400, 'no_installation', 'Missing installation id')
  const tooMany = await limited(req, 'write', 30, 60)
  if (tooMany) return tooMany
  await setPreferences(sql(), iid, AlertPreferencesSchema.parse(await req.json()), langOf(req))
  return json({ ok: true })
})
