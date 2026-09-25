// Ask Aktau service: question → intent → entities → structured query over our
// database → trusted rows → formatter. An LLM may only rephrase the formatted
// sentence, and the rephrasing is rejected if any number/time changes.
import Anthropic from '@anthropic-ai/sdk'
import { classifyIntent, formatUtilityAnswer, phrasingPreservesFacts, weatherCodeText } from '@aktau/city-core'
import { areaName, eventHeadline, t } from '@aktau/i18n'
import { fmtTime } from '@aktau/normalization/time'
import type { AskResponse, CityEventDTO, Lang, SourceType } from '@aktau/types'
import type { Sql } from './db/client.ts'
import { loadEvents } from './events.ts'
import { resolveLocation, type LocationInput } from './location.ts'
import { getAktauNow, getWeatherSnippet } from './now.ts'
import { isOpenNow, searchPlaces } from './places.ts'

function sourcesOf(events: CityEventDTO[]): AskResponse['sources'] {
  const seen = new Map<string, AskResponse['sources'][number]>()
  for (const e of events) {
    const name = e.reported_authority ? `${e.reported_authority}${e.primary_source.name.toUpperCase() !== e.reported_authority ? ` (via ${e.primary_source.name})` : ''}` : e.primary_source.name
    if (!seen.has(name)) seen.set(name, { name, type: e.primary_source.source_type, url: null, updated_at: e.last_confirmed_at })
  }
  return [...seen.values()]
}

async function maybePhrase(lang: Lang, question: string, message: string): Promise<{ text: string; by: 'template' | 'llm' }> {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ASK_LLM_PHRASING !== 'true') return { text: message, by: 'template' }
  try {
    const client = new Anthropic({ timeout: 8000, maxRetries: 0 })
    const r = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
      max_tokens: 200,
      system: 'Rephrase the given answer naturally in the same language. Keep every time, number, district and organisation exactly as written. Do not add information.',
      messages: [{ role: 'user', content: `Question (${lang}): ${question}\nAnswer to rephrase: ${message}` }],
    })
    const text = r.content.find((b) => b.type === 'text')?.text?.trim()
    if (text && phrasingPreservesFacts(message, text)) return { text, by: 'llm' }
  } catch { /* fall back to the template */ }
  return { text: message, by: 'template' }
}

export async function askAktau(sql: Sql, q: { question: string; lang: Lang; location: LocationInput }, now = new Date()): Promise<AskResponse> {
  const { intent, entities } = classifyIntent(q.question, now)
  const lang = q.lang
  const base = { intent, updated_at: now.toISOString(), phrased_by: 'template' as const }

  // A district named in the question overrides the saved home.
  let locInput: LocationInput = q.location
  if (entities.district) {
    const [a] = await sql<{ id: string }[]>`select id from areas where designator = ${entities.district} and area_type = 'MICRODISTRICT'`
    if (a) locInput = { area_id: a.id }
  }
  const loc = await resolveLocation(sql, locInput, lang)
  const areaLabel = loc.ctx.area?.name ?? t(lang, 'loc.city')

  switch (intent) {
    case 'UTILITY_STATUS':
    case 'UPCOMING_OUTAGE': {
      const service = entities.service ?? 'water'
      const window = entities.window ?? (intent === 'UTILITY_STATUS' ? { start: now, end: new Date(now.getTime() + 60_000), kind: 'now' as const } : { start: now, end: new Date(now.getTime() + 48 * 3600_000), kind: 'range' as const })
      const events = await loadEvents(sql, { current: true, categories: entities.categories, window: { start: window.start, end: window.end } }, loc, now)
      const direct = events.filter((e) => e.relevance === 'DIRECT')
      const area = events.filter((e) => e.relevance === 'AREA')
      if (loc.ctx.kind === 'city') {
        const msg = events.length
          ? `${events.length} × ${eventHeadline(lang, events[0]!)} — ${events.slice(0, 3).map((e) => e.areas.map((a) => a.designator ?? a.name).join(', ')).join('; ')}`
          : t(lang, 'ask.no_info.utility', { service: t(lang, `service.${service}`).toLowerCase() })
        return { ...base, answer_type: 'utility', message: msg, detail: t(lang, 'you.noHome'), confidence: events.length ? 'confirmed' : 'no_information', data: { affected: null, location: loc.ctx, events: events.map((e) => e.id) }, sources: sourcesOf(events), event_ids: events.map((e) => e.id) }
      }
      const ans = formatUtilityAnswer(lang, service, direct, area, window, areaLabel, now)
      const top = direct[0] ?? area[0] ?? null
      const phrased = await maybePhrase(lang, q.question, ans.message)
      return {
        ...base,
        answer_type: 'utility',
        message: phrased.text,
        detail: ans.detail,
        confidence: ans.affected === 'no_information' ? 'no_information' : top && ['OFFICIAL', 'VERIFIED', 'CORROBORATED'].includes(top.verification_status) ? 'confirmed' : 'reported',
        data: {
          affected: ans.affected === 'yes' ? true : ans.affected === 'area' ? 'unclear' : null,
          status: top?.display_status ?? null,
          start: top?.starts_at ?? null,
          expected_end: top?.expected_ends_at ?? null,
          service,
          location: loc.ctx,
          window: { start: window.start.toISOString(), end: window.end.toISOString() },
        },
        sources: sourcesOf(direct.length ? direct : area),
        event_ids: [...direct, ...area].map((e) => e.id),
        phrased_by: phrased.by,
      }
    }
    case 'ROAD_STATUS':
    case 'TRANSPORT': {
      const events = await loadEvents(sql, { current: true, categories: intent === 'ROAD_STATUS' ? ['ROAD'] : ['TRANSPORT'] }, loc, now)
      const msg = events.length ? events.slice(0, 3).map((e) => `${eventHeadline(lang, e)} · ${e.areas.map((a) => a.designator ? `${a.designator} mkr` : a.name).join(', ')}`).join('\n') : t(lang, 'now.calm.city')
      return { ...base, answer_type: 'events', message: msg, detail: null, confidence: events.length ? 'confirmed' : 'no_information', data: { events }, sources: sourcesOf(events), event_ids: events.map((e) => e.id) }
    }
    case 'AROUND_ME':
    case 'CITY_STATE': {
      const now2 = await getAktauNow(sql, locInput, lang, now)
      const list = [...now2.affecting, ...now2.nearby_events].slice(0, 5)
      return { ...base, answer_type: 'city_state', message: now2.headline, detail: list.map((e) => eventHeadline(lang, e)).join(' · ') || null, confidence: now2.overall === 'UNKNOWN' ? 'no_information' : 'confirmed', data: { overall: now2.overall, services: now2.services, location: now2.location }, sources: sourcesOf(list), event_ids: list.map((e) => e.id) }
    }
    case 'WEATHER': {
      const w = await getWeatherSnippet(sql, now, lang)
      const f = w.forecast
      const msg = f ? `${Math.round(f.temperature_c ?? 0)}° · ${weatherCodeText(f.weather_code, lang)} · ${t(lang, 'weather.wind', { v: Math.round(f.wind_ms ?? 0) })}${f.gust_ms ? ` (gusts ${Math.round(f.gust_ms)})` : ''}` : t(lang, 'now.unknown')
      const obs = w.observation ? t(lang, 'weather.observed', { t: Math.round(w.observation.temperature_c ?? 0), time: fmtTime(new Date(w.observation.observed_at)) }) : null
      const sources: AskResponse['sources'] = []
      if (f) sources.push({ name: 'Open-Meteo (forecast)', type: 'API', url: 'https://open-meteo.com', updated_at: f.fetched_at })
      if (w.observation) sources.push({ name: 'Kazhydromet (observation)', type: 'OFFICIAL', url: 'https://wis2box.kazhydromet.kz', updated_at: w.observation.observed_at })
      return { ...base, answer_type: 'weather', message: msg, detail: [obs, ...w.advisories.map((a) => `${a.origin === 'APP_ADVISORY' ? t(lang, 'badge.appAdvisory') : 'Kazhydromet'}: ${a.text}`)].filter(Boolean).join(' · ') || null, confidence: 'model', data: { weather: w }, sources, event_ids: w.advisories.map((a) => a.event_id) }
    }
    case 'CASPIAN': {
      const w = await getWeatherSnippet(sql, now, lang)
      const m = w.marine
      const msg = m ? `Modelled Caspian conditions: waves ${m.wave_height_m ?? '—'} m, sea ${m.sea_temp_c ?? '—'}°C.` : t(lang, 'now.unknown')
      return { ...base, answer_type: 'caspian', message: msg, detail: 'Model data — not a swimming or navigation safety status.', confidence: 'model', data: { marine: m, wind: w.forecast }, sources: m ? [{ name: 'Open-Meteo Marine (model)', type: 'API', url: 'https://open-meteo.com/en/docs/marine-weather-api', updated_at: m.fetched_at }] : [], event_ids: [] }
    }
    case 'PLACE_SEARCH': {
      const late = /after|после|кейін|night|ночь|11|23/.test(q.question.toLowerCase())
      const hits = await searchPlaces(sql, '', loc.point, { category: entities.placeCategory, limit: 12 })
      const places = hits.filter((h) => h.kind === 'place').map((h) => ({ ...h, open_now: h.kind === 'place' ? isOpenNow(h.opening_hours, now) : null }))
      const shown = late ? places.filter((p) => p.opening_hours).slice(0, 6) : places.slice(0, 6)
      return { ...base, answer_type: 'places', message: shown.length ? shown.map((p) => p.label).slice(0, 3).join(', ') : 'No matching places in our cached map data.', detail: late ? 'Opening hours from OpenStreetMap — check before you go.' : null, confidence: shown.length ? 'reported' : 'no_information', data: { places: shown }, sources: [{ name: 'OpenStreetMap', type: 'API' as SourceType, url: 'https://www.openstreetmap.org/copyright', updated_at: null }], event_ids: [] }
    }
    case 'DIRECTIONS': {
      const [airport] = await sql<{ id: string; name: string; lat: number; lon: number }[]>`select id, name, ST_Y(point::geometry) lat, ST_X(point::geometry) lon from places where category = 'airport' limit 1`
      return { ...base, answer_type: 'directions', message: airport ? `${airport.name} — about 25 km north of the city centre.` : 'Aktau International Airport — about 25 km north of the city centre.', detail: process.env.DGIS_API_KEY ? 'Route planning via 2GIS.' : 'Live public-transport routing needs the 2GIS connector; we do not show bus positions without a real feed.', confidence: 'reported', data: { destination: airport ?? { name: 'Aktau International Airport', lat: 43.8601, lon: 51.0922 }, open_in: `https://2gis.kz/aktau/directions/points/%7C${airport?.lon ?? 51.0922}%2C${airport?.lat ?? 43.8601}` }, sources: [{ name: 'OpenStreetMap', type: 'API', url: null, updated_at: null }], event_ids: [] }
    }
    case 'EVENT_SEARCH': {
      const events = await loadEvents(sql, { current: true, categories: ['EVENT'], window: entities.window ? { start: entities.window.start, end: entities.window.end } : undefined }, loc, now)
      return { ...base, answer_type: 'events', message: events.length ? events.map((e) => e.title).join(' · ') : 'No city events are listed for that time yet.', detail: null, confidence: events.length ? 'confirmed' : 'no_information', data: { events }, sources: sourcesOf(events), event_ids: events.map((e) => e.id) }
    }
    default:
      return { ...base, intent: 'UNKNOWN', answer_type: 'unknown', message: 'I can answer about water, electricity, heating, roads, weather, the Caspian, places and what’s happening near you.', detail: null, confidence: 'no_information', data: { location: loc.ctx, district: areaName(lang, { name: areaLabel }) }, sources: [], event_ids: [] }
  }
}
