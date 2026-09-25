// The real city the pilot simulation runs on: microdistricts (with their
// polygons and which ones touch), every addressed building, and the schools,
// kindergartens and hospitals the priority rules look for. Loaded once from
// the database; after that the simulation never touches the database.
//
// Place lookups mirror the SQL in incidents.ts:
//   designator + house → building (resolvePlace)          → exact, same keys
//   GPS point → microdistrict ("order by geometry <-> point") → point-in-polygon,
//                                                          else the nearest polygon
//   adjacent microdistricts (ST_DWithin 400 m)            → loaded from PostGIS as is
import { metresBetween } from '@aktau/city-core'
import { normalizeHouseNumber } from '@aktau/normalization/text'
import type { Sql } from './db/client.ts'

type Ring = Array<[number, number]>
export type PilotArea = { id: string; designator: string; name: string; name_ru: string | null; name_kk: string | null; lat: number; lon: number; polygons: Ring[][] | null }
export type PilotBuilding = { i: number; id: string; area_id: string | null; house: string; norm: string; lat: number; lon: number }
export type SensitivePlace = { kind: 'school' | 'hospital' | 'kindergarten'; lat: number; lon: number }

export type PilotCity = {
  areas: PilotArea[]
  buildings: PilotBuilding[]
  sensitive: SensitivePlace[]
  adjacency: Map<string, Set<string>>
  areaById: Map<string, PilotArea>
  byDesignator: Map<string, PilotArea>
  byHouse: Map<string, PilotBuilding>
  buildingsIn: Map<string, number[]>
  grid: Grid
}

// ── Loading ──────────────────────────────────────────────────────────────────
type Geo = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }

export async function loadPilotCity(sql: Sql): Promise<PilotCity> {
  // Ordered by natural keys (slug, house number, OSM id), never by random uuids: the same seed is
  // the same week on any copy of the database.
  const [areas, adj, buildings, sensitive] = await Promise.all([
    sql<{ id: string; designator: string | null; name: string; name_ru: string | null; name_kk: string | null; lat: number | null; lon: number | null; geom: Geo | null }[]>`
      select id, designator, name, name_ru, name_kk, ST_Y(centroid::geometry) lat, ST_X(centroid::geometry) lon,
        case when geometry is null then null else ST_AsGeoJSON(geometry::geometry, 6)::json end geom
      from areas where area_type = 'MICRODISTRICT' order by slug`,
    sql<{ a: string; b: string }[]>`
      select a.id a, b.id b from areas a join areas b on b.area_type = 'MICRODISTRICT' and b.id <> a.id and ST_DWithin(a.geometry, b.geometry, 400)
      where a.area_type = 'MICRODISTRICT' and a.geometry is not null order by a.slug, b.slug`,
    sql<{ id: string; area_id: string | null; house_number: string; house_number_norm: string; lat: number; lon: number }[]>`
      select b.id, b.area_id, b.house_number, b.house_number_norm, ST_Y(b.point::geometry) lat, ST_X(b.point::geometry) lon
      from buildings b join areas a on a.id = b.area_id where b.point is not null order by a.slug, b.house_number_norm`,
    sql<{ kind: SensitivePlace['kind']; lat: number; lon: number }[]>`
      select case when p.category = 'school' then 'school' when p.category = 'hospital' then 'hospital' else 'kindergarten' end kind,
        ST_Y(p.point::geometry) lat, ST_X(p.point::geometry) lon
      from places p where p.category in ('school', 'hospital') or (p.category = 'education' and p.name ~* '(детск|детсад|ясли|балабақша|kindergarten)')
      order by p.external_id`,
  ])
  return buildCity(
    areas.filter((a) => a.designator && a.lat != null && a.lon != null).map((a) => ({
      id: a.id, designator: a.designator!, name: a.name, name_ru: a.name_ru, name_kk: a.name_kk, lat: a.lat!, lon: a.lon!,
      polygons: a.geom ? (a.geom.type === 'Polygon' ? [a.geom.coordinates] : a.geom.coordinates) : null,
    })),
    buildings.map((b, i) => ({ i, id: b.id, area_id: b.area_id, house: b.house_number, norm: b.house_number_norm, lat: b.lat, lon: b.lon })),
    sensitive, adj,
  )
}

export function buildCity(areas: PilotArea[], buildings: PilotBuilding[], sensitive: SensitivePlace[], adj: Array<{ a: string; b: string }>): PilotCity {
  const adjacency = new Map<string, Set<string>>()
  for (const { a, b } of adj) {
    if (!adjacency.has(a)) adjacency.set(a, new Set())
    adjacency.get(a)!.add(b)
  }
  const byHouse = new Map<string, PilotBuilding>()
  const buildingsIn = new Map<string, number[]>()
  for (const b of buildings) {
    if (!b.area_id) continue
    const k = `${b.area_id}|${b.norm}`
    if (!byHouse.has(k)) byHouse.set(k, b)
    if (!buildingsIn.has(b.area_id)) buildingsIn.set(b.area_id, [])
    buildingsIn.get(b.area_id)!.push(b.i)
  }
  return {
    areas, buildings, sensitive, adjacency, byHouse, buildingsIn,
    areaById: new Map(areas.map((a) => [a.id, a])),
    byDesignator: new Map(areas.map((a) => [a.designator.toUpperCase(), a])),
    grid: new Grid(buildings),
  }
}

// ── Place resolution (resolvePlace, in memory) ───────────────────────────────
export type SimPlace = { area_id: string | null; building: number | null; lat: number | null; lon: number | null }

export function resolveSimPlace(city: PilotCity, designator: string | null, house: string | null, near: { lat: number; lon: number } | null): SimPlace {
  if (!designator && near) {
    const a = nearestArea(city, near.lat, near.lon)
    // resolvePlace(): a shared location within GPS_BUILDING_M of a building is that building.
    const b = city.grid.nearest(near.lat, near.lon, 1, 40)[0] ?? null
    return { area_id: a?.id ?? null, building: b, lat: near.lat, lon: near.lon }
  }
  if (!designator) return { area_id: null, building: null, lat: null, lon: null }
  const a = city.byDesignator.get(designator.toUpperCase())
  if (!a) return { area_id: null, building: null, lat: null, lon: null }
  if (house) {
    const b = city.byHouse.get(`${a.id}|${normalizeHouseNumber(house)}`)
    if (b) return { area_id: a.id, building: b.i, lat: b.lat, lon: b.lon }
  }
  return { area_id: a.id, building: null, lat: a.lat, lon: a.lon }
}

/** "order by geometry <-> point limit 1": the polygon that contains the point, else the closest one. */
export function nearestArea(city: PilotCity, lat: number, lon: number): PilotArea | null {
  let best: PilotArea | null = null
  let bestD = Infinity
  for (const a of city.areas) {
    if (!a.polygons) continue
    const d = distanceToPolygons(a.polygons, lat, lon)
    if (d < bestD) { bestD = d; best = a }
    if (d === 0) break
  }
  return best
}

const M_LAT = 110_574
const mLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

function inRing(ring: Ring, x: number, y: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Metres from a point to a (multi)polygon; 0 inside. Local planar projection: exact enough at city scale. */
export function distanceToPolygons(polys: Ring[][], lat: number, lon: number): number {
  const kx = mLon(lat)
  let best = Infinity
  for (const rings of polys) {
    const outer = rings[0]
    if (!outer) continue
    if (inRing(outer, lon, lat) && !rings.slice(1).some((h) => inRing(h, lon, lat))) return 0
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const d = segDist(lon * kx, lat * M_LAT, ring[j]![0] * kx, ring[j]![1] * M_LAT, ring[i]![0] * kx, ring[i]![1] * M_LAT)
        if (d < best) best = d
      }
    }
  }
  return best
}

// ── Spatial index over buildings ─────────────────────────────────────────────
const CELL = 200
export class Grid {
  private cells = new Map<string, number[]>()
  constructor(private buildings: PilotBuilding[]) {
    for (const b of buildings) {
      const k = this.key(b.lat, b.lon)
      if (!this.cells.has(k)) this.cells.set(k, [])
      this.cells.get(k)!.push(b.i)
    }
  }
  private key(lat: number, lon: number) { return `${Math.floor((lat * M_LAT) / CELL)}:${Math.floor((lon * mLon(43.65)) / CELL)}` }
  /** Buildings within `radius` metres of a point (ST_DWithin semantics). */
  within(lat: number, lon: number, radius: number): number[] {
    const cy = Math.floor((lat * M_LAT) / CELL), cx = Math.floor((lon * mLon(43.65)) / CELL)
    const r = Math.ceil(radius / CELL) + 1
    const out: number[] = []
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        for (const i of this.cells.get(`${y}:${x}`) ?? []) {
          const b = this.buildings[i]!
          if (metresBetween({ lat, lon }, { lat: b.lat, lon: b.lon }) <= radius) out.push(i)
        }
      }
    }
    return out
  }
  nearest(lat: number, lon: number, k = 1, maxM = 600): number[] {
    return this.within(lat, lon, maxM)
      .map((i) => ({ i, d: metresBetween({ lat, lon }, { lat: this.buildings[i]!.lat, lon: this.buildings[i]!.lon }) }))
      .sort((a, b) => a.d - b.d).slice(0, k).map((x) => x.i)
  }
}
