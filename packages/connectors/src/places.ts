// Places: OpenStreetMap via Overpass (free fallback, one batched query per
// refresh, cached in our DB) and 2GIS Places (optional, DGIS_API_KEY).
import { httpFetch, httpJson } from './http.ts'
import type { SourceConnector } from './types.ts'

export type PlaceRecord = {
  external_id: string
  name: string
  name_kk?: string | null
  name_ru?: string | null
  name_en?: string | null
  category: string
  lat: number
  lon: number
  address?: string | null
  opening_hours?: string | null
  phone?: string | null
  website?: string | null
  rating?: number | null
  review_count?: number | null
  raw: unknown
}

const BBOX = '43.60,51.08,43.73,51.30'
const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']

const CATEGORY_OF = (t: Record<string, string>): string | null => {
  if (t.amenity === 'restaurant' || t.amenity === 'fast_food') return 'restaurant'
  if (t.amenity === 'cafe') return 'cafe'
  if (t.amenity === 'pharmacy') return 'pharmacy'
  if (t.amenity === 'hospital' || t.amenity === 'clinic') return 'hospital'
  if (t.amenity === 'school') return 'school'
  if (t.highway === 'bus_stop' || t.public_transport === 'platform') return 'bus_stop'
  if (t.leisure === 'park') return 'park'
  if (t.tourism === 'attraction' || t.tourism === 'viewpoint' || t.tourism === 'museum' || t.historic) return 'attraction'
  if (t.amenity === 'townhall' || t.office === 'government' || t.amenity === 'post_office' || t.amenity === 'police') return 'public'
  if (t.aeroway === 'aerodrome') return 'airport'
  // Everything else a resident might look for: kept broad here, searchable by its
  // exact OSM tags (raw) — "shop=optician", "craft=shoemaker", "amenity=dentist".
  if (t.amenity === 'bank' || t.amenity === 'atm' || t.amenity === 'bureau_de_change') return 'finance'
  if (t.amenity === 'dentist' || t.amenity === 'doctors' || t.amenity === 'veterinary' || t.healthcare) return 'health'
  if (t.amenity === 'fuel' || t.amenity === 'car_wash' || t.shop === 'car_repair' || t.shop === 'tyres' || t.shop === 'car_parts' || t.shop === 'car') return 'car'
  if (t.amenity === 'kindergarten' || t.amenity === 'university' || t.amenity === 'college' || t.amenity === 'library') return 'education'
  if (t.amenity === 'place_of_worship') return 'worship'
  if (t.tourism === 'hotel' || t.tourism === 'guest_house' || t.tourism === 'hostel' || t.tourism === 'motel') return 'hotel'
  if (t.leisure === 'fitness_centre' || t.leisure === 'sports_centre' || t.leisure === 'swimming_pool' || t.leisure === 'stadium') return 'sport'
  if (t.amenity === 'cinema' || t.amenity === 'theatre' || t.amenity === 'arts_centre' || t.amenity === 'nightclub') return 'culture'
  if (t.shop) return 'shop'
  if (t.craft || t.office || t.amenity) return 'service'
  return null
}

export function parseOverpass(json: { elements: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> }): PlaceRecord[] {
  const out: PlaceRecord[] = []
  for (const e of json.elements) {
    const t = e.tags ?? {}
    const cat = CATEGORY_OF(t)
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon
    const name = t.name ?? t['name:ru'] ?? t['name:kk']
    if (!cat || lat == null || lon == null || (!name && cat !== 'bus_stop')) continue
    out.push({
      external_id: `${e.type}/${e.id}`,
      name: name ?? 'Bus stop',
      name_kk: t['name:kk'] ?? null, name_ru: t['name:ru'] ?? null, name_en: t['name:en'] ?? null,
      category: cat, lat, lon,
      address: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ') || null,
      opening_hours: t.opening_hours ?? null, phone: t.phone ?? t['contact:phone'] ?? null, website: t.website ?? t['contact:website'] ?? null,
      raw: t,
    })
  }
  return out
}

export async function fetchOverpassPlaces(): Promise<{ places: PlaceRecord[]; raw: string; endpoint: string }> {
  const q = `[out:json][timeout:90];(
    nwr["amenity"~"^(restaurant|fast_food|cafe|pharmacy|hospital|clinic|school|townhall|post_office|police)$"](${BBOX});
    nwr["highway"="bus_stop"](${BBOX});
    nwr["leisure"="park"]["name"](${BBOX});
    nwr["tourism"~"^(attraction|viewpoint|museum)$"](${BBOX});
    nwr["aeroway"="aerodrome"](43.80,51.05,43.90,51.15);
    nwr["shop"]["name"](${BBOX});
    nwr["craft"](${BBOX});
    nwr["amenity"]["name"](${BBOX});
    nwr["healthcare"]["name"](${BBOX});
    nwr["office"]["name"](${BBOX});
    nwr["tourism"~"^(hotel|guest_house|hostel|motel)$"](${BBOX});
    nwr["leisure"~"^(fitness_centre|sports_centre|swimming_pool|stadium)$"]["name"](${BBOX});
  );out tags center;`
  let lastErr: unknown
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await httpFetch(endpoint, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeoutMs: 120_000, minIntervalMs: 5000 })
      if (res.status !== 200 || !res.text.startsWith('{')) throw new Error(`Overpass ${res.status}: ${res.text.replace(/<[^>]+>/g, ' ').slice(0, 160)}`)
      return { places: parseOverpass(JSON.parse(res.text)), raw: res.text, endpoint }
    } catch (e) { lastErr = e }
  }
  throw lastErr
}

/** One OSM tag across Aktau ("shop=optician"), for the assistant when the daily snapshot has none. */
export async function fetchOverpassTag(tag: string): Promise<PlaceRecord[]> {
  const m = tag.match(/^([a-z_:]{2,40})=([a-z0-9_;:-]{1,60})$/)
  if (!m) throw new Error('tag must look like key=value')
  const q = `[out:json][timeout:40];nwr["${m[1]}"="${m[2]}"](${BBOX});out tags center;`
  let lastErr: unknown
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await httpFetch(endpoint, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeoutMs: 45_000, minIntervalMs: 2000 })
      if (res.status !== 200 || !res.text.startsWith('{')) throw new Error(`Overpass ${res.status}`)
      return parseOverpass(JSON.parse(res.text))
    } catch (e) { lastErr = e }
  }
  throw lastErr
}

export const osmOverpass: SourceConnector = {
  slug: 'osm_overpass',
  job: 'places',
  async fetch() {
    const { places, raw, endpoint } = await fetchOverpassPlaces()
    return {
      http_status: 200,
      notes: `${places.length} places via ${new URL(endpoint).host}`,
      items: [{ external_id: null, canonical_url: endpoint, title: `Overpass places snapshot (${places.length})`, raw_text: `${places.length} places`, raw_json: { places, bytes: raw.length }, extractable: false }],
    }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'Shared community infrastructure: daily batched refresh only.' }
  },
}

// ── 2GIS (optional) ─────────────────────────────────────────────────────────
export function dgisConfigured(): boolean {
  return Boolean(process.env.DGIS_API_KEY)
}

export async function dgisSearch(query: string, near: { lat: number; lon: number }): Promise<PlaceRecord[]> {
  const key = process.env.DGIS_API_KEY
  if (!key) return []
  const url = `https://catalog.api.2gis.com/3.0/items?q=${encodeURIComponent(query)}&point=${near.lon},${near.lat}&radius=15000` +
    `&fields=items.point,items.schedule,items.reviews,items.address,items.rubrics&locale=ru_KZ&page_size=10&key=${key}`
  const { data } = await httpJson<{ result?: { items: Array<Record<string, any>> } }>(url, { timeoutMs: 8000 })
  return (data.result?.items ?? []).filter((i) => i.point).map((i) => ({
    external_id: String(i.id),
    name: i.name,
    category: i.rubrics?.[0]?.name ?? 'place',
    lat: i.point.lat, lon: i.point.lon,
    address: i.address_name ?? null,
    rating: i.reviews?.general_rating ?? null,
    review_count: i.reviews?.general_review_count ?? null,
    raw: i,
  }))
}

export const dgisPlaces: SourceConnector = {
  slug: 'dgis',
  job: 'places',
  async fetch() {
    return { items: [], notes: dgisConfigured() ? 'Query-time search only (results cached)' : 'DGIS_API_KEY not set — OSM fallback in use' }
  },
  async healthCheck() {
    return dgisConfigured() ? { ok: true, mode: 'automated', detail: 'Places API key configured.' } : { ok: true, mode: 'disabled', detail: 'No DGIS_API_KEY — using OSM places.' }
  },
}
