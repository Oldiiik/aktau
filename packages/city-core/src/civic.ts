// The civic loop's pure rules. One incident, many residents:
//   inferScope          who is affected (radius, buildings, microdistricts, city, demo session)
//   incidentAffects     does it affect this person's place?
//   assessPriority      how urgent, with the reasons in plain words (never "more likes = higher")
//   verificationOutcome when the affected residents' answers close or reopen it
// Deterministic and explainable, like the rest of the copilot: no network, no model.
import { addDays, fmtTime, localDate, sameLocalDay } from '@aktau/normalization/time'
import type { Lang } from '@aktau/types'
import { SERVICE_META, type IncidentService, type Intake } from './incidents.ts'

// ── Affected scope ──────────────────────────────────────────────────────────
export const SCOPE_KINDS = ['radius', 'building', 'buildings', 'area', 'areas', 'road', 'polygon', 'city', 'demo_session'] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]

export type ScopeProposal = { kind: ScopeKind | null; radius_m: number | null; reason: string }

/** A problem you can see from the street: how far it reaches, in metres. */
const LOCAL_RADIUS: Partial<Record<IncidentService, number>> = { streetlight: 150, garbage: 150, yard: 150, road: 300, transport: 400, other: 200 }
const OUTAGE_SERVICES = new Set<IncidentService>(['water', 'hot_water', 'electricity', 'heating'])

/**
 * The first guess at who is affected, from the report alone. An operator can
 * always widen or narrow it; buildings are added as neighbours confirm.
 *   broken streetlight → 150 m · open manhole → 200 m · water outage → the buildings
 *   reported · "the whole microdistrict" → the microdistrict · no place → nobody yet
 *   · "no water in my flat" → nobody else yet (houses join as others report or confirm)
 */
export function inferScope(
  i: Pick<Intake, 'service' | 'kind' | 'scope' | 'risk' | 'risk_flags'>,
  place: { building_id: string | null; area_id: string | null; has_point: boolean },
): ScopeProposal {
  if (!place.area_id && !place.has_point) return { kind: null, radius_m: null, reason: 'no_location' }
  if (i.risk === 'imminent') {
    if (place.has_point) return { kind: 'radius', radius_m: i.risk_flags.includes('gas_smell') ? 250 : 200, reason: 'danger_radius' }
    return { kind: 'area', radius_m: null, reason: 'danger_area' }
  }
  if (OUTAGE_SERVICES.has(i.service) || i.service === 'gas') {
    if (i.kind === 'damage' && place.has_point) return { kind: 'radius', radius_m: 150, reason: 'leak_radius' }
    if (i.scope === 'area' && place.area_id) return { kind: 'area', radius_m: null, reason: 'whole_area_reported' }
    // "Only us": an outage of houses with no house in it yet. The caller does not add the reporter's
    // house; a second flat (a report without "only us", or a neighbour's "me too") brings it in.
    if (i.scope === 'household') return { kind: 'buildings', radius_m: null, reason: 'one_household' }
    if (place.building_id) return { kind: 'buildings', radius_m: null, reason: 'reported_buildings' }
    if (place.area_id) return { kind: 'area', radius_m: null, reason: 'area_without_house' }
  }
  if (SERVICE_META[i.service].buildingLevel) {
    if (place.building_id) return { kind: 'building', radius_m: null, reason: 'one_building' }
    if (place.has_point) return { kind: 'radius', radius_m: 100, reason: 'building_unknown' }
    return { kind: 'area', radius_m: null, reason: 'area_without_house' }
  }
  if (place.has_point) return { kind: 'radius', radius_m: LOCAL_RADIUS[i.service] ?? 200, reason: 'visible_problem' }
  return { kind: 'area', radius_m: null, reason: 'area_without_point' }
}

export type ScopeFacts = {
  kind: ScopeKind | null
  radius_m: number | null
  building_ids: string[]
  /** Microdistricts that are wholly in scope. */
  area_ids_full: string[]
  session_id: string | null
  /** Metres from the place to the incident (its point, or its geometry for road / polygon). */
  distance_m: number | null
}
export type PlaceFacts = { building_id: string | null; area_ids: string[]; session_ids?: string[] }
export type Affects = { relevance: 'DIRECT' | 'NEARBY' | 'NO'; reason: string }

/** Does this incident affect a place? DIRECT = inside the scope; NEARBY = close by, not affected. */
export function incidentAffects(s: ScopeFacts, p: PlaceFacts, nearbyM = 800): Affects {
  const near = (): Affects => (s.distance_m != null && s.distance_m <= nearbyM ? { relevance: 'NEARBY', reason: 'distance' } : { relevance: 'NO', reason: 'none' })
  switch (s.kind) {
    case 'city': return { relevance: 'DIRECT', reason: 'city' }
    case 'demo_session': return s.session_id && p.session_ids?.includes(s.session_id) ? { relevance: 'DIRECT', reason: 'session' } : { relevance: 'NO', reason: 'not_in_session' }
    case 'building':
    case 'buildings': return p.building_id && s.building_ids.includes(p.building_id) ? { relevance: 'DIRECT', reason: 'building' } : near()
    case 'area':
    case 'areas': return p.area_ids.some((a) => s.area_ids_full.includes(a)) ? { relevance: 'DIRECT', reason: 'area' } : near()
    case 'radius': return s.distance_m != null && s.radius_m != null && s.distance_m <= s.radius_m ? { relevance: 'DIRECT', reason: 'radius' } : near()
    case 'road':
    case 'polygon': return s.distance_m != null && s.distance_m <= (s.radius_m ?? 30) ? { relevance: 'DIRECT', reason: 'geometry' } : near()
    default: return near()
  }
}

// ── Priority ────────────────────────────────────────────────────────────────
export type PriorityLevel = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'
export type PriorityReason = { key: string; n?: number }
export type PriorityInput = {
  service: IncidentService
  kind: Intake['kind'] | null
  risk: Intake['risk']
  risk_flags: string[]
  scope_kind: ScopeKind | null
  buildings: number
  areas_full: number
  /** Residents who reported or confirmed it. */
  residents: number
  first_signal_at: string
  /** The same problem at the same place was closed within the last 60 days. */
  recurring: boolean
  /** Sensitive places within reach: 'school' | 'kindergarten' | 'hospital'. */
  sensitive: string[]
  /** An official notice already covers it (planned work). */
  official: boolean
  /** The first report's own assessment: priority never drops below it. */
  floor?: PriorityLevel | null
  now?: Date
}
export type Priority = { level: PriorityLevel; score: number; reasons: PriorityReason[] }

const RANK: Record<PriorityLevel, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 }
const BASE: Record<IncidentService, number> = {
  gas: 40, building_safety: 30, electricity: 30, water: 30, heating: 30, hot_water: 20, sewer: 22, elevator: 20,
  road: 18, streetlight: 15, garbage: 10, yard: 8, transport: 10, other: 10,
}
const CRITICAL_SERVICE: Partial<Record<IncidentService, string>> = { water: 'water', hot_water: 'water', electricity: 'electricity', heating: 'heating', gas: 'gas' }

/**
 * How urgent an incident is, and why, in words a resident can check.
 * Safety comes first: an open manhole by a school with 3 confirmations is
 * critical; overflowing bins with 40 confirmations stay medium. Confirmations
 * add weight on a log scale, capped, so a crowd cannot outrank a hazard.
 */
export function assessPriority(p: PriorityInput): Priority {
  const now = p.now ?? new Date()
  const reasons: Array<PriorityReason & { w: number }> = []
  let score = BASE[p.service]
  const add = (key: string, w: number, n?: number) => { score += w; reasons.push({ key, w, ...(n != null ? { n } : {}) }) }

  const danger = p.risk === 'imminent'
  if (danger) reasons.push({ key: p.risk_flags.find((f) => ['gas_smell', 'open_manhole', 'fall_hazard', 'electrical_hazard'].includes(f)) ?? 'danger', w: 100 })
  const critical = CRITICAL_SERVICE[p.service]
  if (critical) reasons.push({ key: `service_${critical}`, w: 20 })
  if (p.risk === 'elevated') score += 15
  if (p.risk_flags.includes('children')) add('children', 5)
  if (p.risk_flags.includes('vulnerable')) add('vulnerable', 5)
  if (p.risk_flags.includes('flooding')) add('flooding', 10)
  if (p.risk_flags.includes('cold')) add('cold', 5)

  // Breadth of the scope.
  if (p.scope_kind === 'city') add('whole_city', 20)
  else if (p.areas_full > 1) add('areas', 15, p.areas_full)
  else if (p.areas_full === 1) add('whole_area', 12)
  else if (p.buildings >= 5) add('buildings', 10, p.buildings)
  else if (p.buildings >= 2) add('buildings', 5, p.buildings)
  // A utility outage for more than one household is a network problem, not a flat's.
  if (critical && p.kind === 'outage' && (p.buildings >= 2 || p.areas_full > 0 || p.residents >= 3)) score += 15

  // Residents: log scale, capped at +12.
  if (p.residents >= 2) add('residents', Math.min(12, Math.round(Math.log2(p.residents) * 3)), p.residents)

  // Duration: long outages hurt; for anything else only a very old one.
  const hours = Math.max(0, (now.getTime() - new Date(p.first_signal_at).getTime()) / 3_600_000)
  if (critical) {
    if (hours >= 24) add('duration', 15, Math.floor(hours))
    else if (hours >= 12) add('duration', 10, Math.floor(hours))
    else if (hours >= 3) add('duration', 5, Math.floor(hours))
  } else if (hours >= 72) add('duration', 5, Math.floor(hours))

  if (p.recurring) add('recurring', 8)
  const nearKids = p.sensitive.includes('school') || p.sensitive.includes('kindergarten')
  if (nearKids) add('near_school', danger || ['road', 'streetlight', 'sewer', 'building_safety'].includes(p.service) ? 10 : 4)
  if (p.sensitive.includes('hospital')) add('near_hospital', critical ? 10 : 4)
  if (p.official) add('official_notice', -5)

  // Critical is for danger (below) or a very large, long disruption; everything else tops out at high.
  let level: PriorityLevel = score >= 80 ? 'CRITICAL' : score >= 45 ? 'HIGH' : score >= 22 ? 'NORMAL' : 'LOW'
  if (danger) level = 'CRITICAL'
  if (p.floor && RANK[p.floor] > RANK[level]) level = p.floor
  // Equal weights read in a fixed order: what it is, who says so, for how long, then how wide.
  const ORDER = ['residents', 'duration', 'recurring', 'near_school', 'near_hospital', 'flooding', 'children', 'vulnerable', 'cold', 'whole_city', 'areas', 'whole_area', 'buildings']
  const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : -1)
  const top = reasons.filter((r) => r.w > 0).sort((a, b) => b.w - a.w || rank(a.key) - rank(b.key)).map(({ w: _w, ...r }) => r)
  return { level, score: Math.round(Math.max(0, score)), reasons: [...top, ...reasons.filter((r) => r.w < 0).map(({ w: _w, ...r }) => r)] }
}

// ── Verification ────────────────────────────────────────────────────────────
export type Tally = { yes: number; partial: number; no: number; eligible: number }
export type VerifyOutcome = {
  /** pending: wait for answers · verified: close as fixed · reopen: back to work · review: an operator decides */
  state: 'pending' | 'verified' | 'reopen' | 'review'
  n: number
  quorum: number
  /** Share of "yes, fully" answers, 0..1 ("78% confirmed it is fixed"). */
  yes_share: number
}

export const VERIFY_YES_SHARE = 0.6
export const REOPEN_NO_SHARE = 0.5

/**
 * The affected residents decide, together. A quorum of answers is needed
 * (3, or everyone when fewer than 3 can answer; 30% of a large group, at most 10).
 * ≥ 60% "yes, fully" closes it as verified. It reopens only when at least half
 * say "no" AND at least two people do: one negative vote never reopens an
 * incident (unless that person is the only one affected).
 */
export function verificationOutcome(t: Tally): VerifyOutcome {
  const n = t.yes + t.partial + t.no
  const E = Math.max(t.eligible, n)
  const quorum = E === 0 ? 1 : Math.min(10, Math.max(Math.min(E, 3), Math.ceil(E * 0.3)))
  const yes_share = n ? t.yes / n : 0
  if (n < quorum) return { state: 'pending', n, quorum, yes_share }
  if (yes_share >= VERIFY_YES_SHARE) return { state: 'verified', n, quorum, yes_share }
  if (t.no / n >= REOPEN_NO_SHARE && (t.no >= 2 || E <= 1)) return { state: 'reopen', n, quorum, yes_share }
  return { state: n >= E ? 'review' : 'pending', n, quorum, yes_share }
}

// ── Visible problems need an "after" photo to be closed ─────────────────────
/** Outages cannot be photographed ("no water"); there the residents' answers are the proof. */
export function completionNeedsPhoto(service: IncidentService, kind: Intake['kind'] | null): boolean {
  if (['streetlight', 'garbage', 'road', 'yard', 'building_safety'].includes(service)) return true
  if (service === 'sewer' && kind !== 'outage') return true
  return (service === 'water' || service === 'hot_water' || service === 'heating') && kind === 'damage'
}

// ── Deadlines in words ──────────────────────────────────────────────────────
function ruMinutes(n: number) {
  const m10 = n % 10, m100 = n % 100
  return m10 === 1 && m100 !== 11 ? 'минуту' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'минуты' : 'минут'
}

/**
 * A committed deadline for residents: "через 10 минут" when it is close,
 * "сегодня, 19:00" / "завтра, 10:00" / "26.09, 10:00" otherwise.
 */
export function etaWords(lang: Lang, iso: string, now: Date = new Date()): { when: string; rel: string | null; overdue: boolean } {
  const at = new Date(iso)
  const mins = Math.round((at.getTime() - now.getTime()) / 60000)
  const time = fmtTime(at)
  const tomorrow = addDays(localDate(now), 1)
  const d = localDate(at)
  const day = sameLocalDay(at, now) ? { en: 'today', ru: 'сегодня', kk: 'бүгін' }[lang]
    : d.day === tomorrow.day && d.month === tomorrow.month && d.year === tomorrow.year ? { en: 'tomorrow', ru: 'завтра', kk: 'ертең' }[lang]
    : `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}`
  const rel = mins > 0 && mins < 90
    ? { en: `in ${mins} min`, ru: `через ${mins} ${ruMinutes(mins)}`, kk: `${mins} минуттан кейін` }[lang]
    : null
  return { when: `${day}, ${time}`, rel, overdue: mins < 0 }
}
