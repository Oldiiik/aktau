// Aktau assistant: a Claude agent over the city's own data. It answers almost
// anything a resident asks ("where can I fix my glasses?", "will there be
// power tomorrow?", "what's new in 14 mkr?") by calling tools that read our
// database first (places, city events, 109 incidents, news, weather) and the
// web only when the city data has nothing. Every tool result also streams to
// the client as a native card, so facts are shown from data, not from prose.
//
// Engines: Claude when ANTHROPIC_API_KEY is set, otherwise Gemini when
// GEMINI_API_KEY is set (assistant-gemini.ts, same tools), otherwise a
// deterministic path: place questions via a keyword → OSM tag map, city
// questions via askAktau. The user may attach a photo (a broken light, a leak)
// and share their current position for "near me" and "can I swim here".
import Anthropic from '@anthropic-ai/sdk'
import { fetchOverpassTag } from '@aktau/connectors'
import { eventHeadline } from '@aktau/i18n'
import { fmtTime } from '@aktau/normalization/time'
import type { AskResponse, CityEventDTO, Lang } from '@aktau/types'
import { z } from 'zod'
import { askAktau } from './ask.ts'
import { runGemini, geminiAvailable } from './assistant-gemini.ts'
import { cached } from './cache.ts'
import { canISwimHere, caspianState } from './caspian.ts'
import type { Sql } from './db/client.ts'
import { loadEvents } from './events.ts'
import { upsertPlaces } from './ingest.ts'
import { listIncidents } from './incidents.ts'
import { resolveLocation } from './location.ts'
import { getAktauNow, getWeatherSnippet } from './now.ts'
import { isOpenNow } from './places.ts'
import { whatsOn } from './afisha.ts'
import { log } from './log.ts'

// ── What the client receives (NDJSON, one event per line) ──────────────────
export type PlaceCard = {
  id: string; name: string; kind: string; address: string | null; designator: string | null; distance_m: number | null
  opening_hours: string | null; open_now: boolean | null; phone: string | null; website: string | null; lat: number; lon: number; source: string
}
export type AssistantEvent =
  | { type: 'status'; tool: string; label: string }
  | { type: 'text'; delta: string }
  | { type: 'places'; query: string; places: PlaceCard[] }
  | { type: 'events'; events: Array<{ id: string; title: string; status: string; when: string | null; authority: string; is_demo: boolean }> }
  | { type: 'incidents'; incidents: Array<{ id: string; code: string; service: string; place: string; status: string; signal_count: number }> }
  | { type: 'news'; articles: Array<{ id: string; headline: string; published_at: string; image_url: string | null }> }
  | { type: 'action'; label: string; href: string }
  | { type: 'sources'; sources: Array<{ title: string; url: string }> }
  | { type: 'answer'; answer: AskResponse }
  | { type: 'done'; mode: AssistantMode }
  | { type: 'error'; message: string }

export type ChatImage = { media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }
export type ChatTurn = { role: 'user' | 'assistant'; content: string; images?: ChatImage[] }
export type Here = { lat: number; lon: number }
export type Ctx = { sql: Sql; lang: Lang; installation_id: string | null; now: Date; here: Here | null }
export type AssistantMode = 'claude' | 'gemini' | 'offline'

const claudeAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
export const assistantMode = (): AssistantMode => (claudeAvailable() ? 'claude' : geminiAvailable() ? 'gemini' : 'offline')
export const assistantAvailable = () => assistantMode() !== 'offline'

// ── Places ──────────────────────────────────────────────────────────────────
const CITY_CENTRE = { lat: 43.6532, lon: 51.1722 }

async function originFor(ctx: Ctx, near: string | null | undefined) {
  // Shared GPS wins unless the user named a place: "near me" means where they are now.
  if (ctx.here && (!near || near === 'me')) return { point: ctx.here, label: 'your current location' }
  if (near && near !== 'home' && near !== 'me') {
    const d = near.replace(/\s*(мкр|mkr|микрорайон|шағын аудан)\.?\s*/gi, '').trim().toUpperCase()
    const [a] = await ctx.sql<{ lat: number; lon: number; designator: string }[]>`
      select ST_Y(centroid::geometry) lat, ST_X(centroid::geometry) lon, designator from areas where upper(designator) = ${d} and centroid is not null limit 1`
    if (a) return { point: { lat: a.lat, lon: a.lon }, label: `${a.designator} mkr` }
  }
  const loc = await resolveLocation(ctx.sql, { installation_id: ctx.installation_id }, ctx.lang)
  return loc.point ? { point: loc.point, label: 'home' } : { point: CITY_CENTRE, label: 'city centre' }
}

type PlaceRow = { id: string; name: string; category: string; raw: Record<string, string> | null; address: string | null; opening_hours: string | null; phone: string | null; website: string | null; lat: number; lon: number; dist: number; source: string; designator: string | null }

async function queryPlaces(ctx: Ctx, o: { query?: string | null; tag?: string | null; origin: { lat: number; lon: number }; limit: number }) {
  const [k, v] = o.tag ? o.tag.split('=') : [null, null]
  const q = o.query?.trim().toLowerCase() || null
  return ctx.sql<PlaceRow[]>`
    select p.id, p.name, p.category, p.raw, p.address, p.opening_hours, p.phone, p.website, ST_Y(p.point::geometry) lat, ST_X(p.point::geometry) lon,
      ST_Distance(p.point, ST_SetSRID(ST_MakePoint(${o.origin.lon}, ${o.origin.lat}), 4326)::geography) dist, s.name source, a.designator
    from places p join sources s on s.id = p.source_id left join areas a on a.id = p.area_id
    where (${k}::text is null or p.raw->>${k ?? ''} = ${v ?? ''} or (${v}::text is not null and p.raw->>${k ?? ''} like ${'%' + (v ?? '') + '%'}))
      and (${q}::text is null or lower(p.name) like ${'%' + (q ?? '') + '%'} or lower(coalesce(p.name_ru, '')) like ${'%' + (q ?? '') + '%'}
           or lower(p.raw::text) like ${'%' + (q ?? '') + '%'})
    order by dist asc limit ${o.limit}`
}

function toCard(r: PlaceRow, now: Date): PlaceCard {
  const t = r.raw ?? {}
  const kindTag = ['shop', 'craft', 'amenity', 'healthcare', 'office', 'tourism', 'leisure'].find((key) => t[key])
  return {
    id: r.id, name: r.name, kind: kindTag ? `${kindTag}=${t[kindTag]}` : r.category,
    address: r.address ?? ([t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ') || null), designator: r.designator,
    distance_m: Math.round(r.dist), opening_hours: r.opening_hours, open_now: isOpenNow(r.opening_hours, now),
    phone: r.phone, website: r.website, lat: r.lat, lon: r.lon, source: r.source,
  }
}

export async function findPlaces(ctx: Ctx, input: { query?: string | null; osm_tag?: string | null; near?: string | null; open_now?: boolean; limit?: number }) {
  const origin = await originFor(ctx, input.near)
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 10)
  const tag = input.osm_tag && /^[a-z_:]{2,40}=[a-z0-9_;:-]{1,60}$/.test(input.osm_tag) ? input.osm_tag : null
  let rows: PlaceRow[] = await queryPlaces(ctx, { query: tag ? null : input.query, tag, origin: origin.point, limit: limit * 3 })
  // Not in the daily snapshot: ask OpenStreetMap for exactly this tag (cached a week, then stored).
  if (rows.length < 2 && tag) {
    const live = await cached(ctx.sql, 'overpass_tag', tag, 7 * 86400, () => fetchOverpassTag(tag))
    if (live?.payload.length) {
      const [src] = await ctx.sql<{ id: string }[]>`select id from sources where slug = 'osm_overpass'`
      if (src) await upsertPlaces(ctx.sql, src.id, live.payload)
      rows = await queryPlaces(ctx, { tag, origin: origin.point, limit: limit * 3 })
    }
  }
  if (rows.length < 2 && tag && input.query) rows = [...rows, ...(await queryPlaces(ctx, { query: input.query, origin: origin.point, limit: limit * 3 }))]
  let cards = [...new Map(rows.map((r) => [r.id, toCard(r, ctx.now)])).values()]
  if (input.open_now) {
    // Closed ones go; confirmed-open ones first, unknown hours after (never claimed open).
    cards = cards.filter((c) => c.open_now !== false).sort((a, b) => Number(b.open_now === true) - Number(a.open_now === true))
  }
  return { origin: origin.label, places: cards.slice(0, limit) }
}

// A deterministic map for the offline path (and a hint for the model): what people type → OSM tag.
const PLACE_WORDS: Array<[RegExp, string]> = [
  [/очк|оптик|линз|glasses|optic|көзілдірік/i, 'shop=optician'],
  [/аптек|pharm|дәріхана/i, 'amenity=pharmacy'],
  [/стоматолог|зуб|dentist|тіс/i, 'amenity=dentist'],
  [/банкомат|atm/i, 'amenity=atm'],
  [/банк|bank/i, 'amenity=bank'],
  [/обмен|exchange|валют/i, 'amenity=bureau_de_change'],
  [/заправк|азс|fuel|petrol|бензин/i, 'amenity=fuel'],
  [/автомойк|car wash/i, 'amenity=car_wash'],
  [/шиномонтаж|tyre|tire/i, 'shop=tyres'],
  [/автосервис|(^|\s)сто(\s|$)|car repair|mechanic/i, 'shop=car_repair'],
  [/обув|shoe/i, 'shop=shoes'],
  [/ремонт телефон|phone repair|телефон/i, 'shop=mobile_phone'],
  [/часов|watch/i, 'shop=watches'],
  [/химчистк|dry.?clean|laundry|прачечн/i, 'shop=laundry'],
  [/парикмахер|барбер|hair|barber|шаштараз/i, 'shop=hairdresser'],
  [/цвет(?!н)|flower|гүл/i, 'shop=florist'],
  [/супермаркет|продукт|grocery|supermarket|азық/i, 'shop=supermarket'],
  [/ветеринар|ветклиник|veterinar|\bvet\b/i, 'amenity=veterinary'],
  [/гостиниц|отел|hotel|қонақ үй/i, 'tourism=hotel'],
  [/фитнес|спортзал|gym|fitness/i, 'leisure=fitness_centre'],
  [/кафе|кофе|cafe|coffee/i, 'amenity=cafe'],
  [/ресторан|поесть|restaurant|eat|тамақ/i, 'amenity=restaurant'],
  [/почт|post office|пошта/i, 'amenity=post_office'],
  [/больниц|поликлиник|hospital|clinic|аурухана|емхана/i, 'amenity=clinic'],
]
export const guessPlaceTag = (q: string) => PLACE_WORDS.find(([re]) => re.test(q))?.[1] ?? null

// ── Tools ───────────────────────────────────────────────────────────────────
const FindPlaces = z.object({
  query: z.string().max(80).optional(), osm_tag: z.string().max(100).optional(), near: z.string().max(20).optional(),
  open_now: z.boolean().optional(), limit: z.number().int().min(1).max(10).optional(),
})
const CityEvents = z.object({ category: z.enum(['WATER', 'ELECTRICITY', 'HEATING', 'GAS', 'ROADS', 'TRANSPORT', 'WEATHER', 'PUBLIC_EVENT', 'OTHER']).optional(), microdistrict: z.string().max(10).optional() })
const Incidents = z.object({ microdistrict: z.string().max(10).optional(), include_fixed: z.boolean().optional() })
const News = z.object({ query: z.string().max(80).optional(), limit: z.number().int().min(1).max(8).optional() })
const Report = z.object({ text: z.string().min(3).max(600) })
const Swimming = z.object({ check_here: z.boolean().optional() })
const WhatsOnInput = z.object({ kind: z.enum(['all', 'cinema', 'shows']).optional(), when: z.enum(['today', 'tomorrow', 'weekend', 'soon']).optional(), query: z.string().max(80).optional() })
const Empty = z.object({}).passthrough()

/** Tool specs shared by both engines (plain JSON Schema). */
export type ToolSpec = { name: string; description: string; schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] } }
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'find_places',
    description: 'Find places and services in Aktau from OpenStreetMap (cached in the Aktau database, refreshed daily; a missing tag is looked up live). Use for any "where can I…" question: shops, repairs, clinics, pharmacies, banks, cafes, hotels, fuel, services. Prefer osm_tag (e.g. "shop=optician" for eyeglasses, "craft=shoemaker", "shop=mobile_phone", "amenity=dentist", "shop=car_repair") and add query for a name or keyword. Results are sorted by distance from the user\'s current location when they shared it, otherwise from their home (or the city centre). Returns name, address, microdistrict, distance, opening hours, phone and website when OSM has them.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or keyword, any language (e.g. "Оптика").' },
        osm_tag: { type: 'string', description: 'One OSM tag key=value, e.g. "shop=optician".' },
        near: { type: 'string', description: 'Microdistrict designator ("14", "3А"), "home", or "me" (current location). Omit for the default.' },
        open_now: { type: 'boolean', description: 'Only places whose hours say they are open now (places without hours are kept).' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
  },
  {
    name: 'city_status',
    description: "The user's current city picture for their saved home: water, electricity, heating, roads and transport status, anything affecting their building, and the weather. Use for 'is everything ok', 'is there water/power', 'what's happening at home'.",
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'city_events',
    description: 'Official city notices that passed review (planned/active outages, road closures, advisories), from utilities (AUES, MAEK, KZhSA), the akimat and media. Use for planned outages, closures, "will there be electricity tomorrow".',
    schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['WATER', 'ELECTRICITY', 'HEATING', 'GAS', 'ROADS', 'TRANSPORT', 'WEATHER', 'PUBLIC_EVENT', 'OTHER'] },
        microdistrict: { type: 'string', description: 'Designator like "14" or "3А".' },
      },
    },
  },
  {
    name: 'incidents_109',
    description: 'Problems residents reported to 109 (the unified contact centre) that are open or recently fixed: what, where, status, how many reports. Use for "is anyone fixing…", "did someone report…", local problems.',
    schema: { type: 'object', properties: { microdistrict: { type: 'string' }, include_fixed: { type: 'boolean' } } },
  },
  {
    name: 'search_news',
    description: 'Local news from Lada.kz stored in Aktau: headline, the publisher\'s summary, date and link. Omit query for the latest stories.',
    schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 8 } } },
  },
  {
    name: 'weather',
    description: 'Current weather (Open-Meteo forecast), the latest official Kazhydromet observation, the Caspian sea (modelled) and air quality (modelled).',
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'swimming',
    description: 'Caspian Safety: the official list of beaches where swimming is permitted (akimat act) and the officially prohibited stretches (police / ДЧС), any temporary status an authority published, and modelled wind and waves. With check_here=true and a shared location, says whether the user\'s current spot is an official swimming area, prohibited, or not on the list, and the nearest official beach. Use for any question about swimming, beaches or the sea.',
    schema: { type: 'object', properties: { check_here: { type: 'boolean', description: "Check the user's current location (only when they shared it)." } } },
  },
  {
    name: 'whats_on',
    description: "What's on in Aktau (the Afisha): films with sessions today and tomorrow in every cinema (cinema, times, language KK/RU, price from) and upcoming concerts, stand-up, theatre and festivals (date and time, venue, price from, ticket link), from Kinoafisha, Sxodim, inaktau.kz and Topbilet. Use for 'where to go tonight', 'what films are on', 'concerts this weekend', 'stand-up in Aktau'.",
    schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['all', 'cinema', 'shows'], description: 'cinema = films; shows = concerts, stand-up, theatre, festivals.' },
        when: { type: 'string', enum: ['today', 'tomorrow', 'weekend', 'soon'] },
        query: { type: 'string', description: 'A film or artist name, or a word like "стендап".' },
      },
    },
  },
  {
    name: 'prepare_109_report',
    description: 'Prepare a report to 109 for the user to review and send themselves (nothing is sent by this tool). Use when the user describes or photographs a problem in the city: no water, broken light, garbage, leaking pipe, broken elevator, pothole. Write the report in the user\'s language with the address.',
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
]

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  ...TOOL_SPECS.map((t) => ({ name: t.name, description: t.description, eager_input_streaming: true, input_schema: { ...t.schema, additionalProperties: false } })),
  {
    type: 'web_search_20260209', name: 'web_search', max_uses: 3,
    user_location: { type: 'approximate', city: 'Aktau', region: 'Mangystau', country: 'KZ', timezone: 'Asia/Aqtau' },
  },
]

const LABEL: Record<string, Record<Lang, string>> = {
  find_places: { en: 'Searching places', ru: 'Ищу места', kk: 'Орындарды іздеудемін' },
  city_status: { en: 'Checking your home', ru: 'Проверяю ваш дом', kk: 'Үйіңізді тексерудемін' },
  city_events: { en: 'Reading official notices', ru: 'Читаю официальные сообщения', kk: 'Ресми хабарламаларды оқудамын' },
  incidents_109: { en: 'Checking 109', ru: 'Смотрю обращения 109', kk: '109 өтініштерін қараудамын' },
  search_news: { en: 'Searching the news', ru: 'Ищу в новостях', kk: 'Жаңалықтардан іздеудемін' },
  weather: { en: 'Checking the weather', ru: 'Смотрю погоду', kk: 'Ауа райын қараудамын' },
  swimming: { en: 'Checking official beaches', ru: 'Проверяю официальные пляжи', kk: 'Ресми жағажайларды тексерудемін' },
  whats_on: { en: 'Checking the afisha', ru: 'Смотрю афишу', kk: 'Афишаны қараудамын' },
  prepare_109_report: { en: 'Preparing a 109 report', ru: 'Готовлю обращение в 109', kk: '109-ға өтініш дайындаудамын' },
  web_search: { en: 'Searching the web', ru: 'Ищу в интернете', kk: 'Интернеттен іздеудемін' },
}

export const TOOL_LABEL = LABEL

/** Cards queued for the client, each at most once per answer (models sometimes repeat a call). */
export function cardEmitter() {
  const queue: AssistantEvent[] = []
  const seen = new Set<string>()
  const emit = (e: AssistantEvent) => { const k = JSON.stringify(e); if (!seen.has(k)) { seen.add(k); queue.push(e) } }
  return { queue, emit }
}

export async function runTool(ctx: Ctx, name: string, input: unknown, emit: (e: AssistantEvent) => void): Promise<unknown> {
  switch (name) {
    case 'find_places': {
      const i = FindPlaces.parse(input)
      const r = await findPlaces(ctx, i)
      emit({ type: 'places', query: i.query ?? i.osm_tag ?? '', places: r.places })
      return { sorted_from: r.origin, count: r.places.length, places: r.places.map(({ lat, lon, id, ...p }) => p) }
    }
    case 'city_status': {
      Empty.parse(input)
      const now = await getAktauNow(ctx.sql, { installation_id: ctx.installation_id }, ctx.lang, ctx.now)
      if (now.affecting.length) emit({ type: 'events', events: now.affecting.slice(0, 4).map((e) => eventCard(ctx.lang, e)) })
      return {
        home: now.location.area ? now.location.label : 'not set (the user can set it in You → Home)',
        headline: now.headline, overall: now.overall,
        services: now.services.map((s) => ({ service: s.key, state: s.state, label: s.label })),
        affecting_home: now.affecting.map((e) => ({ title: e.title, status: e.display_status, starts_at: e.starts_at, expected_ends_at: e.expected_ends_at, authority: e.reported_authority ?? e.primary_source.name })),
        weather: now.weather_text,
      }
    }
    case 'city_events': {
      const i = CityEvents.parse(input)
      let events = await loadEvents(ctx.sql, { current: true, categories: i.category ? [i.category] : undefined, limit: 60 }, null, ctx.now)
      if (i.microdistrict) events = events.filter((e) => e.areas.some((a) => a.designator?.toUpperCase() === i.microdistrict!.toUpperCase()))
      events = events.slice(0, 8)
      if (events.length) emit({ type: 'events', events: events.map((e) => eventCard(ctx.lang, e)) })
      return events.map((e) => ({
        title: e.title, category: e.category, status: e.display_status, starts_at: e.starts_at, expected_ends_at: e.expected_ends_at,
        eta_is_official: e.official_eta, reason: e.reason, microdistricts: e.areas.map((a) => a.designator), houses: e.buildings.map((b) => b.house_number).slice(0, 30),
        authority: e.reported_authority ?? e.primary_source.name, verification: e.verification_status, demo: e.is_demo,
      }))
    }
    case 'incidents_109': {
      const i = Incidents.parse(input)
      let list = await listIncidents(ctx.sql, { open: !i.include_fixed, limit: 60, city: true })
      if (i.microdistrict) list = list.filter((x) => x.designator?.toUpperCase() === i.microdistrict!.toUpperCase())
      list = list.slice(0, 8)
      if (list.length) emit({ type: 'incidents', incidents: list.map((x) => ({ id: x.id, code: x.code, service: x.service, place: [x.designator && `${x.designator} мкр`, x.house].filter(Boolean).join(', '), status: x.status, signal_count: x.signal_count })) })
      return list.map((x) => ({ code: x.code, service: x.service, title: x.title, microdistrict: x.designator, house: x.house, status: x.status, reports: x.signal_count, responsible: x.responsible_org, demo: x.is_demo }))
    }
    case 'search_news': {
      const i = News.parse(input)
      const q = i.query?.trim().toLowerCase() || null
      const rows = await ctx.sql<{ id: string; headline: string; lede: string | null; url: string; published_at: Date; image_url: string | null; section: string }[]>`
        select id, headline, lede, url, published_at, image_url, section from news_articles
        where ${q}::text is null or lower(headline) like ${'%' + (q ?? '') + '%'} or lower(coalesce(lede, '')) like ${'%' + (q ?? '') + '%'}
        order by published_at desc limit ${i.limit ?? 5}`
      if (rows.length) emit({ type: 'news', articles: rows.map((r) => ({ id: r.id, headline: r.headline, published_at: new Date(r.published_at).toISOString(), image_url: r.image_url })) })
      return rows.map((r) => ({ headline: r.headline, summary: r.lede, published: new Date(r.published_at).toISOString(), section: r.section, url: r.url }))
    }
    case 'weather': {
      Empty.parse(input)
      const w = await getWeatherSnippet(ctx.sql, ctx.now, ctx.lang)
      emit({ type: 'action', label: ctx.lang === 'en' ? 'Detailed weather' : ctx.lang === 'kk' ? 'Толық ауа райы' : 'Подробная погода', href: '/weather' })
      return { forecast: w.forecast, conditions: w.text, official_observation: w.observation, caspian_modelled: w.marine, air_quality_modelled: w.air, advisories: w.advisories }
    }
    case 'whats_on': {
      const i = WhatsOnInput.parse(input)
      const w = await whatsOn(ctx.sql, { now: ctx.now })
      const local = (d: Date) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10)
      const today = local(ctx.now), tomorrow = local(new Date(ctx.now.getTime() + 86400_000))
      const on = (iso: string) => {
        const d = local(new Date(iso)), wd = new Date(new Date(iso).getTime() + 5 * 3600_000).getUTCDay()
        return i.when === 'today' ? d === today : i.when === 'tomorrow' ? d === tomorrow : i.when === 'weekend' ? (wd === 0 || wd === 6) && new Date(iso).getTime() - ctx.now.getTime() < 7 * 86400_000 : true
      }
      const q = i.query?.trim().toLowerCase() || null
      const hhmm = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(11, 16)
      const films = i.kind === 'shows' ? [] : w.films.filter((f) => !q || f.title.toLowerCase().includes(q)).map((f) => ({
        title: f.title, genres: f.genres, details: f.details, languages: f.languages, price_from_kzt: f.price_from,
        cinemas: f.cinemas.map((c) => ({ cinema: c.name, address: c.address, times: c.sessions.filter((x) => on(x.starts_at) && new Date(x.starts_at) > ctx.now).map((x) => `${local(new Date(x.starts_at)) === today ? '' : `${local(new Date(x.starts_at))} `}${hhmm(x.starts_at)}${x.format ? ` (${x.format})` : ''}`) })).filter((c) => c.times.length),
      })).filter((f) => f.cinemas.length).slice(0, 12)
      const shows = i.kind === 'cinema' ? [] : w.shows.filter((x) => (!q || x.title.toLowerCase().includes(q) || x.category.includes(q)) && x.sessions.some(on)).slice(0, 10).map((x) => ({
        title: x.title, category: x.category, when_aktau_time: x.sessions.filter(on).map((iso) => `${local(new Date(iso))} ${hhmm(iso)}`), venue: x.venue, price_from_kzt: x.price_from, tickets: x.ticket_url ?? x.sources[0]?.url, listed_by: x.sources.map((s2) => s2.name),
      }))
      emit({ type: 'action', label: ctx.lang === 'en' ? 'Open the afisha' : ctx.lang === 'kk' ? 'Афишаны ашу' : 'Открыть афишу', href: '/afisha' })
      return { note: 'Facts from the listings; tickets are sold by the organisers. Times are Aktau time.', films, shows, cinemas_updated: w.sources.find((x) => x.slug === 'kinoafisha')?.last_success ?? null }
    }
    case 'swimming': {
      const i = Swimming.parse(input)
      const s = await caspianState(ctx.sql, ctx.lang, ctx.now)
      const check = i.check_here && ctx.here ? await canISwimHere(ctx.sql, ctx.here.lat, ctx.here.lon, ctx.lang) : null
      emit({ type: 'action', label: ctx.lang === 'en' ? 'Open the swimming map' : ctx.lang === 'kk' ? 'Шомылу картасын ашу' : 'Открыть карту купания', href: '/map?layer=swim' })
      const zone = (z: (typeof s.zones)[number]) => ({ name: z.name, official_text: z.official_text, temporary_status: z.operational.status === 'UNKNOWN' ? 'none published' : z.operational.status, status_note: z.operational.note, on_map: z.location.confidence !== 'unmapped' })
      return {
        rule: 'Legal status comes only from the authorities. Weather never makes a place safe or allowed. Rescuers advise swimming only at official, equipped beaches.',
        statuses: {
          official: 'on official_beaches: swimming is permitted there',
          prohibited: 'on the prohibited list only: swimming is prohibited there',
          everything_else: 'any other shore (rocks, embankments, cafes, hotels not on the list) is "not an official swimming area". Say exactly that; do NOT call it prohibited or unsafe, because it is on neither list.',
        },
        official_beaches: s.zones.filter((z) => z.legal_status === 'OFFICIAL').map(zone),
        prohibited: s.zones.filter((z) => z.legal_status === 'PROHIBITED').map(zone),
        official_source: 'Akimat of Mangystau region act No. 171, revision No. 99 of 26.06.2026; prohibited list: Mangystau police, 09.07.2026',
        conditions_modelled: { wind_ms: s.conditions.wind_ms, gust_ms: s.conditions.gust_ms, wave_m: s.conditions.wave_m, sea_temp_c: s.conditions.sea_temp_c, wind: s.conditions.wind, sea: s.conditions.sea, storm_conditions: s.conditions.attention },
        rescuers_note: 'ДЧС: sharp depth changes near the shore, undercurrents, danger in stormy weather; no swimming near breakwaters.',
        here: i.check_here ? (check ? { verdict: check.verdict.kind, place: check.zone?.name ?? null, temporary_status: check.verdict.kind === 'official' ? check.verdict.operational : null, distance_to_shore_m: check.distance_to_shore_m, nearest_official_beach: check.nearest_official ? { name: check.nearest_official.name, distance_m: check.nearest_official.distance_m } : null } : 'location not shared: ask the user to tap the location button, or open the swimming map') : undefined,
      }
    }
    case 'prepare_109_report': {
      const i = Report.parse(input)
      emit({ type: 'action', label: ctx.lang === 'en' ? 'Review and send to 109' : ctx.lang === 'kk' ? 'Тексеріп, 109-ға жіберу' : 'Проверить и отправить в 109', href: `/report?text=${encodeURIComponent(i.text)}` })
      return { prepared: true, note: 'A button is shown to the user; they review and send it themselves.' }
    }
  }
  throw new Error(`unknown tool ${name}`)
}

function eventCard(lang: Lang, e: CityEventDTO) {
  const when = e.starts_at ? `${fmtTime(new Date(e.starts_at))}${e.expected_ends_at ? `-${fmtTime(new Date(e.expected_ends_at))}` : ''}` : null
  return { id: e.id, title: eventHeadline(lang, e), status: e.display_status, when, authority: e.reported_authority ?? e.primary_source.name, is_demo: e.is_demo }
}

// ── The agent ───────────────────────────────────────────────────────────────
const SYSTEM = `You are Aktau, the city assistant inside the Aktau app for residents of Aktau, Kazakhstan (a city on the Caspian coast organised into numbered microdistricts, "мкр"; addresses are written "14 мкр, дом 21"). You help with almost anything a resident needs: finding a place or service, city utilities and roads, weather and the sea, local news, reporting problems to 109, and general everyday questions.

How to answer
- Use the tools. For anything local ("where can I fix my glasses", "pharmacy open now", "is there water") call the Aktau tools before answering. For places, choose the most specific OpenStreetMap tag you know (eyeglasses: shop=optician; shoe repair: craft=shoemaker or shop=shoe_repair; phone repair: shop=mobile_phone; watch repair: shop=watches or craft=watchmaker; dentist: amenity=dentist), and try a second tag or a keyword if the first returns nothing.
- Use web_search only when the Aktau tools have nothing useful, or for general knowledge that changes (prices, schedules, rules). Prefer sources about Aktau / Mangystau.
- Never invent facts: no made-up addresses, phone numbers, opening hours, prices, dates or times. If a place has no phone or hours in the data, say so briefly and suggest calling or checking 2GIS. Official restoration times are shown only when a source announced them.
- The app shows every tool result as a card under your message (places with map and call buttons, notices, 109 incidents, news). Do not repeat all of those details. Write a short answer that picks the best options and says why (closest, open now, has phone).
- Say where information comes from when it matters: "by OpenStreetMap data", "AUES announced", "residents reported to 109", "Lada.kz reports".
- When the user describes a problem in the city, offer to prepare a 109 report and call prepare_109_report with a clear text including the address.
- Emergencies: fire 101, police 102, ambulance 103, gas 104, unified emergency number 112. Say this first when someone may be in danger. 109 is for non-emergency city problems (utilities, roads, lighting, garbage, courtyards).
- Going out (films, concerts, stand-up, theatre, "where to go tonight"): call whats_on. Name a few options with time, place and price; tickets are bought from the organiser (the card links to the afisha).
- Swimming and the sea: call swimming. Whether a place is permitted comes only from the official list; never call a place or the sea "safe", and never turn wind or waves into permission. There are three statuses, keep them apart: an official swimming area (on the akimat list), prohibited (only the stretches on the prohibited list), and everything else, which is "not an official swimming area" (rescuers advise swimming only at official beaches). Do not call an unlisted spot prohibited. Give the official status first, then the conditions as facts. If the user is at an unlisted or prohibited spot, name the nearest official beach.
- Photos: the user may attach a photo. Say briefly what you see that matters. If it shows a city problem (broken light, leak, open hatch, garbage, pothole, broken elevator), offer a 109 report and call prepare_109_report with a clear description; ask for the address if you do not know it. Do not identify people in photos.
- Location: when the user shared their current position, "near me" means there, not their home.

Style
- Reply in the user's language (Russian, Kazakh or English).
- Be brief and concrete: 1-4 short sentences, or a short list when comparing options. Plain text with **bold** for names; no headings, no tables, no emoji.
- Do not use the em dash character. Use commas, periods or colons.`

type StreamParams = Anthropic.Beta.MessageCreateParamsStreaming

export { SYSTEM as ASSISTANT_SYSTEM }

/** Per-request facts for the model: time, home, and where the user is now. */
export async function contextLine(ctx: Ctx) {
  const loc = await resolveLocation(ctx.sql, { installation_id: ctx.installation_id }, ctx.lang)
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Aqtau', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ctx.now)
  let here = 'not shared'
  if (ctx.here) {
    const at = await resolveLocation(ctx.sql, { lat: ctx.here.lat, lon: ctx.here.lon }, ctx.lang)
    here = `${ctx.here.lat.toFixed(5)}, ${ctx.here.lon.toFixed(5)}${at.ctx.area ? ` (${at.ctx.label})` : ''}`
  }
  return `Now in Aktau: ${local} (UTC+05:00). The user's home: ${loc.ctx.area ? loc.ctx.label : 'not set'}. The user's current location: ${here}. App language: ${ctx.lang}.`
}

export async function* runAssistant(sql: Sql, input: { messages: ChatTurn[]; lang: Lang; installation_id: string | null; here?: Here | null }, now = new Date()): AsyncGenerator<AssistantEvent> {
  const ctx: Ctx = { sql, lang: input.lang, installation_id: input.installation_id, now, here: input.here ?? null }
  // Photos travel only with the newest user turn.
  const turns: ChatTurn[] = input.messages.slice(-12).map((m, i, all) => ({ role: m.role, content: m.content.slice(0, 4000), images: i === all.length - 1 ? m.images?.slice(0, 3) : undefined }))
  const last = turns[turns.length - 1]
  if (!last || last.role !== 'user') { yield { type: 'error', message: 'Empty question.' }; return }

  const mode = assistantMode()
  if (mode === 'offline') { yield* offline(ctx, last.content); return }
  if (mode === 'gemini') { yield* runGemini(ctx, turns, () => offline(ctx, last.content)); return }

  // Volatile context sits after the cached block so the prefix stays stable.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: await contextLine(ctx) },
  ]
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({
    role: t.role,
    content: t.images?.length
      ? [...t.images.map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.media_type, data: im.data } })), { type: 'text' as const, text: t.content || 'What is in this photo?' }]
      : t.content,
  }))
  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 })
  const { queue, emit } = cardEmitter()
  const sources = new Map<string, string>()
  // Server-side refusal fallbacks are on by default; an account without that
  // beta gets one retry without it.
  let useFallbacks = true

  for (let step = 0; step < 8; step++) {
    const params: StreamParams & { fallbacks?: 'default' } = {
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: (process.env.ASSISTANT_EFFORT as 'low' | 'medium' | 'high' | undefined) ?? 'medium' },
      system, tools: TOOLS, messages, stream: true,
      ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    }
    let message: Anthropic.Beta.BetaMessage
    try {
      const stream = client.beta.messages.stream(params)
      for await (const ev of stream) {
        if (ev.type === 'content_block_start' && ev.content_block.type === 'server_tool_use') yield { type: 'status', tool: 'web_search', label: LABEL.web_search![input.lang] }
        if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') yield { type: 'status', tool: ev.content_block.name, label: LABEL[ev.content_block.name]?.[input.lang] ?? ev.content_block.name }
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield { type: 'text', delta: ev.delta.text }
      }
      message = await stream.finalMessage()
    } catch (err) {
      log('warn', 'assistant.api_error', { err: err as Error })
      if (err instanceof Anthropic.BadRequestError && useFallbacks) { useFallbacks = false; step--; continue }
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) { yield* offline(ctx, last.content); return }
      yield { type: 'error', message: err instanceof Anthropic.RateLimitError ? 'The assistant is busy. Try again in a minute.' : 'The assistant could not answer. Try again.' }
      return
    }
    for (const b of message.content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.type === 'web_search_result') sources.set(r.url, r.title)
    }
    if (message.stop_reason === 'refusal') { yield { type: 'error', message: 'The assistant cannot help with that.' }; break }
    if (message.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: message.content }); continue }
    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (!uses.length || message.stop_reason !== 'tool_use') break
    messages.push({ role: 'assistant', content: message.content })
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(uses.map(async (u) => {
      try {
        return { type: 'tool_result' as const, tool_use_id: u.id, content: JSON.stringify(await runTool(ctx, u.name, u.input, emit)) }
      } catch (e) {
        return { type: 'tool_result' as const, tool_use_id: u.id, is_error: true, content: e instanceof z.ZodError ? `INVALID_INPUT ${JSON.stringify(e.issues)}` : (e as Error).message }
      }
    }))
    while (queue.length) yield queue.shift()!
    messages.push({ role: 'user', content: results })
    // Keep the conversation readable: a paragraph break between steps.
    yield { type: 'text', delta: '\n\n' }
  }
  while (queue.length) yield queue.shift()!
  if (sources.size) yield { type: 'sources', sources: [...sources].slice(0, 5).map(([url, title]) => ({ url, title })) }
  yield { type: 'done', mode: 'claude' }
}

/** No API key: places via the keyword → tag map; everything else via the deterministic Ask engine. */
export async function* offline(ctx: Ctx, question: string): AsyncGenerator<AssistantEvent> {
  const tag = guessPlaceTag(question)
  const L = (en: string, ru: string, kk: string) => (ctx.lang === 'en' ? en : ctx.lang === 'kk' ? kk : ru)
  if (tag) {
    yield { type: 'status', tool: 'find_places', label: LABEL.find_places![ctx.lang] }
    const openNow = /открыт|работает сейчас|open now|open right now|ашық/i.test(question)
    const r = await findPlaces(ctx, { osm_tag: tag, limit: 6, open_now: openNow })
    yield { type: 'text', delta: r.places.length
      ? L(`Here is what OpenStreetMap lists nearby, closest first.`, `Вот что есть поблизости по данным OpenStreetMap, ближайшие сверху.`, `OpenStreetMap деректері бойынша жақын маңдағы орындар.`)
      : L(`OpenStreetMap has nothing for this in Aktau yet. Try 2GIS.`, `В OpenStreetMap для Актау пока ничего нет. Попробуйте 2GIS.`, `OpenStreetMap-та Ақтау үшін әзірге ештеңе жоқ. 2GIS-ті көріңіз.`) }
    if (r.places.length) yield { type: 'places', query: tag, places: r.places }
    yield { type: 'done', mode: 'offline' }
    return
  }
  yield { type: 'status', tool: 'city_status', label: LABEL.city_status![ctx.lang] }
  const a = await askAktau(ctx.sql, { question, lang: ctx.lang, location: { installation_id: ctx.installation_id } }, ctx.now)
  yield { type: 'answer', answer: a }
  yield { type: 'done', mode: 'offline' }
}
