import type { NextRequest } from 'next/server'
import { searchLocal } from '@aktau/server'
import { handle, json, langOf, sql } from '@/lib/api'

// Typing "14" is answered from our own district/building index — never an external geocoder.
export const GET = handle('areas-search', async (req: NextRequest) =>
  json({ results: await searchLocal(sql(), (req.nextUrl.searchParams.get('q') ?? '').slice(0, 60), langOf(req), 10) }))
