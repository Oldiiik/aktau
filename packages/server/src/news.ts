// News page: "Aktau Today". Three honest strands, never blended into one voice:
//   stories   local media (headline + publisher's summary, linked out)
//   official  city events that passed review (Aktau's own verified pipeline)
//   fixed     109 incidents closed this week (and whether residents confirmed)
// plus the weather and the city's pulse for the masthead.
import type { Lang } from '@aktau/types'
import type { Sql } from './db/client.ts'
import { loadEvents } from './events.ts'
import { cityPulse } from './incidents.ts'
import { getWeatherSnippet } from './now.ts'

export type NewsArticleDTO = {
  id: string; url: string; headline: string; lede: string | null; author: string | null; image_url: string | null
  image_width: number | null; image_height: number | null; section: string; language: string | null
  published_at: string; publisher: string; is_demo: boolean
}

export type FixedDTO = {
  id: string; code: string; service: string; title: string; designator: string | null; house: string | null
  status: 'RESOLVED' | 'VERIFIED'; resolved_at: string; signal_count: number; verify_yes: number; minutes_to_fix: number | null; is_demo: boolean
  /** Proof of resolution: the executor's "after" photo when there is one, else "before". */
  photo: string | null
}

export type NewsScope = 'aktau' | 'kazakhstan' | 'world'

export async function listNews(sql: Sql, o: { section?: string | null; scope?: NewsScope | null; limit?: number; before?: string | null } = {}): Promise<NewsArticleDTO[]> {
  const rows = await sql<(Omit<NewsArticleDTO, 'published_at'> & { published_at: Date })[]>`
    select n.id, n.url, n.headline, n.lede, n.author, n.image_url, n.image_width, n.image_height, n.section, n.language, n.published_at,
      split_part(s.name, ' · ', 1) publisher, n.is_demo
    from news_articles n join sources s on s.id = n.source_id
    where true
      ${o.section ? sql`and n.section = ${o.section}` : sql``}
      ${o.scope === 'aktau' ? sql`and n.section not in ('kazakhstan', 'world')` : o.scope ? sql`and n.section = ${o.scope}` : sql``}
      ${o.before ? sql`and n.published_at < ${new Date(o.before)}` : sql``}
    order by n.published_at desc
    limit ${Math.min(o.limit ?? 60, 120)}`
  return rows.map((r) => ({ ...r, published_at: new Date(r.published_at).toISOString() }))
}

export async function recentlyFixed(sql: Sql, days = 7): Promise<FixedDTO[]> {
  const rows = await sql<(Omit<FixedDTO, 'resolved_at' | 'photo'> & { resolved_at: Date; first_signal_at: Date; evidence: Array<{ kind: string; image?: string }> })[]>`
    select i.id, i.code, i.service, i.title, a.designator, b.house_number house, i.status, i.resolved_at, i.first_signal_at, i.signal_count, i.verify_yes, i.is_demo, i.evidence
    from incidents i left join areas a on a.id = i.area_id left join buildings b on b.id = i.building_id
    where i.status in ('RESOLVED', 'VERIFIED') and i.resolved_at > now() - make_interval(days => ${days}) and i.demo_session_id is null
    order by i.resolved_at desc limit 24`
  return rows.map(({ first_signal_at, evidence, ...r }) => ({
    ...r, resolved_at: new Date(r.resolved_at).toISOString(),
    photo: (evidence.find((e) => e.kind === 'after' && e.image) ?? evidence.find((e) => e.image))?.image ?? null,
    minutes_to_fix: Math.max(1, Math.round((new Date(r.resolved_at).getTime() - new Date(first_signal_at).getTime()) / 60_000)),
  }))
}

export async function newsFront(sql: Sql, lang: Lang, now = new Date()) {
  const week = new Date(now.getTime() - 7 * 86400_000)
  const [aktau, kazakhstan, world, official, fixed, weather, pulse, sections] = await Promise.all([
    listNews(sql, { scope: 'aktau', limit: 60 }),
    listNews(sql, { scope: 'kazakhstan', limit: 40 }),
    listNews(sql, { scope: 'world', limit: 30 }),
    loadEvents(sql, { current: true, includeResolvedSince: week, limit: 40 }, null, now),
    recentlyFixed(sql),
    getWeatherSnippet(sql, now, lang),
    cityPulse(sql),
    sql<{ section: string; n: number }[]>`select section, count(*)::int n from news_articles group by section order by n desc`,
  ])
  // Newest official word first; weather advisories live in the masthead instead.
  const notices = official.filter((e) => e.category !== 'WEATHER').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8)
  return { generated_at: now.toISOString(), articles: aktau, national: kazakhstan, world, official: notices, fixed, weather, pulse, sections: sections.map((s) => ({ key: s.section, count: s.n })) }
}
export type NewsFront = Awaited<ReturnType<typeof newsFront>>
