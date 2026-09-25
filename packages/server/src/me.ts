// Anonymous-first personalisation: device installation → saved places →
// alert preferences → in-app notification inbox. No account required.
import type { AlertPreferences, Lang } from '@aktau/types'
import type { Sql } from './db/client.ts'

export async function registerDevice(sql: Sql, d: { installation_id: string; platform: 'ios' | 'android' | 'web'; push_token?: string; language?: Lang; mode?: string }) {
  const [row] = await sql<{ id: string }[]>`
    insert into device_installations (installation_id, platform, push_token, language, mode)
    values (${d.installation_id}, ${d.platform}, ${d.push_token ?? null}, ${d.language ?? 'ru'}, ${d.mode ?? 'RESIDENT'})
    on conflict (installation_id) do update set last_seen_at = now(),
      push_token = coalesce(excluded.push_token, device_installations.push_token),
      language = coalesce(${d.language ?? null}, device_installations.language),
      mode = coalesce(${d.mode ?? null}, device_installations.mode)
    returning id`
  return row!.id
}

export async function installationPk(sql: Sql, installationId: string): Promise<string | null> {
  const [r] = await sql<{ id: string }[]>`select id from device_installations where installation_id = ${installationId}`
  return r?.id ?? null
}

export async function listLocations(sql: Sql, installationId: string) {
  return sql<{ id: string; label: string; type: string; is_primary: boolean; area_id: string | null; building_id: string | null; area_name: string | null; area_name_ru: string | null; area_name_kk: string | null; designator: string | null; house_number: string | null }[]>`
    select sl.id, sl.label, sl.type, sl.is_primary, coalesce(b.area_id, sl.area_id) area_id, sl.building_id,
      a.name area_name, a.name_ru area_name_ru, a.name_kk area_name_kk, a.designator, b.house_number
    from saved_locations sl join device_installations d on d.id = sl.installation_id
    left join buildings b on b.id = sl.building_id left join areas a on a.id = coalesce(b.area_id, sl.area_id)
    where d.installation_id = ${installationId}
    order by sl.is_primary desc, sl.created_at`
}

export async function saveLocation(sql: Sql, installationId: string, loc: { label: string; type: string; area_id?: string | null; building_id?: string | null; lat?: number; lon?: number; is_primary?: boolean }, lang?: Lang) {
  const pk = await registerDevice(sql, { installation_id: installationId, platform: 'web', language: lang })
  return sql.begin(async (t) => {
    const tx = t as unknown as Sql
    let areaId = loc.area_id ?? null
    if (loc.building_id && !areaId) areaId = (await tx<{ area_id: string }[]>`select area_id from buildings where id = ${loc.building_id}`)[0]?.area_id ?? null
    const makePrimary = loc.is_primary ?? loc.type === 'HOME'
    if (makePrimary) await tx`update saved_locations set is_primary = false where installation_id = ${pk}`
    // One HOME per installation: replace rather than accumulate.
    if (loc.type === 'HOME') await tx`delete from saved_locations where installation_id = ${pk} and type = 'HOME'`
    const [row] = await tx<{ id: string }[]>`
      insert into saved_locations (installation_id, label, type, area_id, building_id, point, is_primary)
      values (${pk}, ${loc.label}, ${loc.type}, ${areaId}, ${loc.building_id ?? null},
        ${loc.lat != null && loc.lon != null ? tx`ST_SetSRID(ST_MakePoint(${loc.lon}, ${loc.lat}), 4326)::geography` : null}, ${makePrimary})
      returning id`
    return row!.id
  })
}

export async function deleteLocation(sql: Sql, installationId: string, id: string) {
  await sql`delete from saved_locations sl using device_installations d where d.id = sl.installation_id and d.installation_id = ${installationId} and sl.id = ${id}`
}

export const DEFAULT_PREFS: AlertPreferences = {
  water: true, electricity: true, heating: true, road: true, transport: false, weather: true, emergency: true, events: false, affects_me_only: true, minimum_severity: 'MINOR',
}

export async function getPreferences(sql: Sql, installationId: string): Promise<AlertPreferences> {
  const [r] = await sql<AlertPreferences[]>`select water, electricity, heating, road, transport, weather, emergency, events, affects_me_only, minimum_severity
    from alert_preferences p join device_installations d on d.id = p.installation_id where d.installation_id = ${installationId}`
  return r ?? DEFAULT_PREFS
}

export async function setPreferences(sql: Sql, installationId: string, p: AlertPreferences, lang?: Lang) {
  const pk = await registerDevice(sql, { installation_id: installationId, platform: 'web', language: lang })
  await sql`insert into alert_preferences (installation_id, water, electricity, heating, road, transport, weather, emergency, events, affects_me_only, minimum_severity)
    values (${pk}, ${p.water}, ${p.electricity}, ${p.heating}, ${p.road}, ${p.transport}, ${p.weather}, true, ${p.events}, ${p.affects_me_only}, ${p.minimum_severity})
    on conflict (installation_id) do update set water = excluded.water, electricity = excluded.electricity, heating = excluded.heating, road = excluded.road,
      transport = excluded.transport, weather = excluded.weather, emergency = true, events = excluded.events,
      affects_me_only = excluded.affects_me_only, minimum_severity = excluded.minimum_severity`
}

export async function inbox(sql: Sql, installationId: string, limit = 30) {
  return sql<{ id: string; event_id: string; notification_type: string; title: string; body: string; deep_link: string; relevance: string; created_at: Date }[]>`
    select n.id, n.event_id, n.notification_type, n.title, n.body, n.deep_link, n.relevance, n.created_at
    from notification_deliveries n join device_installations d on d.id = n.installation_id
    where d.installation_id = ${installationId} and n.channel = 'in_app' order by n.created_at desc limit ${limit}`
}
