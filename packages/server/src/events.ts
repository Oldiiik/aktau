// Reading city events as public DTOs, with per-location relevance.
import { displayStatus, doesEventAffectLocation, eventFreshness, isCurrent } from '@aktau/city-core'
import type { AreaRef, BuildingRef, CityEventDTO, CityEventDetailDTO, EventUpdateDTO, SourceRef, SourceType } from '@aktau/types'
import type { Sql } from './db/client.ts'
import type { ResolvedLocation } from './location.ts'

type Row = {
  id: string; category: CityEventDTO['category']; event_type: string; title: string; summary: string | null; status: CityEventDTO['status']
  severity: CityEventDTO['severity']; starts_at: Date | null; expected_ends_at: Date | null; actual_ends_at: Date | null; reason: string | null
  official_eta: boolean; confidence: number; verification_status: CityEventDTO['verification_status']; advisory_origin: CityEventDTO['advisory_origin']
  reported_authority: string | null; time_text: string | null; location_text: string | null; last_confirmed_at: Date; is_demo: boolean
  created_at: Date; updated_at: Date; resolved_at: Date | null
  source_slug: string; source_name: string; source_type: SourceType
  areas: AreaRef[]; buildings: BuildingRef[]; building_count: number
  distance_m: number | null; geometry_covers: boolean | null
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export type EventFilter = {
  ids?: string[]
  current?: boolean
  includeResolvedSince?: Date
  resolvedSince?: Date
  categories?: string[]
  window?: { start: Date; end: Date }
  areaIds?: string[]
  limit?: number
}

/**
 * Loads events and projects them to DTOs. When `loc` is given, each event gets
 * relevance (DIRECT / AREA / NEARBY / NO) and distance via PostGIS.
 */
export async function loadEvents(sql: Sql, filter: EventFilter, loc: ResolvedLocation | null, now = new Date()): Promise<CityEventDTO[]> {
  const lat = loc?.point?.lat ?? null
  const lon = loc?.point?.lon ?? null
  const rows = await sql<Row[]>`
    with pt as (select case when ${lat}::float8 is null then null else ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326)::geography end as g)
    select e.*, s.slug as source_slug, s.name as source_name, s.source_type,
      coalesce((select json_agg(json_build_object('id', a.id, 'slug', a.slug, 'name', a.name, 'name_ru', a.name_ru, 'name_kk', a.name_kk,
                 'designator', a.designator, 'coverage', ea.coverage_type) order by a.designator)
               from event_areas ea join areas a on a.id = ea.area_id where ea.event_id = e.id), '[]'::json) as areas,
      coalesce((select json_agg(json_build_object('id', b.id, 'area_id', b.area_id, 'house_number', b.house_number, 'display_address', b.display_address)
                 order by length(b.house_number_norm), b.house_number_norm)
               from event_buildings eb join buildings b on b.id = eb.building_id where eb.event_id = e.id), '[]'::json) as buildings,
      (select count(*)::int from event_buildings eb where eb.event_id = e.id) as building_count,
      case when (select g from pt) is null then null else least(
        (select min(ST_Distance(a.geometry, (select g from pt))) from event_areas ea join areas a on a.id = ea.area_id
          where ea.event_id = e.id and ea.coverage_type <> 'BUILDINGS_ONLY'),
        (select min(ST_Distance(b.point, (select g from pt))) from event_buildings eb join buildings b on b.id = eb.building_id where eb.event_id = e.id),
        case when e.geometry is null then null else greatest(0, ST_Distance(e.geometry, (select g from pt)) - coalesce(e.radius_m, 0)) end
      ) end as distance_m,
      case when e.geometry is null or (select g from pt) is null then false
           else ST_DWithin(e.geometry, (select g from pt), coalesce(e.radius_m, 0)) end as geometry_covers
    from city_events e
    join sources s on s.id = e.primary_source_id
    where true
      ${filter.ids ? sql`and e.id = any(${filter.ids}::uuid[])` : sql``}
      ${filter.resolvedSince ? sql`and e.status = 'RESOLVED' and e.resolved_at >= ${filter.resolvedSince}` : sql``}
      ${filter.categories?.length ? sql`and e.category::text = any(${filter.categories}::text[])` : sql``}
      ${filter.current ? sql`and (e.status not in ('RESOLVED', 'CANCELLED') ${filter.includeResolvedSince ? sql`or e.resolved_at >= ${filter.includeResolvedSince}` : sql``})` : sql``}
      ${filter.window ? sql`and (e.starts_at is null or e.starts_at < ${filter.window.end}) and (coalesce(e.actual_ends_at, e.expected_ends_at) is null or coalesce(e.actual_ends_at, e.expected_ends_at) > ${filter.window.start})` : sql``}
      ${filter.areaIds?.length ? sql`and exists (select 1 from event_areas ea where ea.event_id = e.id and ea.area_id = any(${filter.areaIds}::uuid[]))` : sql``}
    order by coalesce(e.starts_at, e.created_at) asc
    limit ${filter.limit ?? 300}`

  const out: CityEventDTO[] = []
  for (const r of rows) {
    const fin = { status: r.status, starts_at: r.starts_at, expected_ends_at: r.expected_ends_at, last_confirmed_at: r.last_confirmed_at, source_type: r.source_type }
    if (filter.current && r.status !== 'RESOLVED' && r.status !== 'CANCELLED' && !isCurrent(fin, now)) continue
    const dto: CityEventDTO = {
      id: r.id, category: r.category, event_type: r.event_type, title: r.title, summary: r.summary, status: r.status,
      display_status: displayStatus(fin, now), severity: r.severity, starts_at: iso(r.starts_at), expected_ends_at: iso(r.expected_ends_at),
      actual_ends_at: iso(r.actual_ends_at), reason: r.reason, official_eta: r.official_eta, confidence: r.confidence,
      verification_status: r.verification_status, advisory_origin: r.advisory_origin, reported_authority: r.reported_authority,
      primary_source: { slug: r.source_slug, name: r.source_name, source_type: r.source_type }, time_text: r.time_text, location_text: r.location_text,
      last_confirmed_at: r.last_confirmed_at.toISOString(), freshness: eventFreshness(fin, now), is_demo: r.is_demo,
      created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(), resolved_at: iso(r.resolved_at),
      areas: r.areas, buildings: r.buildings.slice(0, 60), building_count: r.building_count, deep_link: `aktau://event/${r.id}`,
    }
    if (loc) {
      // Relevance describes the footprint ("did/does this touch my home?"); a
      // resolved event keeps it so Home can say "Back to normal". Whether it is
      // still happening is display_status's job.
      const closed = r.status === 'RESOLVED' || r.status === 'CANCELLED'
      const m = doesEventAffectLocation(
        { status: closed ? 'ACTIVE' : r.status, category: r.category, areas: r.areas.map((a) => ({ area_id: a.id, coverage: a.coverage })), building_ids: r.buildings.map((b) => b.id), geometry_covers_location: !!r.geometry_covers, distance_m: r.distance_m },
        { building_id: loc.building_id, area_ids: loc.area_ids },
      )
      dto.relevance = m.relevance
      dto.relevance_reason = m.reason
      dto.distance_m = r.distance_m == null ? null : Math.round(r.distance_m)
    }
    out.push(dto)
  }
  return out
}

export async function loadEventDetail(sql: Sql, id: string, loc: ResolvedLocation | null): Promise<CityEventDetailDTO | null> {
  const [e] = await loadEvents(sql, { ids: [id] }, loc)
  if (!e) return null
  const updates = await sql<(Omit<EventUpdateDTO, 'created_at' | 'previous_expected_end' | 'new_expected_end'> & { created_at: Date; previous_expected_end: Date | null; new_expected_end: Date | null })[]>`
    select id, update_type, previous_status, new_status, previous_expected_end, new_expected_end, message, actor, created_at
    from city_event_updates where event_id = ${id} order by seq desc`
  const sources = await sql<(Omit<SourceRef, 'published_at' | 'fetched_at'> & { published_at: Date | null; fetched_at: Date })[]>`
    select source_item_id, relationship, source_slug, source_name, source_type, authority_level, title, canonical_url,
      published_at, fetched_at, reported_authority, excerpt
    from public_event_evidence where event_id = ${id} order by linked_at asc`
  return {
    ...e,
    buildings: (await sql<BuildingRef[]>`select b.id, b.area_id, b.house_number, b.display_address from event_buildings eb join buildings b on b.id = eb.building_id
      where eb.event_id = ${id} order by length(b.house_number_norm), b.house_number_norm`),
    updates: updates.map((u) => ({ ...u, created_at: u.created_at.toISOString(), previous_expected_end: iso(u.previous_expected_end), new_expected_end: iso(u.new_expected_end) })),
    sources: sources.map((s) => ({ ...s, published_at: iso(s.published_at), fetched_at: s.fetched_at.toISOString() })),
  }
}
