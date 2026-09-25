// GeoJSON for MapLibre layers (fill / line / circle / symbol) — no per-marker
// DOM nodes. District-wide incidents render as polygons; building-limited
// incidents render as the listed buildings, never as the whole district.
import { eventHeadline } from '@aktau/i18n'
import type { Lang } from '@aktau/types'
import type { Sql } from './db/client.ts'
import { loadEvents } from './events.ts'
import type { ResolvedLocation } from './location.ts'

type Feature = { type: 'Feature'; id?: string | number; geometry: unknown; properties: Record<string, unknown> }

export async function mapEventsGeoJSON(sql: Sql, lang: Lang, loc: ResolvedLocation | null, categories?: string[]) {
  const events = await loadEvents(sql, { current: true, categories }, loc)
  const ids = events.map((e) => e.id)
  if (!ids.length) return { type: 'FeatureCollection', features: [] as Feature[], events: [] }
  const polys = await sql<{ event_id: string; area_id: string; coverage: string; geom: unknown }[]>`
    select ea.event_id, ea.area_id, ea.coverage_type coverage, ST_AsGeoJSON(a.geometry, 6)::json geom
    from event_areas ea join areas a on a.id = ea.area_id
    where ea.event_id = any(${ids}::uuid[]) and ea.coverage_type <> 'BUILDINGS_ONLY' and a.area_type <> 'CITY' and a.geometry is not null`
  const pts = await sql<{ event_id: string; house_number: string; geom: unknown }[]>`
    select eb.event_id, b.house_number, ST_AsGeoJSON(b.point, 6)::json geom
    from event_buildings eb join buildings b on b.id = eb.building_id where eb.event_id = any(${ids}::uuid[]) and b.point is not null`
  const markers = await sql<{ event_id: string; geom: unknown }[]>`
    select e.id event_id, ST_AsGeoJSON(coalesce(
      (select ST_Centroid(ST_Collect(b.point::geometry)) from event_buildings eb join buildings b on b.id = eb.building_id where eb.event_id = e.id and b.point is not null),
      (select ST_PointOnSurface(ST_Union(a.geometry::geometry)) from event_areas ea join areas a on a.id = ea.area_id where ea.event_id = e.id and a.area_type <> 'CITY' and a.geometry is not null),
      e.geometry::geometry
    ), 6)::json geom
    from city_events e where e.id = any(${ids}::uuid[])`
  const byId = new Map(events.map((e) => [e.id, e]))
  const props = (id: string) => {
    const e = byId.get(id)!
    return {
      event_id: id, category: e.category, status: e.display_status, severity: e.severity, relevance: e.relevance ?? 'NO', title: eventHeadline(lang, e),
      is_demo: e.is_demo, planned: e.display_status === 'SCHEDULED',
    }
  }
  const features: Feature[] = [
    ...polys.map((p) => ({ type: 'Feature' as const, geometry: p.geom, properties: { ...props(p.event_id), layer: 'area', coverage: p.coverage } })),
    ...pts.map((p) => ({ type: 'Feature' as const, geometry: p.geom, properties: { ...props(p.event_id), layer: 'building', house: p.house_number } })),
    ...markers.filter((m) => m.geom).map((m) => ({ type: 'Feature' as const, geometry: m.geom, properties: { ...props(m.event_id), layer: 'marker' } })),
  ]
  return { type: 'FeatureCollection', features, events }
}

let areasCache: { at: number; data: unknown } | null = null
export async function areasGeoJSON(sql: Sql) {
  if (areasCache && Date.now() - areasCache.at < 3600_000) return areasCache.data
  const rows = await sql<{ id: string; slug: string; name: string; name_ru: string | null; name_kk: string | null; designator: string | null; geom: unknown; label: unknown }[]>`
    select id, slug, name, name_ru, name_kk, designator, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry::geometry, 0.00005), 6)::json geom,
      ST_AsGeoJSON(centroid, 6)::json label
    from areas where area_type = 'MICRODISTRICT' and geometry is not null`
  const data = {
    type: 'FeatureCollection',
    features: rows.flatMap((r) => [
      { type: 'Feature', id: r.slug, geometry: r.geom, properties: { kind: 'outline', slug: r.slug, designator: r.designator, name: r.name, name_ru: r.name_ru, name_kk: r.name_kk } },
      { type: 'Feature', geometry: r.label, properties: { kind: 'label', slug: r.slug, designator: r.designator, short: r.designator && /^\d/.test(r.designator) ? `${r.designator} mkr` : r.name.replace(' microdistrict', ''), short_ru: r.designator && /^\d/.test(r.designator) ? `${r.designator} мкр` : (r.name_ru ?? r.name) } },
    ]),
  }
  areasCache = { at: Date.now(), data }
  return data
}
