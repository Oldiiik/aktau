// Caspian Safety: the official registry of where swimming is permitted or
// prohibited on the Aktau coast, the temporary status an authority has set,
// and live sea conditions next to it — kept as three separate facts.
import { describeConditions, swimVerdict, type LegalStatus, type OperationalStatus, type SeaConditions, type SwimVerdict } from '@aktau/city-core'
import type { Lang } from '@aktau/types'
import { audit } from './audit.ts'
import type { Sql } from './db/client.ts'
import { getWeatherSnippet } from './now.ts'

export type CoastZoneDTO = {
  id: string
  slug: string
  legal_status: LegalStatus
  name: string
  official_text: string
  source: { authority: string; title: string; url: string; ref: string | null; revision: string; verified_at: string }
  location: { confidence: 'mapped' | 'approximate' | 'unmapped'; source: string | null; note: string | null; lat: number | null; lon: number | null }
  operational: { status: OperationalStatus; note: string | null; source: string | null; updated_at: string | null }
  rescue_post: boolean | null
}

type Row = {
  id: string; slug: string; legal_status: LegalStatus; name: string; name_ru: string; name_kk: string | null; official_text: string
  source_authority: string; source_title: string; source_url: string; source_ref: string | null; source_revision: Date; verified_at: Date
  location_confidence: CoastZoneDTO['location']['confidence']; location_source: string | null; location_note: string | null
  lat: number | null; lon: number | null
  operational_status: OperationalStatus; operational_note: string | null; operational_source: string | null; operational_updated_at: Date | null
  rescue_post: boolean | null
}

const day = (d: Date) => d.toISOString().slice(0, 10)
const nameIn = (lang: Lang, r: Row) => (lang === 'en' ? r.name : lang === 'kk' ? r.name_kk ?? r.name_ru : r.name_ru)

function toDTO(r: Row, lang: Lang): CoastZoneDTO {
  return {
    id: r.id, slug: r.slug, legal_status: r.legal_status, name: nameIn(lang, r), official_text: r.official_text,
    source: { authority: r.source_authority, title: r.source_title, url: r.source_url, ref: r.source_ref, revision: day(r.source_revision), verified_at: day(r.verified_at) },
    location: { confidence: r.location_confidence, source: r.location_source, note: r.location_note, lat: r.lat, lon: r.lon },
    operational: { status: r.operational_status, note: r.operational_note, source: r.operational_source, updated_at: r.operational_updated_at?.toISOString() ?? null },
    rescue_post: r.rescue_post,
  }
}

const ZONE_COLS = (sql: Sql) => sql`
  id, slug, legal_status, name, name_ru, name_kk, official_text, source_authority, source_title, source_url, source_ref, source_revision, verified_at,
  location_confidence, location_source, location_note,
  -- The point shown for a zone: its map location for beaches, the middle of the stretch otherwise.
  ST_Y(coalesce(case when legal_status = 'OFFICIAL' then anchor::geometry end, ST_LineInterpolatePoint(ST_LineMerge(geometry::geometry), 0.5), anchor::geometry)) lat,
  ST_X(coalesce(case when legal_status = 'OFFICIAL' then anchor::geometry end, ST_LineInterpolatePoint(ST_LineMerge(geometry::geometry), 0.5), anchor::geometry)) lon,
  operational_status, operational_note, operational_source, operational_updated_at, rescue_post`

export type CaspianState = {
  zones: CoastZoneDTO[]
  geojson: { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }> }
  conditions: SeaConditions & { wind_source: string | null; sea_source: string | null; fetched_at: string | null }
}

let shoreCache: { at: number; data: unknown[] } | null = null

/** Registry + drawable geometry + current conditions, in one response for the map. */
export async function caspianState(sql: Sql, lang: Lang, now = new Date()): Promise<CaspianState> {
  const [rows, drawn, weather] = await Promise.all([
    sql<Row[]>`select ${ZONE_COLS(sql)} from coast_zones order by legal_status, sort`,
    sql<{ id: string; geom: unknown }[]>`select id, ST_AsGeoJSON(geometry, 6)::json geom from coast_zones where geometry is not null`,
    getWeatherSnippet(sql, now, lang),
  ])
  if (!shoreCache || Date.now() - shoreCache.at > 3600_000) {
    const shore = await sql<{ geom: unknown }[]>`
      select ST_AsGeoJSON(ST_Intersection(geometry::geometry, ST_MakeEnvelope(50.6, 43.3, 51.8, 44.1, 4326)), 5)::json geom
      from coastline where not ST_IsClosed(geometry::geometry)`
    shoreCache = { at: Date.now(), data: shore.map((s) => s.geom) }
  }
  const zones = rows.map((r) => toDTO(r, lang))
  const byId = new Map(zones.map((z) => [z.id, z]))
  const props = (z: CoastZoneDTO) => ({ id: z.id, legal: z.legal_status, name: z.name, operational: z.operational.status, confidence: z.location.confidence })
  const f = weather.forecast, m = weather.marine
  return {
    zones,
    geojson: {
      type: 'FeatureCollection',
      features: [
        ...shoreCache.data.map((g) => ({ type: 'Feature' as const, geometry: g, properties: { layer: 'shore' } })),
        ...drawn.map((d) => ({ type: 'Feature' as const, geometry: d.geom, properties: { layer: 'zone', ...props(byId.get(d.id)!) } })),
        ...zones.filter((z) => z.location.lat != null && z.location.confidence !== 'unmapped')
          .map((z) => ({ type: 'Feature' as const, geometry: { type: 'Point', coordinates: [z.location.lon, z.location.lat] }, properties: { layer: 'pin', ...props(z) } })),
      ],
    },
    conditions: {
      ...describeConditions({ wind_ms: f?.wind_ms, gust_ms: f?.gust_ms, wave_m: m?.wave_height_m, sea_temp_c: m?.sea_temp_c }),
      wind_source: f ? 'Open-Meteo (model)' : null,
      sea_source: m ? 'Open-Meteo Marine (model)' : null,
      fetched_at: m?.fetched_at ?? f?.fetched_at ?? null,
    },
  }
}

export type SwimCheckDTO = {
  verdict: SwimVerdict
  zone: CoastZoneDTO | null
  distance_to_shore_m: number | null
  nearest_official: (CoastZoneDTO & { distance_m: number }) | null
}

/** "Can I swim here?" for a GPS point. Only drawn zones take part: an entry we
 *  could not place on the map can never make a spot look permitted. */
export async function canISwimHere(sql: Sql, lat: number, lon: number, lang: Lang): Promise<SwimCheckDTO> {
  const pt = sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`
  const [[shore], near, [nearest]] = await Promise.all([
    sql<{ d: number | null }[]>`select min(ST_Distance(geometry, ${pt}))::float d from coastline where not ST_IsClosed(geometry::geometry)`,
    sql<Array<Row & { distance_m: number }>>`
      select ${ZONE_COLS(sql)}, ST_Distance(geometry, ${pt})::float distance_m
      from coast_zones where geometry is not null and ST_DWithin(geometry, ${pt}, 500)`,
    sql<Array<Row & { distance_m: number }>>`
      select ${ZONE_COLS(sql)}, ST_Distance(geometry, ${pt})::float distance_m
      from coast_zones where legal_status = 'OFFICIAL' and geometry is not null and operational_status <> 'CLOSED'
      order by geometry <-> ${pt} limit 1`,
  ])
  const verdict = swimVerdict({
    distance_to_shore_m: shore?.d ?? null,
    prohibited: near.filter((z) => z.legal_status === 'PROHIBITED').map((z) => ({ id: z.id, distance_m: z.distance_m })),
    official: near.filter((z) => z.legal_status === 'OFFICIAL').map((z) => ({ id: z.id, distance_m: z.distance_m, operational: z.operational_status })),
  })
  const zoneRow = 'zone_id' in verdict ? near.find((z) => z.id === verdict.zone_id) : undefined
  return {
    verdict,
    zone: zoneRow ? toDTO(zoneRow, lang) : null,
    distance_to_shore_m: shore?.d != null ? Math.round(shore.d) : null,
    nearest_official: nearest && !(verdict.kind === 'official' && verdict.zone_id === nearest.id) ? { ...toDTO(nearest, lang), distance_m: Math.round(nearest.distance_m) } : null,
  }
}

export type ZoneStatusInput = { status: OperationalStatus; note?: string | null; source: string; rescue_post?: boolean | null }

/** Set a zone's temporary status. Only an authorised editor, always with the
 *  authority it came from, always audited. Never changes the legal status. */
export async function setZoneStatus(sql: Sql, id: string, input: ZoneStatusInput, actor: string, accountId: string | null) {
  const [before] = await sql`select operational_status, operational_note, operational_source, rescue_post from coast_zones where id = ${id}`
  if (!before) return null
  // Back to UNKNOWN clears the note and attribution (the audit log keeps the history).
  const cleared = input.status === 'UNKNOWN'
  const [after] = await sql`
    update coast_zones set operational_status = ${input.status}, operational_note = ${cleared ? null : input.note ?? null}, operational_source = ${cleared ? null : input.source},
      rescue_post = ${input.rescue_post === undefined ? sql`rescue_post` : input.rescue_post}, operational_updated_at = now(), operational_updated_by = ${accountId}
    where id = ${id} returning operational_status, operational_note, operational_source, rescue_post`
  await audit(sql, actor, 'coast_zone.status', 'coast_zone', id, before, after)
  return after
}
