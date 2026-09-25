import { cityPulse, lite, listIncidents } from '@aktau/server'
import { handle, json, sql } from '@/lib/api'

export const GET = handle('incidents', async () => {
  const db = sql()
  const [incidents, pulse] = await Promise.all([listIncidents(db, { open: true, city: true }), cityPulse(db)])
  return json({ incidents: incidents.map(lite), pulse })
})
