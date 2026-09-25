// City service status is DERIVED from events — never stored or typed by hand.
// "Normal" additionally requires that the sources which would report a problem
// were checked recently; otherwise the honest state is UNKNOWN.
import type { Category, EventStatus, Relevance, ServiceKey, ServiceState } from '@aktau/types'

export const SERVICE_CATEGORIES: Record<ServiceKey, Category[]> = {
  water: ['WATER', 'HOT_WATER'],
  electricity: ['ELECTRICITY'],
  heating: ['HEATING', 'GAS'],
  roads: ['ROAD'],
  transport: ['TRANSPORT'],
}

export function serviceForCategory(c: Category): ServiceKey | null {
  for (const [k, cats] of Object.entries(SERVICE_CATEGORIES)) if (cats.includes(c)) return k as ServiceKey
  return null
}

export type ServiceEvent = {
  id: string
  category: Category
  display_status: EventStatus
  starts_at: Date | null
  relevance: Relevance
}

export type ServiceDerivation = { key: ServiceKey; state: ServiceState; event_ids: string[]; count: number; confirmed_at: Date | null }

const H = 3_600_000
const RANK: Record<ServiceState, number> = { NORMAL: 0, PLANNED_ISSUE: 1, UNKNOWN: 2, DEGRADED: 3, DISRUPTED: 4 }

/**
 * @param coverage when each service's reporting sources were last successfully
 *        checked (null = never). Older than `maxQuietHours` → UNKNOWN, not NORMAL.
 * @param scope 'personal' counts DIRECT/AREA (and NEARBY for roads/transport);
 *        'city' counts every current event.
 */
export function deriveServiceStatus(
  key: ServiceKey,
  events: ServiceEvent[],
  coverage: Date | null,
  now: Date,
  opts: { scope?: 'personal' | 'city'; horizonHours?: number; maxQuietHours?: number } = {},
): ServiceDerivation {
  const scope = opts.scope ?? 'personal'
  const horizon = (opts.horizonHours ?? 48) * H
  const travel = key === 'roads' || key === 'transport'
  const relevant = events.filter((e) => SERVICE_CATEGORIES[key].includes(e.category) && (
    scope === 'city' || e.relevance === 'DIRECT' || e.relevance === 'AREA' || (travel && e.relevance === 'NEARBY')
  ))

  let state: ServiceState = 'NORMAL'
  const ids: string[] = []
  for (const e of relevant) {
    let s: ServiceState | null = null
    if (e.display_status === 'UNCONFIRMED') s = 'UNKNOWN'
    else if (e.display_status === 'DEGRADED') s = 'DEGRADED'
    else if (e.display_status === 'ACTIVE' || e.display_status === 'DELAYED') {
      s = travel ? 'PLANNED_ISSUE' : e.relevance === 'DIRECT' || scope === 'city' ? 'DISRUPTED' : 'DEGRADED'
    } else if (e.display_status === 'SCHEDULED' && (!e.starts_at || e.starts_at.getTime() - now.getTime() <= horizon)) s = 'PLANNED_ISSUE'
    if (!s) continue
    ids.push(e.id)
    if (RANK[s] > RANK[state]) state = s
  }
  const quiet = (opts.maxQuietHours ?? 6) * H
  if (state === 'NORMAL' && (!coverage || now.getTime() - coverage.getTime() > quiet)) state = 'UNKNOWN'
  return { key, state, event_ids: ids, count: ids.length, confirmed_at: coverage }
}
