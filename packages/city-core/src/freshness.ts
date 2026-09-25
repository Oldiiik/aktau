// Freshness: every state carries how recently a source confirmed it. An outage
// that was expected to end hours ago with no update is NOT shown as
// confidently active — it becomes "status not recently confirmed".
import type { EventStatus, Freshness, SourceType } from '@aktau/types'

export type FreshnessInput = {
  status: EventStatus
  starts_at: Date | null
  expected_ends_at: Date | null
  last_confirmed_at: Date
  source_type: SourceType
}

const H = 3_600_000
const ONGOING: EventStatus[] = ['ACTIVE', 'DELAYED', 'DEGRADED']

export function eventFreshness(e: FreshnessInput, now: Date): Freshness {
  if (e.status === 'RESOLVED' || e.status === 'CANCELLED') return 'fresh'
  const k = e.source_type === 'COMMUNITY' ? 0.5 : 1
  const sinceConfirm = now.getTime() - e.last_confirmed_at.getTime()

  const ongoing = ONGOING.includes(e.status) || (e.status === 'SCHEDULED' && e.starts_at != null && e.starts_at <= now)
  if (ongoing && e.expected_ends_at && e.expected_ends_at < now && e.last_confirmed_at < e.expected_ends_at) {
    const overdue = now.getTime() - e.expected_ends_at.getTime()
    return overdue <= 0.5 * H ? 'aging' : 'stale'
  }
  if (ongoing) return sinceConfirm <= 6 * H * k ? 'fresh' : sinceConfirm <= 24 * H * k ? 'aging' : 'stale'
  if (e.status === 'SCHEDULED') return sinceConfirm <= 7 * 24 * H * k ? 'fresh' : 'aging'
  return sinceConfirm <= 24 * H * k ? 'aging' : 'stale' // UNCONFIRMED
}

/** What the UI may assert right now, given status and freshness. */
export function displayStatus(e: FreshnessInput, now: Date): EventStatus {
  const f = eventFreshness(e, now)
  if (e.status === 'SCHEDULED' && e.starts_at && e.starts_at <= now) {
    return f === 'stale' ? 'UNCONFIRMED' : 'ACTIVE'
  }
  if (ONGOING.includes(e.status) && f === 'stale') return 'UNCONFIRMED'
  return e.status
}

/** Whether the event belongs in "current city state" at all. */
export function isCurrent(e: FreshnessInput, now: Date): boolean {
  if (e.status === 'RESOLVED' || e.status === 'CANCELLED') return false
  if (e.expected_ends_at && now.getTime() - e.expected_ends_at.getTime() > 24 * H) return false
  if (e.starts_at && e.starts_at.getTime() - now.getTime() > 14 * 24 * H) return false
  if (!e.expected_ends_at && ONGOING.includes(e.status) && now.getTime() - e.last_confirmed_at.getTime() > 7 * 24 * H) return false
  return true
}
