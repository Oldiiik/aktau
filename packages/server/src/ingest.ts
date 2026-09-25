// INGEST → PRESERVE RAW → EXTRACT → (review) → PUBLISH
// Each connector runs in isolation with its own fetch-run record; a failing
// source is logged and skipped, never fatal to the others.
import { createHash } from 'node:crypto'
import { computeAdvisories } from '@aktau/city-core'
import {
  AKTAU_STATION, connectorFor, CONNECTORS, fetchOverpassPlaces, type AfishaEvent, type CinemaSchedule, type ForecastPayload, type NewsPayload, type PlaceRecord, type RawSourceItem,
  type SourceConnector,
} from '@aktau/connectors'
import { extractCandidates, PARSER_VERSION } from '@aktau/normalization'
import type { Extraction } from '@aktau/types'
import { audit } from './audit.ts'
import { cacheSet } from './cache.ts'
import type { Sql } from './db/client.ts'
import { log } from './log.ts'
import { adminUpdateEvent, publishCandidate, scoreCandidateDuplicates } from './publish.ts'
import { notifyEventChange } from './notify.ts'
import { incidentSweep } from './incidents.ts'

type SourceRow = { id: string; slug: string; name: string; source_type: string; authority_level: number; adapter_type: string; enabled: boolean }

export function contentHash(item: { title?: string | null; raw_text: string }): string {
  return createHash('sha256').update(`${item.title ?? ''}\n${item.raw_text.replace(/\s+/g, ' ').trim()}`).digest('hex')
}

async function sourceBySlug(sql: Sql, slug: string): Promise<SourceRow> {
  const [s] = await sql<SourceRow[]>`select id, slug, name, source_type, authority_level, adapter_type, enabled from sources where slug = ${slug}`
  if (!s) throw new Error(`Unknown source ${slug}`)
  return s
}

/** Stores a raw item; returns null when it is a duplicate (same external id or same content). */
export async function storeItem(sql: Sql, source: SourceRow, item: RawSourceItem, extra: { submitted_by?: string; is_demo?: boolean; fetched_at?: Date } = {}) {
  // Demo copies of a text must never collide with (or be merged into) the real item.
  const hash = contentHash(item) + (extra.is_demo ? ':demo' : '')
  const rows = await sql<{ id: string }[]>`
    insert into source_items (source_id, external_id, canonical_url, title, raw_text, raw_html, raw_json, language, published_at, source_updated_at,
      content_hash, parser_version, processing_status, reported_authority, submitted_by, is_demo, fetched_at)
    values (${source.id}, ${item.external_id ?? null}, ${item.canonical_url ?? null}, ${item.title ?? null}, ${item.raw_text}, ${item.raw_html ?? null},
      ${item.raw_json == null ? null : sql.json(item.raw_json as never)}, ${item.language ?? null}, ${item.published_at ?? null}, ${item.source_updated_at ?? null},
      ${hash}, ${item.extractable ? PARSER_VERSION : null}, ${item.extractable ? 'NEW' : 'IGNORED'}, ${item.reported_authority ?? null},
      ${extra.submitted_by ?? null}, ${extra.is_demo ?? false}, coalesce(${extra.fetched_at ?? null}::timestamptz, now()))
    on conflict do nothing
    returning id`
  return rows[0]?.id ?? null
}

/** Runs deterministic (+ optional LLM) extraction for a stored item and records candidates. */
export async function extractItem(sql: Sql, sourceItemId: string, opts: { llm?: boolean; autoApprove?: boolean } = {}) {
  const [it] = await sql<{ id: string; raw_text: string; title: string | null; published_at: Date | null; fetched_at: Date; reported_authority: string | null; source_type: string; slug: string }[]>`
    select si.id, si.raw_text, si.title, si.published_at, si.fetched_at, si.reported_authority, s.source_type, s.slug
    from source_items si join sources s on s.id = si.source_id where si.id = ${sourceItemId}`
  if (!it) throw new Error('source item not found')
  try {
    const candidates = await extractCandidates(
      { text: it.raw_text, title: it.title, published_at: it.published_at, fetched_at: it.fetched_at, reported_authority: it.reported_authority },
      { llm: opts.llm === false ? false : undefined },
    )
    const ids: string[] = []
    for (const c of candidates) {
      const [row] = await sql<{ id: string }[]>`
        insert into event_candidates (source_item_id, segment_index, segment_text, extracted, extractor, parser_version, confidence, validation_errors, warnings, status)
        values (${it.id}, ${c.segment_index}, ${c.segment_text}, ${sql.json(c.extraction as never)}, ${c.extractor}, ${c.parser_version}, ${c.extraction.confidence},
          ${sql.json(c.errors as never)}, ${sql.json(c.warnings as never)}, 'REVIEW_REQUIRED')
        on conflict (source_item_id, segment_index) do update set extracted = excluded.extracted, extractor = excluded.extractor,
          parser_version = excluded.parser_version, confidence = excluded.confidence, validation_errors = excluded.validation_errors, warnings = excluded.warnings
        where event_candidates.status = 'REVIEW_REQUIRED'
        returning id`
      if (!row) continue
      ids.push(row.id)
      await scoreCandidateDuplicates(sql, row.id)
      // Optional auto-publish: only rules-only, error-free, high-confidence
      // candidates from an official source. Off unless AUTO_PUBLISH_OFFICIAL=true.
      const officialSource = it.source_type === 'OFFICIAL' || it.source_type === 'GOVERNMENT'
      if ((opts.autoApprove ?? process.env.AUTO_PUBLISH_OFFICIAL === 'true') && officialSource && !c.review_required && c.extraction.confidence >= 0.9) {
        await publishCandidate(sql, row.id, { actor: `connector:${it.slug}`, autoApproved: true }).catch((e) => log('warn', 'auto_publish.failed', { candidate: row.id, err: e }))
      }
    }
    const hasOpen = candidates.some((c) => c.review_required) || !opts.autoApprove
    await sql`update source_items set processing_status = ${candidates.length ? (hasOpen ? 'REVIEW_REQUIRED' : 'EXTRACTED') : 'IGNORED'}, processing_error = null,
      parser_version = ${candidates[0]?.parser_version ?? PARSER_VERSION} where id = ${it.id} and processing_status <> 'EXTRACTED'`
    log('info', 'extract.done', { source_item: it.id, candidates: candidates.length, review: candidates.filter((c) => c.review_required).length })
    return ids
  } catch (err) {
    await sql`update source_items set processing_status = 'FAILED', processing_error = ${(err as Error).message.slice(0, 500)} where id = ${it.id}`
    log('error', 'extract.failed', { source_item: it.id, err })
    throw err
  }
}

/** Admin ingestion panel: paste an announcement → raw item → candidates for review. */
export async function ingestManual(sql: Sql, input: { source_slug: string; text: string; title?: string; url?: string; published_at?: string; reported_authority?: string; actor: string; is_demo?: boolean; now?: Date }) {
  const source = await sourceBySlug(sql, input.source_slug)
  const connector = connectorFor(source.slug)
  const item: RawSourceItem = connector?.normalizeRaw
    ? connector.normalizeRaw({ text: input.text, title: input.title, url: input.url, published_at: input.published_at, reported_authority: input.reported_authority })
    : { raw_text: input.text, title: input.title ?? null, canonical_url: input.url ?? null, published_at: input.published_at ? new Date(input.published_at) : null, reported_authority: input.reported_authority ?? null, extractable: true }
  item.extractable = true
  let id = await storeItem(sql, source, item, { submitted_by: input.actor, is_demo: input.is_demo, fetched_at: input.now })
  let duplicate = false
  if (!id) {
    duplicate = true
    const [existing] = await sql<{ id: string }[]>`select id from source_items where source_id = ${source.id} and content_hash = ${contentHash(item) + (input.is_demo ? ':demo' : '')}`
    id = existing!.id
  }
  await audit(sql, input.actor, 'source_item.ingest', 'source_item', id, null, { source: source.slug, duplicate, chars: input.text.length })
  const candidateIds = await extractItem(sql, id)
  return { source_item_id: id, duplicate, candidate_ids: candidateIds }
}

// ── Connector runs ──────────────────────────────────────────────────────────
export async function runSource(sql: Sql, slug: string, now = new Date()) {
  const source = await sourceBySlug(sql, slug)
  const connector = CONNECTORS[slug]
  if (!connector) return { slug, status: 'SKIPPED' as const, note: 'no connector' }
  const health = await connector.healthCheck()
  if (!source.enabled || health.mode !== 'automated') {
    await sql`update sources set last_attempt_at = ${now} where id = ${source.id}`
    return { slug, status: 'SKIPPED' as const, note: health.detail }
  }
  const [run] = await sql<{ id: string }[]>`insert into source_fetch_runs (source_id, started_at) values (${source.id}, ${now}) returning id`
  const t0 = Date.now()
  try {
    const result = await connector.fetch({
      now,
      alreadyHave: async (ext) => (await sql`select 1 from source_items where source_id = ${source.id} and external_id = ${ext}`).length > 0,
    })
    let fresh = 0
    for (const item of result.items) {
      const id = await storeItem(sql, source, item)
      if (id) fresh++
      await postProcess(sql, source, connector, item, id, now)
      if (id && item.extractable) await extractItem(sql, id).catch(() => {})
    }
    await sql`update source_fetch_runs set finished_at = now(), status = 'SUCCESS', items_found = ${result.items.length}, items_new = ${fresh},
      http_status = ${result.http_status ?? null}, duration_ms = ${Date.now() - t0}, error = ${result.notes ?? null} where id = ${run!.id}`
    await sql`update sources set last_attempt_at = ${now}, last_successful_fetch_at = ${now} where id = ${source.id}`
    await sql`insert into realtime_outbox (topic, kind, payload) values ('sources', 'refreshed', ${sql.json({ slug })})`
    log('info', 'connector.fetch', { slug, items: result.items.length, new: fresh, ms: Date.now() - t0 })
    return { slug, status: 'SUCCESS' as const, items: result.items.length, new: fresh, note: result.notes }
  } catch (err) {
    const e = err as Error & { status?: number }
    await sql`update source_fetch_runs set finished_at = now(), status = 'FAILED', error = ${e.message.slice(0, 500)}, http_status = ${e.status ?? null},
      duration_ms = ${Date.now() - t0} where id = ${run!.id}`
    await sql`update sources set last_attempt_at = ${now} where id = ${source.id}`
    log('warn', 'connector.failed', { slug, err: e })
    return { slug, status: 'FAILED' as const, error: e.message }
  }
}

export async function runJob(sql: Sql, job: SourceConnector['job'] | 'lifecycle') {
  if (job === 'lifecycle') return [{ slug: 'lifecycle', ...(await lifecycleSweep(sql)) }]
  const slugs = Object.values(CONNECTORS).filter((c) => c.job === job).map((c) => c.slug)
  const results = []
  for (const slug of slugs) results.push(await runSource(sql, slug)) // sequential: be polite to shared infra
  return results
}

// ── Per-source post-processing of structured (non-text) data ────────────────
async function postProcess(sql: Sql, source: SourceRow, connector: SourceConnector, item: RawSourceItem, itemId: string | null, now: Date) {
  const json = item.raw_json as Record<string, any>
  switch (connector.slug) {
    case 'open_meteo':
      await cacheSet(sql, 'open_meteo', 'forecast:aktau', json, 600, now)
      await syncWeatherAdvisories(sql, source, json as ForecastPayload, itemId, now)
      break
    case 'open_meteo_marine':
      await cacheSet(sql, 'open_meteo_marine', 'marine:aktau', json, 3600, now)
      break
    case 'open_meteo_air':
      await cacheSet(sql, 'open_meteo_air', 'air:aktau', json, 3600, now)
      break
    case 'kazhydromet_wis2': {
      const r = json.report
      await sql`insert into weather_observations (source_id, station_id, station_name, point, observed_at, air_temperature_c, dewpoint_c, wind_speed_ms,
          wind_direction_deg, wind_gust_ms, pressure_msl_hpa, precipitation_mm, present_weather, raw)
        values (${source.id}, ${AKTAU_STATION.id}, ${AKTAU_STATION.name}, ST_SetSRID(ST_MakePoint(${AKTAU_STATION.lon}, ${AKTAU_STATION.lat}), 4326)::geography,
          ${r.observed_at}, ${r.air_temperature_c}, ${r.dewpoint_c}, ${r.wind_speed_ms}, ${r.wind_direction_deg}, ${r.wind_gust_ms}, ${r.pressure_msl_hpa},
          ${r.precipitation_mm}, ${r.present_weather}, ${sql.json(r)})
        on conflict (source_id, station_id, observed_at) do nothing`
      break
    }
    case 'osm_overpass':
      await upsertPlaces(sql, source.id, (json.places ?? []) as PlaceRecord[])
      break
    case 'kinoafisha': {
      // The cinema's day replaces what we had for it: a session it dropped disappears.
      const d = json.schedule as CinemaSchedule
      const from = new Date(`${d.date}T06:00:00+05:00`)
      const to = new Date(from.getTime() + 86400_000)
      await sql`delete from cinema_sessions where source_id = ${source.id} and cinema_id = ${d.cinema_id} and starts_at >= ${from} and starts_at < ${to}`
      const rows = d.films.flatMap((f) => f.sessions.map((x) => ({
        cinema_id: d.cinema_id, cinema_name: d.cinema_name, cinema_address: d.cinema_address, film_id: f.film_id, film_title: f.title, film_url: f.url,
        genres: f.genres, details: f.details, poster_url: f.poster, starts_at: x.starts_at, format: x.format, language: x.language, price_from: x.price_from,
      })))
      if (rows.length) {
        await sql`
          insert into cinema_sessions (source_id, cinema_id, cinema_name, cinema_address, film_id, film_title, film_url, genres, details, poster_url, starts_at, format, language, price_from)
          select ${source.id}, x.cinema_id, x.cinema_name, x.cinema_address, x.film_id, x.film_title, x.film_url, x.genres, x.details, x.poster_url, x.starts_at, x.format, x.language, x.price_from
          from jsonb_to_recordset(${sql.json(rows as never)}) as x(cinema_id text, cinema_name text, cinema_address text, film_id text, film_title text, film_url text,
            genres text, details text, poster_url text, starts_at timestamptz, format text, language text, price_from int)
          on conflict (source_id, cinema_id, film_id, starts_at, format) do update set price_from = excluded.price_from, poster_url = excluded.poster_url, fetched_at = now()`
      }
      break
    }
    case 'sxodim':
    case 'inaktau':
    case 'topbilet': {
      const e = json.event as AfishaEvent
      await sql`
        insert into afisha_events (source_id, external_id, url, ticket_url, title, category, summary, image_url, venue, address, starts_at, sessions, ends_at, price_from)
        values (${source.id}, ${e.external_id}, ${e.url}, ${e.ticket_url}, ${e.title}, ${e.category}, ${e.summary}, ${e.image_url}, ${e.venue}, ${e.address},
          ${e.sessions[0]!}, ${e.sessions}::timestamptz[], ${e.ends_at}, ${e.price_from})
        on conflict (source_id, external_id) do update set url = excluded.url, ticket_url = excluded.ticket_url, title = excluded.title, category = excluded.category,
          summary = excluded.summary, image_url = excluded.image_url, venue = excluded.venue, address = excluded.address, starts_at = excluded.starts_at,
          sessions = excluded.sessions, ends_at = excluded.ends_at, price_from = excluded.price_from, fetched_at = now()`
      break
    }
    case 'lada_news': {
      const n = json.news as NewsPayload
      await sql`insert into news_articles (source_id, source_item_id, external_id, url, headline, lede, author, image_url, image_width, image_height, section, language, published_at)
        values (${source.id}, ${itemId}, ${item.external_id!}, ${n.url}, ${n.headline}, ${n.lede}, ${n.author}, ${n.image?.url ?? null}, ${n.image?.width ?? null},
          ${n.image?.height ?? null}, ${n.section}, ${item.language ?? 'ru'}, ${n.published_at})
        on conflict (source_id, external_id) do update set headline = excluded.headline, lede = excluded.lede, image_url = excluded.image_url, fetched_at = now()`
      await sql`insert into realtime_outbox (topic, kind, payload) values ('news', 'published', ${sql.json({ external_id: item.external_id })})`
      break
    }
  }
}

export async function upsertPlaces(sql: Sql, sourceId: string, places: PlaceRecord[]) {
  for (let i = 0; i < places.length; i += 200) {
    const chunk = places.slice(i, i + 200)
    await sql`
      insert into places (source_id, external_id, name, name_kk, name_ru, name_en, category, point, address, opening_hours, phone, website, rating, review_count, raw, fetched_at)
      select ${sourceId}, x.external_id, x.name, x.name_kk, x.name_ru, x.name_en, x.category, ST_SetSRID(ST_MakePoint(x.lon, x.lat), 4326)::geography,
        x.address, x.opening_hours, x.phone, x.website, x.rating, x.review_count, x.raw, now()
      from jsonb_to_recordset(${sql.json(chunk as never)}) as x(external_id text, name text, name_kk text, name_ru text, name_en text, category text,
        lat float8, lon float8, address text, opening_hours text, phone text, website text, rating numeric, review_count int, raw jsonb)
      on conflict (source_id, external_id) do update set name = excluded.name, category = excluded.category, point = excluded.point,
        address = excluded.address, opening_hours = excluded.opening_hours, phone = excluded.phone, website = excluded.website, raw = excluded.raw, fetched_at = now()`
  }
  await sql`update places p set area_id = a.id from areas a where p.area_id is null and a.area_type = 'MICRODISTRICT' and ST_Covers(a.geometry, p.point)`
}

/** Offline seeding of places when the live Overpass refresh is unavailable. */
export async function refreshPlacesNow(sql: Sql) {
  const source = await sourceBySlug(sql, 'osm_overpass')
  const { places } = await fetchOverpassPlaces()
  await upsertPlaces(sql, source.id, places)
  return places.length
}

/**
 * Threshold advisories from the forecast. Labelled APP_ADVISORY, attributed to
 * Open-Meteo as the data source, updated in place, closed when the forecast
 * no longer exceeds the threshold.
 */
async function syncWeatherAdvisories(sql: Sql, source: SourceRow, forecast: ForecastPayload, itemId: string | null, now: Date) {
  const advisories = computeAdvisories(forecast.hourly, now)
  const open = await sql<{ id: string; event_type: string; starts_at: Date; expected_ends_at: Date }[]>`
    select id, event_type, starts_at, expected_ends_at from city_events
    where category = 'WEATHER' and advisory_origin = 'APP_ADVISORY' and status not in ('RESOLVED', 'CANCELLED') and is_demo = false`
  const [city] = await sql<{ id: string }[]>`select id from areas where slug = 'aktau'`
  const itemRef = itemId ?? (await sql<{ id: string }[]>`select id from source_items where source_id = ${source.id} order by fetched_at desc limit 1`)[0]?.id ?? null
  for (const a of advisories) {
    const existing = open.find((o) => o.event_type === a.kind)
    if (existing) {
      if (Math.abs(existing.expected_ends_at.getTime() - a.ends_at.getTime()) >= 3600_000) {
        await sql`update city_events set starts_at = ${a.starts_at}, expected_ends_at = ${a.ends_at}, summary = ${a.text}, last_confirmed_at = ${now}, severity = ${a.severity} where id = ${existing.id}`
        await sql`insert into city_event_updates (event_id, source_item_id, update_type, previous_expected_end, new_expected_end, message, actor)
          values (${existing.id}, ${itemRef}, 'ETA_CHANGED', ${existing.expected_ends_at}, ${a.ends_at}, ${`Forecast window updated: ${a.text}`}, 'connector:open_meteo')`
      } else await sql`update city_events set last_confirmed_at = ${now} where id = ${existing.id}`
      continue
    }
    if (!itemRef) continue
    const status = a.starts_at <= now ? 'ACTIVE' : 'SCHEDULED'
    const [ev] = await sql<{ id: string }[]>`
      insert into city_events (category, event_type, title, summary, status, severity, starts_at, expected_ends_at, confidence, verification_status,
        advisory_origin, primary_source_id, created_from_source_item_id, time_text, last_confirmed_at)
      values ('WEATHER', ${a.kind}, ${`Aktau app advisory: ${a.text}`}, ${a.text}, ${status}, ${a.severity}, ${a.starts_at}, ${a.ends_at}, 0.6, 'VERIFIED',
        'APP_ADVISORY', ${source.id}, ${itemRef}, ${`Model forecast; threshold ${a.kind === 'wind_advisory' ? '15 m/s gusts' : 'see policy'}`}, ${now})
      returning id`
    if (city) await sql`insert into event_areas (event_id, area_id, coverage_type) values (${ev!.id}, ${city.id}, 'FULL')`
    await sql`insert into event_sources (event_id, source_item_id, relationship) values (${ev!.id}, ${itemRef}, 'PRIMARY')`
    const [u] = await sql<{ id: string }[]>`insert into city_event_updates (event_id, source_item_id, update_type, new_status, new_expected_end, message, actor)
      values (${ev!.id}, ${itemRef}, 'CREATED', ${status}, ${a.ends_at}, 'Forecast exceeds the Aktau app advisory threshold.', 'connector:open_meteo') returning id`
    await notifyEventChange(sql, ev!.id, 'CREATED', u!.id).catch(() => {})
  }
  for (const o of open) {
    if (!advisories.some((a) => a.kind === o.event_type)) {
      await adminUpdateEvent(sql, o.id, { status: 'RESOLVED', message: 'Forecast no longer exceeds the advisory threshold.' }, 'connector:open_meteo')
    }
  }
}

// ── Lifecycle sweep (every 5 min) ───────────────────────────────────────────
export async function lifecycleSweep(sql: Sql, now = new Date()) {
  const due = await sql<{ id: string }[]>`
    update city_events set status = 'ACTIVE'
    where status = 'SCHEDULED' and starts_at <= ${now} and (expected_ends_at is null or expected_ends_at > ${now})
    returning id`
  for (const e of due) {
    const [u] = await sql<{ id: string }[]>`insert into city_event_updates (event_id, update_type, previous_status, new_status, message, actor)
      values (${e.id}, 'STATUS_CHANGED', 'SCHEDULED', 'ACTIVE', 'Scheduled start time reached (per the source announcement).', 'system:schedule') returning id`
    await notifyEventChange(sql, e.id, 'STATUS_CHANGED', u!.id).catch(() => {})
  }
  await sql`delete from api_cache where expires_at < ${new Date(now.getTime() - 7 * 86400_000)}`
  await sql`delete from rate_limits where window_start < ${new Date(now.getTime() - 86400_000)}`
  await sql`delete from realtime_outbox where created_at < ${new Date(now.getTime() - 3 * 86400_000)}`
  // What's on: yesterday's sessions and finished shows are gone.
  await sql`delete from cinema_sessions where starts_at < ${new Date(now.getTime() - 2 * 86400_000)}`
  await sql`delete from afisha_events where coalesce(ends_at, (select max(x) from unnest(sessions) x), starts_at) < ${new Date(now.getTime() - 3 * 86400_000)}`
  // 109 incidents: priority follows how long a problem has lasted.
  const incidents = await incidentSweep(sql, now).catch((err) => { log('warn', 'lifecycle.incidents_failed', { err }); return null })
  return { status: 'SUCCESS' as const, activated: due.length, ...(incidents ?? {}) }
}

export type { Extraction }
