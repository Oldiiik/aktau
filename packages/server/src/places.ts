// Search order: 1) local microdistrict/building index  2) cached places
// 3) 2GIS (if configured)  4) Nominatim (cached, 1 req/s) — so typing "14"
// never leaves our database.
import { dgisConfigured, dgisSearch, nominatimSearch } from '@aktau/connectors'
import { areaName } from '@aktau/i18n'
import { normalizeHouseNumber, normalizeText, parseDistrictDesignator } from '@aktau/normalization/text'
import type { Lang } from '@aktau/types'
import { cached } from './cache.ts'
import type { Sql } from './db/client.ts'

export type SearchHit =
  | { kind: 'area'; id: string; label: string; sublabel: string; designator: string | null; lat: number | null; lon: number | null }
  | { kind: 'building'; id: string; area_id: string; label: string; sublabel: string; lat: number | null; lon: number | null }
  | { kind: 'place'; id: string; label: string; sublabel: string; category: string; lat: number; lon: number; source: string; opening_hours: string | null; distance_m: number | null }
  | { kind: 'geocode'; id: string; label: string; sublabel: string; lat: number; lon: number; source: 'Nominatim' }

export async function searchLocal(sql: Sql, q: string, lang: Lang, limit = 8): Promise<SearchHit[]> {
  const text = normalizeText(q)
  if (!text) return []
  // "14 мкр 21", "14/21", "14-21", "мкр 14 дом 21" → district + house
  const combo = text.match(/^(?:мкр\.?\s*|микрорайон\s*)?(\d{1,2}[а-яa-z]?)\s*(?:мкр\.?|микрорайон|mkr|шағын аудан)?[\s,/-]+(?:дом|д\.|үй|house)?\s*(\d{1,3}[а-яa-z]?(?:\/\d+)?)$/)
  const out: SearchHit[] = []
  if (combo) {
    const d = parseDistrictDesignator(`${combo[1]} мкр`)
    const rows = await sql<{ id: string; area_id: string; house_number: string; display_address: string; name: string; name_ru: string | null; name_kk: string | null; name_en: string | null; lat: number | null; lon: number | null }[]>`
      select b.id, b.area_id, b.house_number, b.display_address, a.name, a.name_ru, a.name_kk, a.name_en, ST_Y(b.point::geometry) lat, ST_X(b.point::geometry) lon
      from buildings b join areas a on a.id = b.area_id
      where a.designator = ${d} and b.house_number_norm like ${normalizeHouseNumber(combo[2]!) + '%'}
      order by length(b.house_number_norm), b.house_number_norm limit ${limit}`
    for (const r of rows) out.push({ kind: 'building', id: r.id, area_id: r.area_id, label: `${areaName(lang, r)}, ${r.house_number}`, sublabel: 'Aktau', lat: r.lat, lon: r.lon })
  }
  const areas = await sql<{ id: string; name: string; name_ru: string | null; name_kk: string | null; name_en: string | null; designator: string | null; area_type: string; lat: number | null; lon: number | null; exact: boolean }[]>`
    select id, name, name_ru, name_kk, name_en, designator, area_type, ST_Y(centroid::geometry) lat, ST_X(centroid::geometry) lon,
      (designator is not null and lower(designator) = ${text.replace(/\s*(мкр|mkr|микрорайон)\.?\s*/g, '').trim()}) exact
    from areas where search_text like ${'%' + text + '%'} and area_type <> 'CITY'
    order by exact desc, length(coalesce(designator, name)), designator limit ${limit}`
  for (const a of areas) out.push({ kind: 'area', id: a.id, label: areaName(lang, a), sublabel: a.area_type === 'MICRODISTRICT' ? 'Microdistrict · Aktau' : 'Aktau', designator: a.designator, lat: a.lat, lon: a.lon })
  return out.slice(0, limit)
}

export async function searchPlaces(sql: Sql, q: string, near: { lat: number; lon: number } | null, opts: { category?: string | null; openNow?: boolean; limit?: number } = {}): Promise<SearchHit[]> {
  const limit = opts.limit ?? 10
  const text = normalizeText(q)
  const cats = opts.category === 'food' ? ['cafe', 'restaurant'] : opts.category ? [opts.category] : null
  const rows = await sql<{ id: string; name: string; category: string; address: string | null; opening_hours: string | null; lat: number; lon: number; dist: number | null; source: string }[]>`
    select p.id, p.name, p.category, p.address, p.opening_hours, ST_Y(p.point::geometry) lat, ST_X(p.point::geometry) lon, s.name source,
      case when ${near?.lat ?? null}::float8 is null then null else ST_Distance(p.point, ST_SetSRID(ST_MakePoint(${near?.lon ?? null}::float8, ${near?.lat ?? null}::float8), 4326)::geography) end dist
    from places p join sources s on s.id = p.source_id
    where (${cats}::text[] is null or p.category = any(${cats}::text[]))
      and (${text === '' || !!cats} or lower(p.name) like ${'%' + text + '%'} or lower(coalesce(p.name_ru, '')) like ${'%' + text + '%'} or p.category = ${text})
    order by dist asc nulls last, p.name limit ${limit * 3}`
  let hits: SearchHit[] = rows.map((r) => ({
    kind: 'place', id: r.id, label: r.name, sublabel: [r.address, r.category].filter(Boolean).join(' · '), category: r.category,
    lat: r.lat, lon: r.lon, source: r.source, opening_hours: r.opening_hours, distance_m: r.dist == null ? null : Math.round(r.dist),
  }))
  if (opts.openNow) hits = hits.filter((h) => h.kind === 'place' && isOpenNow(h.opening_hours, new Date()) !== false)
  hits = hits.slice(0, limit)
  if (hits.length < 3 && text.length >= 3 && dgisConfigured() && near) {
    const r = await cached(sql, 'dgis', `search:${text}`, 86400, () => dgisSearch(q, near))
    for (const p of r?.payload ?? []) hits.push({ kind: 'place', id: `dgis:${p.external_id}`, label: p.name, sublabel: p.address ?? p.category, category: p.category, lat: p.lat, lon: p.lon, source: '2GIS', opening_hours: null, distance_m: null })
  }
  return hits
}

export async function geocodeFallback(sql: Sql, q: string): Promise<SearchHit[]> {
  const text = normalizeText(q)
  if (text.length < 4) return []
  const r = await cached(sql, 'nominatim', `q:${text}`, 30 * 86400, () => nominatimSearch(`${q}, Aktau`))
  return (r?.payload ?? []).map((g) => ({ kind: 'geocode' as const, id: g.osm, label: g.display_name.split(',')[0] ?? g.display_name, sublabel: g.display_name, lat: g.lat, lon: g.lon, source: 'Nominatim' as const }))
}

/**
 * Minimal OSM opening_hours evaluation for common forms ("24/7",
 * "Mo-Su 09:00-23:00", "Mo-Fr 08:00-20:00; Sa 10:00-18:00"). Returns null when
 * the expression is too complex to be sure — callers must not claim "open".
 */
export function isOpenNow(oh: string | null, now: Date): boolean | null {
  if (!oh) return null
  const s = oh.trim()
  if (s === '24/7') return true
  const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Aqtau', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const wd = days.indexOf((parts.find((p) => p.type === 'weekday')?.value ?? 'Mon').slice(0, 2))
  const mins = Number(parts.find((p) => p.type === 'hour')?.value) * 60 + Number(parts.find((p) => p.type === 'minute')?.value)
  let understood = false
  for (const rule of s.split(';').map((r) => r.trim())) {
    const m = rule.match(/^(?:([A-Z][a-z])(?:-([A-Z][a-z]))?\s+)?(\d{2}):(\d{2})-(\d{2}):(\d{2})$/)
    if (!m) return null
    understood = true
    const from = m[1] ? days.indexOf(m[1]) : 0, to = m[2] ? days.indexOf(m[2]) : m[1] ? from : 6
    const inDays = from <= to ? wd >= from && wd <= to : wd >= from || wd <= to
    const a = Number(m[3]) * 60 + Number(m[4]), b = Number(m[5]) * 60 + Number(m[6])
    const inTime = b > a ? mins >= a && mins < b : mins >= a || mins < b
    if (inDays && inTime) return true
  }
  return understood ? false : null
}

/** "12 places open around you": places with opening hours we can evaluate, open now, near an area's centre. */
export async function openPlacesNearArea(sql: Sql, areaId: string, radius = 1500, now = new Date()) {
  const rows = await sql<{ opening_hours: string }[]>`
    select p.opening_hours from places p, areas a
    where a.id = ${areaId} and p.opening_hours is not null and p.category in ('cafe', 'restaurant', 'pharmacy', 'hospital', 'public')
      and ST_DWithin(p.point, coalesce(a.centroid, ST_PointOnSurface(a.geometry::geometry)::geography), ${radius})`
  return { count: rows.filter((r) => isOpenNow(r.opening_hours, now) === true).length, radius_m: radius }
}
