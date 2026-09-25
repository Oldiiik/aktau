import { incidentsGeoJSON, lite } from '@aktau/server'
import { handle, json, sql } from '@/lib/api'

export const GET = handle('map-incidents', async () => {
  const g = await incidentsGeoJSON(sql())
  return json({ ...g, incidents: g.incidents.map(lite) })
})
