// Resolves "where is the user" from whatever the client has: a saved
// location, a building, an area, or raw coordinates. Coordinates are used for
// the query only — they are not stored or logged.
import { areaName, t } from '@aktau/i18n'
import type { Lang, LocationContext } from '@aktau/types'
import type { Sql } from './db/client.ts'

export type LocationInput = {
  saved_location_id?: string | null
  building_id?: string | null
  area_id?: string | null
  lat?: number | null
  lon?: number | null
  installation_id?: string | null
}

export type ResolvedLocation = {
  ctx: LocationContext
  area_ids: string[]
  building_id: string | null
  point: { lat: number; lon: number } | null
}

type AreaRow = { id: string; slug: string; name: string; name_ru: string | null; name_kk: string | null; name_en: string | null; designator: string | null; lat: number | null; lon: number | null }

async function areaById(sql: Sql, id: string) {
  const [a] = await sql<AreaRow[]>`select id, slug, name, name_ru, name_kk, name_en, designator,
    ST_Y(centroid::geometry) lat, ST_X(centroid::geometry) lon from areas where id = ${id}`
  return a ?? null
}

async function areasCovering(sql: Sql, lat: number, lon: number) {
  return sql<AreaRow[]>`select id, slug, name, name_ru, name_kk, name_en, designator, null::float8 lat, null::float8 lon
    from areas where area_type = 'MICRODISTRICT' and ST_Covers(geometry, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography)
    order by ST_Area(geometry) asc limit 3`
}

export async function resolveLocation(sql: Sql, input: LocationInput, lang: Lang): Promise<ResolvedLocation> {
  let saved: { id: string; label: string; type: string; area_id: string | null; building_id: string | null; lat: number | null; lon: number | null } | undefined
  if (input.saved_location_id && input.installation_id) {
    // Saved places are private: only the owning installation can use one.
    ;[saved] = await sql`select sl.id, sl.label, sl.type, sl.area_id, sl.building_id, ST_Y(sl.point::geometry) lat, ST_X(sl.point::geometry) lon
      from saved_locations sl join device_installations d on d.id = sl.installation_id
      where sl.id = ${input.saved_location_id} and d.installation_id = ${input.installation_id}`
  }
  if (!saved && input.installation_id && input.lat == null && !input.area_id && !input.building_id) {
    ;[saved] = await sql`select sl.id, sl.label, sl.type, sl.area_id, sl.building_id, ST_Y(sl.point::geometry) lat, ST_X(sl.point::geometry) lon
      from saved_locations sl join device_installations d on d.id = sl.installation_id
      where d.installation_id = ${input.installation_id} order by sl.is_primary desc, sl.created_at limit 1`
  }

  const buildingId = saved?.building_id ?? input.building_id ?? null
  let building: { id: string; house_number: string; area_id: string; lat: number; lon: number } | undefined
  if (buildingId) {
    ;[building] = await sql`select id, house_number, area_id, ST_Y(point::geometry) lat, ST_X(point::geometry) lon from buildings where id = ${buildingId}`
  }
  const areaId = building?.area_id ?? saved?.area_id ?? input.area_id ?? null
  const area = areaId ? await areaById(sql, areaId) : null

  let point: { lat: number; lon: number } | null = null
  if (building) point = { lat: building.lat, lon: building.lon }
  else if (saved?.lat != null && saved.lon != null) point = { lat: saved.lat, lon: saved.lon }
  else if (input.lat != null && input.lon != null) point = { lat: input.lat, lon: input.lon }
  else if (area?.lat != null && area.lon != null) point = { lat: area.lat, lon: area.lon }

  const areaIds = new Set<string>(area ? [area.id] : [])
  let coveringArea: AreaRow | null = null
  if (point && !area) {
    const cov = await areasCovering(sql, point.lat, point.lon)
    cov.forEach((a) => areaIds.add(a.id))
    coveringArea = cov[0] ?? null
  }
  const shownArea = area ?? coveringArea

  const kind: LocationContext['kind'] = saved ? 'saved' : building ? 'building' : area ? 'area' : point ? 'point' : 'city'
  const typeLabel = saved ? t(lang, `loc.${saved.type.toLowerCase()}`) : null
  const place = shownArea ? areaName(lang, shownArea) : null
  const label = kind === 'city' ? t(lang, 'loc.city')
    : [saved ? (saved.type === 'CUSTOM' ? saved.label : typeLabel) : kind === 'point' ? t(lang, 'loc.here') : null, place].filter(Boolean).join(' · ')

  return {
    ctx: {
      kind,
      label: label || t(lang, 'loc.city'),
      saved_location_id: saved?.id ?? null,
      area: shownArea ? { id: shownArea.id, slug: shownArea.slug, name: areaName(lang, shownArea), designator: shownArea.designator } : null,
      building: building ? { id: building.id, house_number: building.house_number } : null,
      point: kind === 'point' ? null : null, // never echo coordinates back
    },
    area_ids: [...areaIds],
    building_id: building?.id ?? null,
    point,
  }
}
