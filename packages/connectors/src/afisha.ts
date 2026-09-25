// Afisha: what's on in Aktau. Four public listings, each read politely
// (their robots.txt allows it; seconds between requests; a few pages a run):
//   Kinoafisha  kz.kinoafisha.info  today's sessions in Aktau's cinemas
//   Sxodim      sxodim.com/aktau    concerts, stand-up, theatre (schema.org Event)
//   inaktau.kz  the city portal     its afisha (schema.org Event)
//   Topbilet    topbilet.kz         ticketed shows (Open Graph)
// We keep facts (what, when, where, price from), the publisher's own short
// description and poster, and link to the publisher and its ticket page.
// Ticketon is not used: it sends automated clients to a Queue-it waiting room.
import { httpFetch } from './http.ts'
import type { RawSourceItem, SourceConnector } from './types.ts'

export type AfishaCategory = 'concert' | 'standup' | 'theatre' | 'festival' | 'kids' | 'sport' | 'exhibition' | 'party' | 'other'

export type AfishaEvent = {
  external_id: string
  url: string
  ticket_url: string | null
  title: string
  category: AfishaCategory
  summary: string | null
  image_url: string | null
  venue: string | null
  address: string | null
  /** Every known start (ISO); the first is the next one. */
  sessions: string[]
  ends_at: string | null
  price_from: number | null
}

export type CinemaFilm = {
  film_id: string; title: string; url: string; genres: string | null; details: string | null; poster: string | null
  sessions: Array<{ starts_at: string; format: string | null; language: string | null; price_from: number | null }>
}
export type CinemaSchedule = { cinema_id: string; cinema_name: string; cinema_address: string | null; url: string; date: string; films: CinemaFilm[] }

// ── Shared helpers ──────────────────────────────────────────────────────────
const ENT: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' }
export const decodeHtml = (s: string) => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, d, h, n) => (d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : ENT[n.toLowerCase()] ?? m))
const text = (html: string) => decodeHtml(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const clip = (s: string | null | undefined, n = 280) => { const t = s?.replace(/\s+/g, ' ').trim(); return t ? (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t) : null }

/** Aktau is UTC+5 all year. */
export function aktauTime(date: string, hh: number, mm: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!, hh - 5, mm)).toISOString()
}

function meta(html: string, key: string): string | null {
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0]
    if (new RegExp(`(?:property|name)=["']${key.replace(':', '\\:')}["']`, 'i').test(tag)) {
      const c = tag.match(/content=["']([^"']*)["']/i)?.[1]
      if (c) return decodeHtml(c).trim()
    }
  }
  return null
}

/** JSON-LD blocks, tolerating raw line breaks inside strings (some publishers emit them). */
export function jsonLd(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1]!.trim()
    for (const attempt of [raw, raw.replace(/[\u0000-\u001f]+/g, ' ')]) {
      try {
        const d = JSON.parse(attempt) as unknown
        for (const it of Array.isArray(d) ? d : [d]) {
          const o = it as Record<string, unknown>
          if (Array.isArray(o['@graph'])) out.push(...(o['@graph'] as Array<Record<string, unknown>>))
          else out.push(o)
        }
        break
      } catch { /* try the cleaned text */ }
    }
  }
  return out
}

export function categoryOf(...hints: Array<string | null | undefined>): AfishaCategory {
  const t = hints.filter(Boolean).join(' ').toLowerCase()
  if (/stand[\s-]?up|стендап|стенд-ап|comedy|камеди|юмор/.test(t)) return 'standup'
  if (/театр|спектакл|постановк|драм|опер[аы]|балет|theatre|theater/.test(t)) return 'theatre'
  if (/фестивал|festival|конкурс|фест\b/.test(t)) return 'festival'
  if (/дет(?:ям|ский|ск)|балалар|kids|children|мульт/.test(t)) return 'kids'
  if (/спорт|матч|турнир|марафон|футбол|бокс|sport/.test(t)) return 'sport'
  if (/выставк|экспозиц|музей|exhibition|галере/.test(t)) return 'exhibition'
  if (/вечеринк|party|dj\b|клуб/.test(t)) return 'party'
  if (/концерт|concert|тур\b|шоу|show|live|оркестр|песн|әнші|ән кеші/.test(t)) return 'concert'
  return 'other'
}

// ── Kinoafisha: cinemas and today's sessions ────────────────────────────────
const KA = 'https://kz.kinoafisha.info'

export function parseKinoafishaCinemas(html: string): Array<{ id: string; name: string; address: string | null }> {
  const out: Array<{ id: string; name: string; address: string | null }> = []
  for (const m of html.matchAll(/<a href="https:\/\/kz\.kinoafisha\.info\/aktau\/cinema\/(\d+)\/" class="cinemaList_name">([\s\S]*?)<\/a>\s*(?:<div class="cinemaList_addr">([\s\S]*?)<\/div>)?/g)) {
    if (!out.some((c) => c.id === m[1])) out.push({ id: m[1]!, name: text(m[2]!), address: m[3] ? text(m[3]) : null })
  }
  return out
}

export function parseKinoafishaSchedule(html: string, cinema: { id: string; name: string; address: string | null }): CinemaSchedule[] {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  const out: CinemaSchedule[] = []
  const days = body.split(/<article class="showtimesListItem_item[^"]*" data-schedule-date="/).slice(1)
  for (const day of days) {
    const date = day.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const films: CinemaFilm[] = []
    for (const item of day.split('<div class="showtimes_item"').slice(1)) {
      const name = item.match(/class="showtimesMovie_name" href="([^"]+)">([\s\S]*?)<\/a>/)
      if (!name) continue
      const url = name[1]!
      const film_id = url.match(/movies\/(\d+)/)?.[1] ?? url
      const sessions: CinemaFilm['sessions'] = []
      for (const g of item.split('<div class="showtimes_formatGroup"').slice(1)) {
        const format = g.match(/data-format="([^"]*)"/)?.[1]?.trim() || null
        const language = format?.match(/\b(KK|RU|EN|KZ)\b/)?.[1]?.replace('KZ', 'KK') ?? null
        for (const s of g.matchAll(/<span class="session_time">(\d{1,2}):(\d{2})<\/span>(?:\s*<span class="session_price">([\s\S]*?)<\/span>)?/g)) {
          const hh = Number(s[1]), mm = Number(s[2])
          // Night sessions (00:10) listed under a day belong to the next morning.
          const d = hh < 6 ? new Date(Date.parse(`${date}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10) : date
          const price = s[3] ? Number(text(s[3]).replace(/[^\d]/g, '')) || null : null
          sessions.push({ starts_at: aktauTime(d, hh, mm), format, language, price_from: price })
        }
      }
      if (!sessions.length) continue
      films.push({
        film_id, title: text(name[2]!), url,
        genres: clip(text(item.match(/class="showtimesMovie_categories">([\s\S]*?)<\/span>/)?.[1] ?? ''), 80),
        details: clip(text(item.match(/class="showtimesMovie_details">([\s\S]*?)<\/span>/)?.[1] ?? ''), 80),
        poster: item.match(/<img class="picture_image"[^>]*src="([^"]+)"/)?.[1] ?? null,
        sessions: sessions.sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      })
    }
    out.push({ cinema_id: cinema.id, cinema_name: cinema.name, cinema_address: cinema.address, url: `${KA}/aktau/cinema/${cinema.id}/schedule/`, date, films })
  }
  return out
}

export const kinoafisha: SourceConnector = {
  slug: 'kinoafisha',
  job: 'afisha',
  async fetch() {
    const list = await httpFetch(`${KA}/aktau/cinema/`, { timeoutMs: 20_000, minIntervalMs: 2500, headers: { accept: 'text/html' } })
    if (list.status !== 200) return { items: [], http_status: list.status, notes: 'cinema list unavailable' }
    const cinemas = parseKinoafishaCinemas(list.text).slice(0, 8)
    const items: RawSourceItem[] = []
    for (const c of cinemas) {
      const page = await httpFetch(`${KA}/aktau/cinema/${c.id}/schedule/`, { timeoutMs: 20_000, minIntervalMs: 2500, headers: { accept: 'text/html' } })
      if (page.status !== 200) continue
      for (const day of parseKinoafishaSchedule(page.text, c)) {
        items.push({
          external_id: `${c.id}:${day.date}:${day.films.reduce((n, f) => n + f.sessions.length, 0)}`,
          canonical_url: day.url, title: `${c.name} · ${day.date}`,
          raw_text: `${c.name}: ${day.films.map((f) => `${f.title} ${f.sessions.map((s) => s.starts_at.slice(11, 16)).join(' ')}`).join('; ')}`.slice(0, 4000),
          raw_json: { schedule: day }, language: 'ru', published_at: null, extractable: false,
        })
      }
    }
    return { items, http_status: 200, notes: `${cinemas.length} cinemas, ${items.length} schedules` }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'Aktau cinema schedules (kz.kinoafisha.info): film, time, format, price from; linked to the publisher.' }
  },
}

// ── Sxodim: schema.org Event pages ──────────────────────────────────────────
const SX = 'https://sxodim.com'

export function sxodimEventLinks(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(https:\/\/sxodim\.com\/aktau\/event\/[a-z0-9-]+)"/g)].map((m) => m[1]!))]
}

export function parseSxodimEvent(html: string, url: string): AfishaEvent | null {
  const ld = jsonLd(html)
  const ev = ld.find((x) => x['@type'] === 'Event') as Record<string, any> | undefined
  if (!ev?.name || !ev.startDate) return null
  const crumbs = (ld.find((x) => x['@type'] === 'BreadcrumbList') as { itemListElement?: Array<{ name?: string }> } | undefined)?.itemListElement?.map((x) => x.name ?? '') ?? []
  const offer = Array.isArray(ev.offers) ? ev.offers[0] : ev.offers
  const loc = ev.location ?? {}
  const address = typeof loc.address === 'string' ? loc.address : loc.address?.streetAddress ?? null
  const venue = loc.name && loc.name !== ev.name ? String(loc.name) : address
  const image = Array.isArray(ev.image) ? ev.image[0] : typeof ev.image === 'string' ? ev.image : ev.image?.url
  const price = offer?.price != null ? Number(offer.price) || null : null
  return {
    external_id: url.split('/').pop()!, url, ticket_url: offer?.url ?? null, title: decodeHtml(String(ev.name)).trim(),
    category: categoryOf(crumbs[1], offer?.url, ev.name), summary: clip(decodeHtml(String(ev.description ?? ''))),
    image_url: image ?? meta(html, 'og:image'), venue: venue ? decodeHtml(venue) : null, address: address ? decodeHtml(address) : null,
    sessions: [new Date(ev.startDate).toISOString()], ends_at: ev.endDate ? new Date(ev.endDate).toISOString() : null, price_from: price && price > 0 ? price : null,
  }
}

export const sxodim: SourceConnector = {
  slug: 'sxodim',
  job: 'afisha',
  async fetch() {
    const links = new Set<string>()
    for (const path of ['/aktau/afisha', '/aktau/events/concert', '/aktau/events/stand-up', '/aktau/events/teatr', '/aktau/events/festivali', '/aktau/events/week']) {
      const page = await httpFetch(`${SX}${path}`, { timeoutMs: 20_000, minIntervalMs: 2500, headers: { accept: 'text/html' } })
      if (page.status === 200) for (const l of sxodimEventLinks(page.text)) links.add(l)
    }
    const items: RawSourceItem[] = []
    for (const url of [...links].slice(0, 20)) {
      const page = await httpFetch(url, { timeoutMs: 20_000, minIntervalMs: 2500, headers: { accept: 'text/html' } })
      if (page.status !== 200) continue
      const ev = parseSxodimEvent(page.text, url)
      if (ev) items.push(eventItem(ev))
    }
    return { items, http_status: 200, notes: `${links.size} events listed, ${items.length} read` }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'Aktau events (sxodim.com): schema.org Event; headline, time, venue, price; linked to the publisher.' }
  },
}

// ── inaktau.kz: the city portal's afisha ────────────────────────────────────
const IN = 'https://www.inaktau.kz'

export function inaktauEventLinks(html: string): string[] {
  return [...new Set([...html.matchAll(/href="((?:https:\/\/www\.inaktau\.kz)?\/afisha\/\d+\/[a-z0-9-]+)"/g)].map((m) => (m[1]!.startsWith('http') ? m[1]! : `${IN}${m[1]}`)))]
}

const MONTHS: Record<string, number> = { январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6, июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12 }

export function parseInaktauEvent(html: string, url: string, now = new Date()): AfishaEvent | null {
  const ev = jsonLd(html).find((x) => x['@type'] === 'Event') as Record<string, any> | undefined
  if (!ev?.name || !ev.startDate) return null
  const body = text(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''))
  // "25 сентября 19:00 26 сентября 17:00": the sessions, in Aktau time, after the venue line.
  // The page gives no year: it is startDate's, or the next one for a run that crosses New Year.
  const sessions: string[] = []
  const [sy, sm] = String(ev.startDate).slice(0, 7).split('-').map(Number)
  const start = body.indexOf(String(ev.name).slice(0, 30), body.indexOf(String(ev.name).slice(0, 30)) + 1)
  const scan = body.slice(start > 0 ? start : 0, (start > 0 ? start : 0) + 600)
  for (const m of scan.matchAll(/(\d{1,2})\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-я]*\s+(\d{1,2}):(\d{2})/g)) {
    const mo = MONTHS[Object.keys(MONTHS).find((k) => m[2]!.startsWith(k))!]!
    const year = !sy || !sm ? now.getUTCFullYear() : mo < sm ? sy + 1 : sy
    sessions.push(aktauTime(`${year}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`, Number(m[3]), Number(m[4])))
  }
  if (!sessions.length) sessions.push(new Date(`${String(ev.startDate).slice(0, 10)}T00:00:00+05:00`).toISOString())
  const crumb = body.match(/Главная Афиша (\S+) /)?.[1]
  const loc = ev.location ?? {}
  return {
    external_id: url.match(/afisha\/(\d+)/)?.[1] ?? url, url, ticket_url: null, title: decodeHtml(String(ev.name)).trim(),
    category: categoryOf(crumb, String(ev.description ?? ''), ev.name), summary: clip(decodeHtml(String(ev.description ?? ''))),
    image_url: typeof ev.image === 'string' ? ev.image : meta(html, 'og:image'), venue: loc.name ? decodeHtml(String(loc.name)) : null,
    address: typeof loc.address === 'string' ? decodeHtml(loc.address) : null,
    sessions: [...new Set(sessions)].sort(), ends_at: ev.endDate ? new Date(`${String(ev.endDate).slice(0, 10)}T23:59:00+05:00`).toISOString() : null, price_from: null,
  }
}

export const inaktau: SourceConnector = {
  slug: 'inaktau',
  job: 'afisha',
  async fetch(ctx) {
    // Crawl-delay: 5 (robots.txt).
    const list = await httpFetch(`${IN}/afisha`, { timeoutMs: 20_000, minIntervalMs: 5000, headers: { accept: 'text/html' } })
    if (list.status !== 200) return { items: [], http_status: list.status, notes: 'afisha unavailable' }
    const items: RawSourceItem[] = []
    const links = inaktauEventLinks(list.text).slice(0, 12)
    for (const url of links) {
      const page = await httpFetch(url, { timeoutMs: 20_000, minIntervalMs: 5000, headers: { accept: 'text/html' } })
      if (page.status !== 200) continue
      const ev = parseInaktauEvent(page.text, url, ctx.now)
      if (ev) items.push(eventItem(ev))
    }
    return { items, http_status: 200, notes: `${links.length} events listed, ${items.length} read` }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'The city portal inaktau.kz: schema.org Event; linked to the publisher. Crawl-delay 5 s.' }
  },
}

// ── Topbilet: Open Graph on each show page ──────────────────────────────────
const TB = 'https://topbilet.kz'

export function topbiletEventLinks(html: string): string[] {
  return [...new Set([...html.matchAll(/href="((?:https:\/\/topbilet\.kz)?\/ru\/event\/[a-z0-9-]+)"/g)].map((m) => (m[1]!.startsWith('http') ? m[1]! : `${TB}${m[1]}`)))]
}

/** og:description: "X, Дата события: 29.09.2026, 19:00; Место проведения: Театр им. Жантурина, Актау; Цены на билеты: от 6 000 ₸". */
export function parseTopbiletEvent(html: string, url: string): AfishaEvent | null {
  // Topbilet appends the city to every title ("… в Актау"): the city is implied here.
  const title = meta(html, 'og:title')?.replace(/\s*-\s*Купить билет.*$/i, '').replace(/(?:\s+в Актау)+$/i, '').trim()
  const desc = meta(html, 'og:description') ?? ''
  const when = desc.match(/Дата события:\s*(\d{2})\.(\d{2})\.(\d{4}),?\s*(\d{1,2}):(\d{2})/)
  if (!title || !when) return null
  const venue = desc.match(/Место проведения:\s*([^;]+)/)?.[1]?.trim() ?? null
  const price = Number(desc.match(/от\s*([\d\s ]+)\s*₸/)?.[1]?.replace(/[^\d]/g, '') ?? '') || null
  return {
    external_id: url.split('/').pop()!, url, ticket_url: url, title, category: categoryOf(title),
    summary: null, image_url: meta(html, 'og:image'), venue: venue?.replace(/,\s*Актау$/, '') ?? null, address: null,
    sessions: [aktauTime(`${when[3]}-${when[2]}-${when[1]}`, Number(when[4]), Number(when[5]))], ends_at: null, price_from: price,
  }
}

export const topbilet: SourceConnector = {
  slug: 'topbilet',
  job: 'afisha',
  async fetch() {
    const list = await httpFetch(`${TB}/ru/city/aktau`, { timeoutMs: 25_000, minIntervalMs: 2500, headers: { accept: 'text/html' } })
    if (list.status !== 200) return { items: [], http_status: list.status, notes: 'city page unavailable' }
    const items: RawSourceItem[] = []
    const links = topbiletEventLinks(list.text).slice(0, 15)
    for (const url of links) {
      const page = await httpFetch(url, { timeoutMs: 25_000, minIntervalMs: 2500, headers: { accept: 'text/html' } })
      if (page.status !== 200) continue
      const ev = parseTopbiletEvent(page.text, url)
      if (ev) items.push(eventItem(ev))
    }
    return { items, http_status: 200, notes: `${links.length} shows listed, ${items.length} read` }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'Ticketed shows in Aktau (topbilet.kz): Open Graph; linked to the ticket page.' }
  },
}

function eventItem(ev: AfishaEvent): RawSourceItem {
  return {
    external_id: `${ev.external_id}:${ev.sessions[0]}`, canonical_url: ev.url, title: ev.title,
    raw_text: [ev.title, ev.venue, ev.sessions.join(', '), ev.summary].filter(Boolean).join(' · ').slice(0, 2000),
    raw_json: { event: ev }, language: /[әғқңөұүһі]/i.test(ev.title) ? 'kk' : 'ru', published_at: null, extractable: false,
  }
}
