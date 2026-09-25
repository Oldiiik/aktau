// Notification engine: event change → potentially affected saved locations →
// relevance (same matcher as Home) → preferences → dedupe → delivery rows.
// In-app deliveries are complete once written; push deliveries stay PENDING
// until a configured sender (FCM → APNs) confirms them.
import { doesEventAffectLocation, notificationTypeFor, renderNotification, shouldNotify, dedupeKey, type ChangeKind } from '@aktau/city-core'
import type { AlertPreferences, Category, Coverage, EventStatus, Lang, Severity } from '@aktau/types'
import type { Sql } from './db/client.ts'
import { log } from './log.ts'

export type { ChangeKind } from '@aktau/city-core'

const DEFAULT_PREFS: AlertPreferences = {
  water: true, electricity: true, heating: true, road: true, transport: false, weather: true, emergency: true, events: false,
  affects_me_only: true, minimum_severity: 'MINOR',
}

type Recipient = {
  saved_location_id: string; installation_pk: string | null; user_id: string | null; area_id: string | null; building_id: string | null
  covering_area_ids: string[]; distance_m: number | null; language: Lang; push_token: boolean; enabled: boolean
  prefs: AlertPreferences | null
}

export async function notifyEventChange(sql: Sql, eventId: string, change: ChangeKind, updateId: string | null, now = new Date()) {
  const [ev] = await sql<{ id: string; category: Category; event_type: string; status: EventStatus; severity: Severity; starts_at: Date | null; expected_ends_at: Date | null; is_demo: boolean }[]>`
    select id, category, event_type, status, severity, starts_at, expected_ends_at, is_demo from city_events where id = ${eventId}`
  if (!ev) return { created: 0 }
  const type = notificationTypeFor(change, ev.status)
  if (!type) return { created: 0, skipped: 'no_notification_for_change' }

  const areas = await sql<{ area_id: string; coverage: Coverage }[]>`select area_id, coverage_type coverage from event_areas where event_id = ${eventId}`
  const buildingIds = (await sql<{ building_id: string }[]>`select building_id from event_buildings where event_id = ${eventId}`).map((r) => r.building_id)

  // Candidates: saved locations in/near the footprint. Resolved/cancelled
  // notifications go to everyone who could have been notified before.
  const recipients = await sql<Recipient[]>`
    with fp as (
      select coalesce(ST_Union(a.geometry::geometry), 'GEOMETRYCOLLECTION EMPTY'::geometry) g from event_areas ea join areas a on a.id = ea.area_id where ea.event_id = ${eventId}
    )
    select sl.id saved_location_id, sl.installation_id installation_pk, sl.user_id, coalesce(b.area_id, sl.area_id) area_id, sl.building_id,
      coalesce((select array_agg(a2.id) from areas a2 where a2.area_type = 'MICRODISTRICT' and sl.point is not null and ST_Covers(a2.geometry, sl.point)), '{}') covering_area_ids,
      case when coalesce(sl.point, b.point) is null then null else ST_Distance(coalesce(sl.point, b.point), (select g from fp)::geography) end distance_m,
      coalesce(d.language, 'ru') language, (d.push_token is not null) push_token, coalesce(d.enabled, true) enabled,
      (select to_jsonb(p) - 'id' - 'user_id' - 'installation_id' - 'updated_at' from alert_preferences p
        where (p.installation_id = sl.installation_id and sl.installation_id is not null) or (p.user_id = sl.user_id and sl.user_id is not null) limit 1) prefs
    from saved_locations sl
    left join buildings b on b.id = sl.building_id
    left join device_installations d on d.id = sl.installation_id
    where coalesce(b.area_id, sl.area_id) = any(${areas.map((a) => a.area_id)}::uuid[])
       or sl.building_id = any(${buildingIds}::uuid[])
       or (coalesce(sl.point, b.point) is not null and ST_DWithin(coalesce(sl.point, b.point), (select g from fp)::geography, 1500))`

  let created = 0
  for (const r of recipients) {
    const match = doesEventAffectLocation(
      { status: type === 'RESOLVED' || type === 'CANCELLED' ? 'ACTIVE' : ev.status, category: ev.category, areas, building_ids: buildingIds, distance_m: r.distance_m },
      { building_id: r.building_id, area_ids: [...new Set([r.area_id, ...r.covering_area_ids].filter((x): x is string => !!x))] },
    )
    const prefs = { ...DEFAULT_PREFS, ...(r.prefs ?? {}) }
    if (!r.enabled || !shouldNotify(prefs, ev, match)) continue
    const content = renderNotification(r.language, type, {
      id: ev.id, category: ev.category, event_type: ev.event_type, status: ev.status,
      starts_at: ev.starts_at?.toISOString() ?? null, expected_ends_at: ev.expected_ends_at?.toISOString() ?? null,
    }, now)
    const who = r.installation_pk ?? `user:${r.user_id}`
    const channels: Array<'in_app' | 'push'> = r.push_token ? ['in_app', 'push'] : ['in_app']
    for (const channel of channels) {
      const key = dedupeKey(`${channel}:${who}`, ev.id, type, ev.expected_ends_at?.toISOString() ?? null)
      const res = await sql`
        insert into notification_deliveries (event_id, event_update_id, user_id, installation_id, saved_location_id, notification_type, dedupe_key,
          status, relevance, channel, title, body, deep_link, sent_at, error)
        values (${ev.id}, ${updateId}, ${r.user_id}, ${r.installation_pk}, ${r.saved_location_id}, ${type}, ${key},
          ${channel === 'in_app' ? 'SENT' : 'PENDING'}, ${match.relevance}, ${channel}, ${content.title}, ${content.body}, ${content.deep_link},
          ${channel === 'in_app' ? now : null}, ${channel === 'push' && !process.env.FCM_SERVICE_ACCOUNT ? 'push sender not configured' : null})
        on conflict (dedupe_key) do nothing`
      created += res.count
    }
  }
  log('info', 'notify.processed', { event_id: eventId, type, candidates: recipients.length, created, demo: ev.is_demo })
  return { created, type }
}
