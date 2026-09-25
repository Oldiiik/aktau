import type { NextRequest } from 'next/server'
import { getAktauNow } from '@aktau/server'
import { handle, json, langOf, locationOf, sql } from '@/lib/api'

// One aggregated call for Home: location, Aktau Now, priority event, services, weather, today.
export const GET = handle('now', async (req: NextRequest) => json(await getAktauNow(sql(), locationOf(req), langOf(req))))
