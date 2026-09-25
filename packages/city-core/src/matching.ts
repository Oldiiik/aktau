// doesEventAffectLocation — the single definition of "does this affect me?".
// Priority: exact building → microdistrict → explicit geometry → radius.
// A source that limits an outage to houses 19–23 must never be widened to the
// whole microdistrict: users elsewhere in the district get AREA, not DIRECT.
import type { Category, Coverage, EventStatus, Relevance } from '@aktau/types'

export type MatchEvent = {
  status: EventStatus
  category: Category
  areas: Array<{ area_id: string; coverage: Coverage }>
  building_ids: string[]
  /** Precomputed by PostGIS for events with explicit geometry (road segment / radius). */
  geometry_covers_location?: boolean
  /** Metres from the location to the event footprint (areas or geometry). */
  distance_m?: number | null
}

export type MatchLocation = {
  building_id?: string | null
  /** Areas that contain the location: the saved area and/or areas covering its point. */
  area_ids: string[]
}

export type MatchReason =
  | 'building' | 'area_full' | 'area_partial' | 'area_other_buildings' | 'area_unknown_building'
  | 'geometry' | 'radius' | 'inactive' | 'none'

export type MatchResult = { relevance: Relevance; reason: MatchReason }

const INACTIVE: EventStatus[] = ['RESOLVED', 'CANCELLED']
const TRAVEL: Category[] = ['ROAD', 'TRANSPORT']

export function doesEventAffectLocation(event: MatchEvent, loc: MatchLocation, opts: { nearbyMeters?: number } = {}): MatchResult {
  if (INACTIVE.includes(event.status)) return { relevance: 'NO', reason: 'inactive' }
  const nearby = opts.nearbyMeters ?? 1500

  // 1. Exact building.
  if (loc.building_id && event.building_ids.includes(loc.building_id)) return { relevance: 'DIRECT', reason: 'building' }

  // 2. Microdistrict.
  const hit = event.areas.find((a) => loc.area_ids.includes(a.area_id))
  if (hit) {
    if (TRAVEL.includes(event.category)) return { relevance: 'AREA', reason: 'area_partial' }
    if (hit.coverage === 'FULL') return { relevance: 'DIRECT', reason: 'area_full' }
    if (hit.coverage === 'PARTIAL') return { relevance: 'AREA', reason: 'area_partial' }
    // BUILDINGS_ONLY: the user's building is known and not listed → in the district, not affected.
    return loc.building_id
      ? { relevance: 'AREA', reason: 'area_other_buildings' }
      : { relevance: 'AREA', reason: 'area_unknown_building' }
  }

  // 3. Explicit geometry (road segment, point + radius) covering the location.
  if (event.geometry_covers_location) {
    return TRAVEL.includes(event.category) ? { relevance: 'NEARBY', reason: 'geometry' } : { relevance: 'DIRECT', reason: 'geometry' }
  }

  // 4. Radius.
  if (event.distance_m != null && event.distance_m <= nearby) return { relevance: 'NEARBY', reason: 'radius' }
  return { relevance: 'NO', reason: 'none' }
}

/** Whether a match should reach a person who asked for "only what affects me". */
export function affectsPersonally(m: MatchResult): boolean {
  return m.relevance === 'DIRECT' || m.reason === 'area_partial' || m.reason === 'area_unknown_building'
}
