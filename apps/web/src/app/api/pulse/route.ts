import { cityPulse } from '@aktau/server'
import { handle, json, sql } from '@/lib/api'

export const GET = handle('pulse', async () => json(await cityPulse(sql()), { cache: 'public, max-age=15' }))
