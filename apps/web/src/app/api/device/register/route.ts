import type { NextRequest } from 'next/server'
import { registerDevice } from '@aktau/server'
import { DeviceRegisterSchema } from '@aktau/types'
import { handle, json, limited, sql } from '@/lib/api'

export const POST = handle('device-register', async (req: NextRequest) => {
  const tooMany = await limited(req, 'device', 20, 3600)
  if (tooMany) return tooMany
  const body = DeviceRegisterSchema.parse(await req.json())
  await registerDevice(sql(), body)
  return json({ ok: true }) // never echo push tokens
})
