// Time-driven lifecycle transitions (run every few minutes). Only transitions
// the source itself announced are applied: a scheduled window starting is the
// source's own claim. Nothing is ever marked RESOLVED without a source — an
// overdue outage is surfaced as "not recently confirmed" by freshness instead.
import type { EventStatus } from '@aktau/types'

export type LifecycleEvent = { id: string; status: EventStatus; starts_at: Date | null; expected_ends_at: Date | null; event_type: string }
export type Transition = { id: string; from: EventStatus; to: EventStatus; message: string }

export function scheduledTransitions(events: LifecycleEvent[], now: Date): Transition[] {
  const out: Transition[] = []
  for (const e of events) {
    if (e.status === 'SCHEDULED' && e.starts_at && e.starts_at <= now && (!e.expected_ends_at || e.expected_ends_at > now)) {
      out.push({ id: e.id, from: 'SCHEDULED', to: 'ACTIVE', message: 'Scheduled start time reached (per the source announcement).' })
    }
  }
  return out
}
