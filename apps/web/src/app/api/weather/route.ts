import type { NextRequest } from 'next/server'
import { getWeatherSnippet } from '@aktau/server'
import { handle, json, langOf, sql } from '@/lib/api'

// Forecast (Open-Meteo, model) and observation (Kazhydromet, official) are
// returned side by side, each with its provider and timestamp.
export const GET = handle('weather', async (req: NextRequest) => json(await getWeatherSnippet(sql(), new Date(), langOf(req)), { cache: 'public, max-age=60' }))
