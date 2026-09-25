// What's on in Aktau: films with today's and tomorrow's sessions in every
// cinema, and concerts / stand-up / theatre / festivals from the city's
// listings. One show listed on two sites is one show (with both links).
// Plus the places that are open to go to any day (parks, the embankment,
// museums, theatres) from OpenStreetMap.
import type { AfishaCategory } from '@aktau/connectors'
import type { Sql } from './db/client.ts'

export type CinemaDTO = { cinema_id: string; name: string; address: string | null; sessions: Array<{ starts_at: string; format: string | null; language: string | null; price_from: number | null }> }
export type FilmDTO = {
  film_id: string; title: string; url: string | null; genres: string | null; details: string | null; poster: string | null
  languages: string[]; price_from: number | null; next: string | null; cinemas: CinemaDTO[]
}
export type ShowDTO = {
  id: string; title: string; category: AfishaCategory; summary: string | null; image_url: string | null; venue: string | null; address: string | null
  sessions: string[]; next: string; ends_at: string | null; price_from: number | null; ticket_url: string | null
  sources: Array<{ name: string; url: string }>
}
export type SpotDTO = { id: string; name: string; category: string; address: string | null; lat: number; lon: number; opening_hours: string | null; website: string | null }
export type WhatsOn = { generated_at: string; films: FilmDTO[]; shows: ShowDTO[]; spots: SpotDTO[]; sources: Array<{ slug: string; name: string; url: string | null; last_success: string | null }> }

/** Title words that say nothing about which show it is. */
const NOISE = new Set(['концерт', 'концерты', 'концерті', 'сольный', 'актау', 'ақтау', 'ақтауда', 'актауда', 'aktau', 'в', 'на', 'и', 'шоу', 'show', 'live', 'стендап', 'stand', 'up', 'қаласында', 'городе'])
const words = (t: string) => new Set(t.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-яәғқңөұүһі0-9]+/).filter((w) => w.length > 1 && !NOISE.has(w)))
/** Publishers append the city ("… в Актау", "… Ақтауда"); on Aktau's own afisha it goes without saying. */
export const withoutCity = (t: string) => t.replace(/\s+(?:в\s+(?:городе\s+|г\.\s*)?Актау|Ақтау\s+қаласында|Ақтауда)\s*$/i, '').trim() || t

export function sameShow(a: { title: string; sessions: string[] }, b: { title: string; sessions: string[] }) {
  const wa = words(a.title), wb = words(b.title)
  if (!wa.size || !wb.size) return false
  const shared = [...wa].filter((w) => wb.has(w)).length
  const close = a.sessions.some((x) => b.sessions.some((y) => Math.abs(new Date(x).getTime() - new Date(y).getTime()) < 18 * 3600_000))
  return close && (shared / Math.min(wa.size, wb.size) >= 0.6)
}

export async function whatsOn(sql: Sql, o: { now?: Date; days?: number } = {}): Promise<WhatsOn> {
  const now = o.now ?? new Date()
  const until = new Date(now.getTime() + (o.days ?? 120) * 86400_000)
  const [sessions, events, spots, sources] = await Promise.all([
    sql<{ cinema_id: string; cinema_name: string; cinema_address: string | null; film_id: string; film_title: string; film_url: string | null; genres: string | null; details: string | null; poster_url: string | null; starts_at: Date; format: string | null; language: string | null; price_from: number | null }[]>`
      select cinema_id, cinema_name, cinema_address, film_id, film_title, film_url, genres, details, poster_url, starts_at, format, language, price_from
      from cinema_sessions where starts_at > ${new Date(now.getTime() - 3 * 3600_000)} and starts_at < ${new Date(now.getTime() + 48 * 3600_000)}
      order by starts_at`,
    sql<{ id: string; title: string; category: AfishaCategory; summary: string | null; image_url: string | null; venue: string | null; address: string | null; sessions: Date[]; starts_at: Date; ends_at: Date | null; price_from: number | null; url: string; ticket_url: string | null; source: string }[]>`
      select e.id, e.title, e.category, e.summary, e.image_url, e.venue, e.address, e.sessions, e.starts_at, e.ends_at, e.price_from, e.url, e.ticket_url, split_part(s.name, ' · ', 1) source
      from afisha_events e join sources s on s.id = e.source_id
      where coalesce(e.ends_at, (select max(x) from unnest(e.sessions) x), e.starts_at) > ${new Date(now.getTime() - 3 * 3600_000)} and e.starts_at < ${until}
      order by e.starts_at`,
    sql<{ id: string; name: string; category: string; address: string | null; lat: number; lon: number; opening_hours: string | null; website: string | null }[]>`
      select * from (
        -- OSM names every bench and playground; one row per name, generic objects left out
        -- (both cases spelled out: under the C locale ~* does not fold Cyrillic).
        select distinct on (lower(name)) id, name, category, address, ST_Y(point::geometry) lat, ST_X(point::geometry) lon, opening_hours, website from places
        where category in ('culture', 'park', 'attraction') and name is not null and name <> '' and name !~* '([пП]лощадк|playground|[сС]камей|bench|[бБ]еседк|[тТ]уалет|[пП]арковк)'
        order by lower(name), id
      ) p order by case category when 'attraction' then 0 when 'park' then 1 else 2 end, name limit 30`,
    sql<{ slug: string; name: string; base_url: string | null; last_successful_fetch_at: Date | null }[]>`
      select slug, name, base_url, last_successful_fetch_at from sources where slug in ('kinoafisha', 'sxodim', 'inaktau', 'topbilet') order by name`,
  ])

  // Films: one card per film, its sessions under each cinema.
  const films = new Map<string, FilmDTO>()
  for (const s of sessions) {
    const key = s.film_title.toLowerCase().replace(/ё/g, 'е')
    let f = films.get(key)
    if (!f) { f = { film_id: s.film_id, title: s.film_title, url: s.film_url, genres: s.genres, details: s.details, poster: s.poster_url, languages: [], price_from: null, next: null, cinemas: [] }; films.set(key, f) }
    let c = f.cinemas.find((x) => x.cinema_id === s.cinema_id)
    if (!c) { c = { cinema_id: s.cinema_id, name: s.cinema_name, address: s.cinema_address, sessions: [] }; f.cinemas.push(c) }
    const iso = new Date(s.starts_at).toISOString()
    c.sessions.push({ starts_at: iso, format: s.format, language: s.language, price_from: s.price_from })
    if (s.language && !f.languages.includes(s.language)) f.languages.push(s.language)
    if (s.price_from != null && (f.price_from == null || s.price_from < f.price_from)) f.price_from = s.price_from
    if (new Date(s.starts_at) >= now && (!f.next || iso < f.next)) f.next = iso
  }
  // Films with a session still ahead come first, soonest first.
  const filmList = [...films.values()].sort((a, b) => (a.next ? 0 : 1) - (b.next ? 0 : 1) || (a.next ?? '').localeCompare(b.next ?? '') || a.title.localeCompare(b.title))

  // Shows: the same show on two sites is one card with both links.
  const shows: ShowDTO[] = []
  for (const e of events) {
    const own = { title: withoutCity(e.title), sessions: (e.sessions.length ? e.sessions : [e.starts_at]).map((d) => new Date(d).toISOString()) }
    const hit = shows.find((x) => sameShow(x, own))
    if (hit) {
      if (!hit.sources.some((x) => x.name === e.source)) hit.sources.push({ name: e.source, url: e.url })
      hit.sessions = [...new Set([...hit.sessions, ...own.sessions])].sort()
      hit.image_url ??= e.image_url
      hit.summary ??= e.summary
      hit.venue ??= e.venue
      hit.address ??= e.address
      hit.ticket_url ??= e.ticket_url
      if (e.price_from != null && (hit.price_from == null || e.price_from < hit.price_from)) hit.price_from = e.price_from
      if (hit.category === 'other' && e.category !== 'other') hit.category = e.category
      if (own.title.length > hit.title.length) hit.title = own.title
      continue
    }
    shows.push({
      id: e.id, title: own.title, category: e.category, summary: e.summary, image_url: e.image_url, venue: e.venue, address: e.address,
      sessions: own.sessions, next: own.sessions[0]!, ends_at: e.ends_at ? new Date(e.ends_at).toISOString() : null, price_from: e.price_from,
      ticket_url: e.ticket_url, sources: [{ name: e.source, url: e.url }],
    })
  }
  for (const s of shows) s.next = s.sessions.find((x) => new Date(x) >= new Date(now.getTime() - 3 * 3600_000)) ?? s.sessions[s.sessions.length - 1]!
  shows.sort((a, b) => a.next.localeCompare(b.next))

  return {
    generated_at: now.toISOString(), films: filmList, shows, spots,
    sources: sources.map((s) => ({ slug: s.slug, name: s.name, url: s.base_url, last_success: s.last_successful_fetch_at ? new Date(s.last_successful_fetch_at).toISOString() : null })),
  }
}
