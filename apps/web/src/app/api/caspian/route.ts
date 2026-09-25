import type { NextRequest } from 'next/server'
import { caspianState } from '@aktau/server'
import { handle, json, langOf, sql } from '@/lib/api'

// Where swimming is officially permitted / prohibited on the Aktau coast, each
// with its source document, plus modelled sea conditions shown as facts.
export const GET = handle('caspian', async (req: NextRequest) => json(await caspianState(sql(), langOf(req)), { cache: 'public, max-age=60' }))
