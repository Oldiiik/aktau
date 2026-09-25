import { areasGeoJSON } from '@aktau/server'
import { handle, json, sql } from '@/lib/api'

export const GET = handle('map-areas', async () => json(await areasGeoJSON(sql()), { cache: 'public, max-age=3600' }))
