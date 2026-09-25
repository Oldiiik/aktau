// End-to-end: one coherent system from source announcement to every surface.
//  1 raw AUES announcement → 2 extraction → 3 approval → 4 CityEvent →
//  5 home 14 mkr/21 matches → 6 Aktau Now affecting_user → 7 widget →
//  8 notification delivery → 9 Ask finds it → 10 resolution → 11 all update.
// Runs against real PostgreSQL 18 + PostGIS (PGlite) with the real migrations.
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminUpdateEvent, askAktau, createSql, getAktauNow, getWidgetState, ingestManual, loadEventDetail, publishCandidate,
  registerDevice, saveLocation, type Sql,
} from '@aktau/server'
import { migrate, seed } from '../packages/server/src/db/migrate.ts'
import { fromLocal } from '@aktau/normalization'
import { cacheSet } from '../packages/server/src/cache.ts'

let db: PGlite
let server: PGLiteSocketServer
let sql: Sql
const NOW = new Date('2026-09-23T15:00:00Z') // 20:00 Aktau, the evening before
const INSTALL_21 = 'test-install-house-21'
const INSTALL_42 = 'test-install-house-42'

beforeAll(async () => {
  db = await PGlite.create({ extensions: { postgis } })
  server = new PGLiteSocketServer({ db, port: 0, maxConnections: 2 })
  await server.start()
  const port = (server as unknown as { server: { address(): { port: number } } }).server.address().port
  sql = createSql(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1 })
  await migrate(sql, () => {})
  await seed(sql, () => {})
  // Deterministic weather (no network in tests).
  await cacheSet(sql, 'open_meteo', 'forecast:aktau', {
    current: { time: NOW.toISOString(), temperature_2m: 21, apparent_temperature: 20, weather_code: 1, wind_speed_10m: 8, wind_direction_10m: 250, wind_gusts_10m: 11 },
    hourly: { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], wind_speed_10m: [], wind_gusts_10m: [] },
    daily: {}, utc_offset_seconds: 18000,
  }, 3600, NOW)
  // Lada checked recently → services can honestly be "Normal".
  await sql`update sources set last_successful_fetch_at = ${NOW} where slug = 'lada'`
})

afterAll(async () => {
  await sql?.end()
  await server?.stop()
  await db?.close()
})

async function home(installation: string, house: string) {
  await registerDevice(sql, { installation_id: installation, platform: 'web', language: 'en' })
  const [b] = await sql<{ id: string }[]>`select b.id from buildings b join areas a on a.id = b.area_id where a.designator = '14' and b.house_number_norm = ${house}`
  expect(b, `building 14/${house} seeded from OSM`).toBeTruthy()
  return saveLocation(sql, installation, { label: 'Home', type: 'HOME', building_id: b!.id })
}

describe('Aktau end-to-end', () => {
  let eventId = ''
  let candidateId = ''

  it('0. initial state: everything around you looks normal', async () => {
    await home(INSTALL_21, '21')
    await home(INSTALL_42, '42')
    const now = await getAktauNow(sql, { installation_id: INSTALL_21 }, 'en', NOW)
    expect(now.location.label).toBe('Home · 14 microdistrict')
    expect(now.overall).toBe('CALM')
    expect(now.headline).toBe('Everything around you looks normal.')
    expect(now.services.find((s) => s.key === 'electricity')?.state).toBe('NORMAL')
  })

  it('1–2. raw AUES announcement is preserved and extracted', async () => {
    const text = 'ГКП «АУЭС» сообщает: 24 сентября с 13:30 до 17:30 в связи с плановыми ремонтными работами будет отключена электроэнергия в 14 микрорайоне, дома №19, 20, 21, 22, 23.'
    const r = await ingestManual(sql, { source_slug: 'aues', text, title: 'Плановое отключение', actor: 'admin:test', published_at: '2026-09-23T14:00:00Z', now: NOW })
    expect(r.candidate_ids).toHaveLength(1)
    candidateId = r.candidate_ids[0]!
    const [raw] = await sql<{ raw_text: string; processing_status: string }[]>`select raw_text, processing_status from source_items where id = ${r.source_item_id}`
    expect(raw!.raw_text).toBe(text)
    expect(raw!.processing_status).toBe('REVIEW_REQUIRED')
    const [c] = await sql<{ extracted: { buildings: string[]; areas: string[] } }[]>`select extracted from event_candidates where id = ${candidateId}`
    expect(c!.extracted.areas).toEqual(['14'])
    expect(c!.extracted.buildings).toEqual(['19', '20', '21', '22', '23'])
    // Nothing is public before approval.
    expect((await sql`select 1 from city_events`).length).toBe(0)
  })

  it('3–4. approval creates exactly one CityEvent with evidence and history', async () => {
    const res = await publishCandidate(sql, candidateId, { actor: 'admin:test', now: NOW })
    expect(res.action).toBe('created')
    eventId = res.event_id
    const d = (await loadEventDetail(sql, eventId, null))!
    expect(d).toMatchObject({ category: 'ELECTRICITY', status: 'SCHEDULED', reported_authority: 'AUES', verification_status: 'OFFICIAL', building_count: 5 })
    expect(d.starts_at).toBe(fromLocal(2026, 9, 24, 13, 30).toISOString())
    expect(d.expected_ends_at).toBe(fromLocal(2026, 9, 24, 17, 30).toISOString())
    expect(d.areas.map((a) => [a.designator, a.coverage])).toEqual([['14', 'BUILDINGS_ONLY']])
    expect(d.sources.map((s) => s.relationship)).toEqual(['PRIMARY'])
    expect(d.updates.map((u) => u.update_type)).toEqual(['CREATED'])
  })

  it('5–6. home 14 mkr/21 is affected; 14 mkr/42 is only "in your microdistrict"', async () => {
    const n21 = await getAktauNow(sql, { installation_id: INSTALL_21 }, 'en', NOW)
    expect(n21.affecting_user).toBe(1)
    expect(n21.overall).toBe('ATTENTION')
    expect(n21.headline).toBe('1 upcoming change affects your home.')
    expect(n21.priority_event?.id).toBe(eventId)
    expect(n21.priority_event?.relevance).toBe('DIRECT')
    const n42 = await getAktauNow(sql, { installation_id: INSTALL_42 }, 'en', NOW)
    expect(n42.priority_event?.relevance).toBe('AREA')
  })

  it('7. widget state changes', async () => {
    const w = await getWidgetState(sql, { installation_id: INSTALL_21 }, 'en', NOW)
    expect(w).toMatchObject({ status: 'ATTENTION', headline: 'Electricity maintenance', event_id: eventId, deep_link: `aktau://event/${eventId}` })
    expect(w.detail).toBe('13:30–17:30 · Affects your home')
  })

  it('8. notification delivery created — only for the affected building, once', async () => {
    const rows = await sql<{ installation_id: string; notification_type: string; title: string; body: string }[]>`
      select d.installation_id, n.notification_type, n.title, n.body from notification_deliveries n join device_installations d on d.id = n.installation_id`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ installation_id: INSTALL_21, notification_type: 'PLANNED', body: 'Your home is affected from 13:30–17:30.' })
  })

  it('8b. the same outage reported again (Lada) merges as evidence, no duplicate card or alert', async () => {
    const r = await ingestManual(sql, { source_slug: 'lada', actor: 'admin:test', published_at: '2026-09-23T14:30:00Z', now: NOW,
      text: 'По информации ГКП «АУЭС», 24 сентября с 13:30 до 17:30 электроснабжение ограничат в 14 микрорайоне. Под отключение попадут дома №19, 20, 21, 22 и 23.' })
    const res = await publishCandidate(sql, r.candidate_ids[0]!, { actor: 'admin:test', now: NOW })
    expect(res).toMatchObject({ action: 'merged', event_id: eventId, relationship: 'CONFIRMING' })
    expect((await sql`select 1 from city_events`).length).toBe(1)
    expect((await sql`select 1 from notification_deliveries`).length).toBe(1)
  })

  it('9. Ask finds the same event', async () => {
    const a = await askAktau(sql, { question: 'Will I have electricity tomorrow at 3 PM?', lang: 'en', location: { installation_id: INSTALL_21 } }, NOW)
    expect(a.intent).toBe('UPCOMING_OUTAGE')
    expect(a.message).toBe('No, a planned interruption affecting your building is scheduled from 13:30 to 17:30.')
    expect(a.event_ids).toContain(eventId)
    expect(a.confidence).toBe('confirmed')
    expect(a.sources[0]?.name).toContain('AUES')
    const other = await askAktau(sql, { question: 'Will I have water tomorrow morning?', lang: 'en', location: { installation_id: INSTALL_21 } }, NOW)
    expect(other.confidence).toBe('no_information')
    expect(other.message).toBe('No confirmed information about a water interruption for your address has been found.')
  })

  it('10–11. start → ETA update → resolution propagate everywhere, with history', async () => {
    const during = new Date('2026-09-24T09:00:00Z') // 14:00 local
    await sql`update city_events set status = 'ACTIVE' where id = ${eventId}`
    await sql`insert into city_event_updates (event_id, update_type, previous_status, new_status, message, actor) values (${eventId}, 'STATUS_CHANGED', 'SCHEDULED', 'ACTIVE', 'Scheduled start time reached', 'system:schedule')`
    // Newer official update: estimate moves 17:30 → 18:30.
    const upd = await ingestManual(sql, { source_slug: 'aues', actor: 'admin:test', published_at: '2026-09-24T12:00:00Z', now: during,
      text: 'АУЭС: ориентировочное время восстановления электроснабжения в 14 микрорайоне, дома 19, 20, 21, 22, 23 — 18:30.' })
    const m = await publishCandidate(sql, upd.candidate_ids[0]!, { actor: 'admin:test', now: during })
    expect(m.relationship).toBe('UPDATE')
    let d = (await loadEventDetail(sql, eventId, null))!
    expect(d.expected_ends_at).toBe(fromLocal(2026, 9, 24, 18, 30).toISOString())
    expect(d.status).toBe('DELAYED')
    expect(d.updates.find((u) => u.update_type === 'ETA_CHANGED')?.previous_expected_end).toBe(fromLocal(2026, 9, 24, 17, 30).toISOString())
    const w = await getWidgetState(sql, { installation_id: INSTALL_21 }, 'en', during)
    expect(w.status).toBe('DISRUPTION')
    expect(w.detail).toContain('Expected restoration · 18:30')

    await adminUpdateEvent(sql, eventId, { status: 'RESOLVED', message: 'AUES confirmed restoration.' }, 'admin:test')
    d = (await loadEventDetail(sql, eventId, null))!
    expect(d.status).toBe('RESOLVED')
    // Newest first: resolved ← estimate moved (status → DELAYED) ← started ← confirmed by Lada ← published.
    expect(d.updates.map((u) => [u.update_type, u.new_status])).toEqual([
      ['STATUS_CHANGED', 'RESOLVED'], ['ETA_CHANGED', 'DELAYED'], ['STATUS_CHANGED', 'DELAYED'], ['STATUS_CHANGED', 'ACTIVE'], ['CONFIRMED', 'SCHEDULED'], ['CREATED', 'SCHEDULED'],
    ])

    const after = new Date()
    const n = await getAktauNow(sql, { installation_id: INSTALL_21 }, 'en', after)
    expect(n.affecting_user).toBe(0)
    expect(n.recently_resolved?.id).toBe(eventId)
    expect((await getWidgetState(sql, { installation_id: INSTALL_21 }, 'en', after)).event_id).toBeNull()
    const types = (await sql<{ notification_type: string }[]>`select notification_type from notification_deliveries order by created_at`).map((r) => r.notification_type)
    expect(types).toEqual(['PLANNED', 'UPDATED', 'RESOLVED'])
    const a = await askAktau(sql, { question: 'Is there electricity now?', lang: 'en', location: { installation_id: INSTALL_21 } }, after)
    expect(a.confidence).toBe('no_information')
  })

  it('security: anon can read approved city state but not raw sources, and cannot write events', async () => {
    // Since the 2026-09-24 hardening the evidence view runs with the caller's rights: over Supabase's
    // REST route anon sees no raw source excerpts. The app serves the evidence chain from the server.
    expect((await loadEventDetail(sql, eventId, null))!.sources.length).toBeGreaterThan(0)
    const r = await sql.begin(async (t) => {
      const tx = t as unknown as Sql
      await tx`set local role anon`
      const events = await tx<{ n: number }[]>`select count(*)::int n from city_events`
      const raw = await tx<{ n: number }[]>`select count(*)::int n from source_items`
      const candidates = await tx<{ n: number }[]>`select count(*)::int n from event_candidates`
      const devices = await tx<{ n: number }[]>`select count(*)::int n from device_installations`
      const evidence = await tx<{ n: number }[]>`select count(*)::int n from public_event_evidence`
      return { events: events[0]!.n, raw: raw[0]!.n, candidates: candidates[0]!.n, devices: devices[0]!.n, evidence: evidence[0]!.n }
    })
    expect(r.events).toBeGreaterThan(0)
    expect(r).toMatchObject({ raw: 0, candidates: 0, devices: 0, evidence: 0 })
    await expect(sql.begin(async (t) => {
      const tx = t as unknown as Sql
      await tx`set local role anon`
      await tx`update city_events set status = 'RESOLVED', resolved_at = now()`
    })).rejects.toThrow()
  })
})
