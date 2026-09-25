// Notification decisions. Pipeline: event change → affected saved locations →
// preference filter → dedupe → deliver. A second source confirming the same
// outage changes nothing the person needs to know, so it produces no alert.
import { eventHeadline, t } from '@aktau/i18n'
import { fmtTime, sameLocalDay, addDays, localDate } from '@aktau/normalization/time'
import type { AlertPreferences, Category, EventStatus, Lang, NotificationType, Severity } from '@aktau/types'
import { affectsPersonally, type MatchResult } from './matching.ts'

export type ChangeKind = 'CREATED' | 'STATUS_CHANGED' | 'ETA_CHANGED' | 'CONFIRMED' | 'CORRECTED' | 'CONFLICT_NOTED' | 'RESOLVED'

export function notificationTypeFor(change: ChangeKind, newStatus: EventStatus): NotificationType | null {
  if (change === 'CONFIRMED' || change === 'CONFLICT_NOTED' || change === 'CORRECTED') return null
  if (change === 'ETA_CHANGED') return newStatus === 'RESOLVED' ? 'RESOLVED' : 'UPDATED'
  if (newStatus === 'RESOLVED') return 'RESOLVED'
  if (newStatus === 'CANCELLED') return 'CANCELLED'
  if (newStatus === 'ACTIVE') return change === 'CREATED' || change === 'STATUS_CHANGED' ? 'STARTED' : null
  // DELAYED comes with an ETA change, which produces the UPDATED alert itself.
  if (newStatus === 'DELAYED') return change === 'CREATED' ? 'STARTED' : null
  if (newStatus === 'SCHEDULED' && change === 'CREATED') return 'PLANNED'
  return null
}

/** Same recipient + event + type (+ ETA for updates) ⇒ same key ⇒ one delivery. */
export function dedupeKey(recipient: string, eventId: string, type: NotificationType, expectedEnd: string | null): string {
  return [recipient, eventId, type, type === 'UPDATED' ? expectedEnd ?? 'none' : ''].join(':')
}

const PREF_FOR: Record<Category, keyof AlertPreferences | null> = {
  WATER: 'water', HOT_WATER: 'water', ELECTRICITY: 'electricity', HEATING: 'heating', GAS: 'heating', ROAD: 'road',
  TRANSPORT: 'transport', WEATHER: 'weather', AIR_QUALITY: 'weather', CASPIAN: 'weather', EMERGENCY: 'emergency', EVENT: 'events', OTHER: null,
}
const SEV: Record<Severity, number> = { INFO: 0, MINOR: 1, MODERATE: 2, MAJOR: 3, CRITICAL: 4 }

export function shouldNotify(prefs: AlertPreferences, e: { category: Category; severity: Severity }, match: MatchResult): boolean {
  if (match.relevance === 'NO') return false
  // Essential city warnings stay on regardless of toggles.
  if (e.category === 'EMERGENCY') return true
  const key = PREF_FOR[e.category]
  if (!key || prefs[key] !== true) return false
  if (SEV[e.severity] < SEV[prefs.minimum_severity]) return false
  if (prefs.affects_me_only) return affectsPersonally(match)
  return true
}

export function renderNotification(
  lang: Lang, type: NotificationType,
  e: { id: string; category: Category; event_type: string; status: EventStatus; starts_at: string | null; expected_ends_at: string | null },
  now: Date,
): { title: string; body: string; deep_link: string } {
  const what = eventHeadline(lang, { category: e.category, event_type: e.event_type === 'restoration' ? 'planned_outage' : e.event_type })
  const start = e.starts_at ? new Date(e.starts_at) : null
  const end = e.expected_ends_at ? new Date(e.expected_ends_at) : null
  const tomorrow = addDays(localDate(now), 1)
  const when = start
    ? sameLocalDay(start, now) ? t(lang, 'when.today')
      : localDate(start).day === tomorrow.day && localDate(start).month === tomorrow.month ? t(lang, 'when.tomorrow') : ''
    : ''
  const deep_link = `aktau://event/${e.id}`
  switch (type) {
    case 'PLANNED':
      return {
        title: t(lang, 'notif.PLANNED.title', { what, when }).trim(),
        body: start && end ? t(lang, 'notif.PLANNED.body', { start: fmtTime(start), end: fmtTime(end) })
          : start ? t(lang, 'notif.PLANNED.body.open', { start: fmtTime(start) }) : t(lang, 'notif.STARTED.body'),
        deep_link,
      }
    case 'STARTED':
      return { title: t(lang, 'notif.STARTED.title', { what }), body: t(lang, 'notif.STARTED.body'), deep_link }
    case 'UPDATED':
      return { title: t(lang, 'notif.UPDATED.title'), body: end ? t(lang, 'notif.UPDATED.body', { time: fmtTime(end) }) : t(lang, 'eta.unknown'), deep_link }
    case 'RESOLVED':
      return { title: t(lang, 'notif.RESOLVED.title', { what: eventHeadline(lang, { category: e.category, event_type: 'restoration' }) }), body: t(lang, 'notif.RESOLVED.body'), deep_link }
    case 'CANCELLED':
      return { title: t(lang, 'notif.CANCELLED.title', { what }), body: t(lang, 'notif.CANCELLED.body'), deep_link }
  }
}
