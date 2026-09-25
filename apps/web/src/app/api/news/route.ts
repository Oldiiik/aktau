import type { NextRequest } from 'next/server'
import { listNews, newsFront } from '@aktau/server'
import { handle, json, langOf, sql } from '@/lib/api'

// GET /api/news            → the front page (stories, official word, 109 fixes, weather)
// GET /api/news?before=ISO → older stories (pagination)
export const GET = handle('news', async (req: NextRequest) => {
  const p = req.nextUrl.searchParams
  const before = p.get('before')
  if (before && !Number.isNaN(Date.parse(before))) return json({ articles: await listNews(sql(), { before, section: p.get('section'), scope: (['aktau', 'kazakhstan', 'world'] as const).find((x) => x === p.get('scope')) ?? null, limit: 30 }) }, { cache: 'public, max-age=60' })
  return json(await newsFront(sql(), langOf(req)))
})
