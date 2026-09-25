// getAktauNow's pure core. One engine powers Home, the widget, Ask context
// and notifications — no surface re-implements these rules.
import { t } from '@aktau/i18n'
import type { AktauNowDTO, CityEventDTO, Lang, LocationContext, ServiceStatusDTO, WeatherSnippet } from '@aktau/types'
import { fmtTime, sameLocalDay } from '@aktau/normalization/time'

const SEVERITY_RANK = { INFO: 0, MINOR: 1, MODERATE: 2, MAJOR: 3, CRITICAL: 4 } as const
const H = 3_600_000

export function isOngoing(e: CityEventDTO): boolean {
  return e.display_status === 'ACTIVE' || e.display_status === 'DELAYED' || e.display_status === 'DEGRADED'
}

/** Urgency ordering: affects-me-now > affects-me-soon > in-my-district > nearby; then severity, then time. */
export function urgencyScore(e: CityEventDTO, now: Date): number {
  const rel = { DIRECT: 3000, AREA: 2000, NEARBY: 1000, NO: 0 }[e.relevance ?? 'NO']
  const phase = isOngoing(e) ? 500 : e.display_status === 'SCHEDULED' ? 300 : e.display_status === 'UNCONFIRMED' ? 200 : 0
  const soon = e.starts_at ? Math.max(0, 100 - Math.abs(new Date(e.starts_at).getTime() - now.getTime()) / H) : 50
  return rel + phase + SEVERITY_RANK[e.severity] * 20 + soon
}

export function composeAktauNow(args: {
  location: LocationContext
  events: CityEventDTO[] // current events with relevance + display_status computed
  recentlyResolved: CityEventDTO[]
  services: ServiceStatusDTO[]
  weather: WeatherSnippet
  lang: Lang
  now: Date
  sourceTimes: { oldest: string | null; stale: string[] }
}): AktauNowDTO {
  const { events, lang, now, location } = args
  const personal = location.kind !== 'city'
  const sorted = [...events].sort((a, b) => urgencyScore(b, now) - urgencyScore(a, now))
  // In my microdistrict but limited by the source to other houses: nearby, never "affects your home".
  const affecting = sorted.filter((e) => e.relevance === 'DIRECT' || (e.relevance === 'AREA' && e.relevance_reason !== 'area_other_buildings' && e.category !== 'ROAD' && e.category !== 'TRANSPORT'))
  const nearby = sorted.filter((e) => !affecting.includes(e) && (e.relevance === 'NEARBY' || e.relevance === 'AREA'))
  const direct = affecting.filter((e) => e.relevance === 'DIRECT')
  const directOngoing = direct.filter(isOngoing)

  const coreUnknown = args.services.filter((s) => ['water', 'electricity'].includes(s.key)).every((s) => s.state === 'UNKNOWN')
  let overall: AktauNowDTO['overall'] = 'CALM'
  let headline: string
  if (directOngoing.length) {
    overall = 'DISRUPTION'
    headline = t(lang, 'now.affects.activeCard', { n: directOngoing.length })
  } else if (direct.length) {
    overall = 'ATTENTION'
    headline = t(lang, 'now.affects.upcoming', { n: direct.length })
  } else if (affecting.length) {
    overall = 'ATTENTION'
    headline = t(lang, 'now.affects.upcoming', { n: affecting.length })
  } else if (personal && nearby.length) {
    overall = 'ATTENTION'
    headline = t(lang, 'now.nearby', { n: nearby.length })
  } else if (coreUnknown) {
    overall = 'UNKNOWN'
    headline = t(lang, 'now.unknown')
  } else if (!personal && sorted.length) {
    overall = 'ATTENTION'
    headline = t(lang, 'now.nearby', { n: sorted.length })
  } else {
    headline = t(lang, personal ? 'now.calm' : 'now.calm.city')
  }

  const today = sorted
    .filter((e) => e.relevance && e.relevance !== 'NO')
    .flatMap((e) => {
      const out: Array<{ at: string; event_id: string; label: string }> = []
      if (e.starts_at && sameLocalDay(new Date(e.starts_at), now)) out.push({ at: e.starts_at, event_id: e.id, label: `${fmtTime(new Date(e.starts_at))} · ${e.title}` })
      if (e.expected_ends_at && sameLocalDay(new Date(e.expected_ends_at), now)) out.push({ at: e.expected_ends_at, event_id: e.id, label: `${fmtTime(new Date(e.expected_ends_at))} · ${e.title}` })
      return out
    })
    .sort((a, b) => a.at.localeCompare(b.at))

  const resolved = args.recentlyResolved.find((e) => e.relevance === 'DIRECT' || e.relevance === 'AREA') ?? null
  return {
    location,
    overall,
    affecting_user: affecting.length,
    nearby: nearby.length,
    headline,
    priority_event: sorted[0] && sorted[0].relevance !== 'NO' ? sorted[0] : personal ? null : sorted[0] ?? null,
    affecting,
    nearby_events: nearby,
    recently_resolved: resolved,
    services: args.services,
    weather: args.weather,
    today,
    freshness: { data_as_of: now.toISOString(), oldest_source_at: args.sourceTimes.oldest, stale_sources: args.sourceTimes.stale },
    generated_at: now.toISOString(),
  }
}
