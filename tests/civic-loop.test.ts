// The civic loop, end to end on real PostgreSQL + PostGIS (PGlite, real migrations):
// one report → neighbours in scope see it → they confirm (not duplicates) →
// a team is assigned and commits → deadline change with a reason → work →
// completion with proof → the affected residents verify → verified / reopened;
// the problem returns → linked; a live demo session runs the same pipeline.
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  confirmIncident, createSession, createSql, incidentAction, incidentAnalytics, incidentDetail, incidentSweep, joinSession, mergeIncident, nearbyFor, previewSignal, registerDevice,
  reportReturned, saveLocation, sessionState, submitSignal, verifyIncident, type Sql,
} from '@aktau/server'
import { migrate, seed } from '../packages/server/src/db/migrate.ts'

let db: PGlite
let server: PGLiteSocketServer
let sql: Sql
const NOW = new Date('2026-09-24T09:00:00Z') // 14:00 Aktau
const at = (min: number) => new Date(NOW.getTime() + min * 60_000)

async function home(installation: string, house: string) {
  await registerDevice(sql, { installation_id: installation, platform: 'web', language: 'ru' })
  const [b] = await sql<{ id: string }[]>`select b.id from buildings b join areas a on a.id = b.area_id where a.designator = '14' and b.house_number_norm = ${house}`
  expect(b, `building 14/${house}`).toBeTruthy()
  await saveLocation(sql, installation, { label: 'Home', type: 'HOME', building_id: b!.id })
}
const after = { kind: 'after' as const, lat: 43.65586, lon: 51.1435, captured_at: at(80).toISOString(), hash: 'f0f0e0c081818fff', brightness: 0.6 }

beforeAll(async () => {
  db = await PGlite.create({ extensions: { postgis } })
  server = new PGLiteSocketServer({ db, port: 0, maxConnections: 2 })
  await server.start()
  const port = (server as unknown as { server: { address(): { port: number } } }).server.address().port
  sql = createSql(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1 })
  await migrate(sql, () => {})
  await seed(sql, () => {})
  await home('res-37', '37')
  await home('res-38', '38')
  await home('res-42', '42')
})

afterAll(async () => {
  await sql?.end()
  await server?.stop()
  await db?.close()
})

describe('civic loop', () => {
  let id = ''
  let code = ''

  it('1. one report → one incident with an affected scope', async () => {
    const r = await submitSignal(sql, { text: 'Сильная течь воды возле дома 37, 14 микрорайон', channel: 'APP', create: true, installation_id: 'res-37', actor: 'resident', now: NOW })
    id = r.incident_id!
    const d = (await incidentDetail(sql, id, { now: NOW }))!
    code = d.code
    expect(d.service).toBe('water')
    expect(d.problem_kind).toBe('damage')
    expect(d.scope_kind).toBe('radius')
    expect(d.scope_radius_m).toBe(150)
    expect(d.residents).toBe(1)
    // Internal steps are for 109 only.
    expect(d.timeline.some((x) => x.kind === 'routing' || x.kind === 'check')).toBe(false)
  })

  it('2. neighbours in the scope are asked; people outside are not', async () => {
    const b = await nearbyFor(sql, 'res-38', { now: NOW })
    const mine = b.items.find((x) => x.id === id)!
    expect(mine.relevance).toBe('DIRECT')
    expect(mine.ask).toBe('confirm')
    expect(mine.distance_m).toBeLessThan(150)
    const c = await nearbyFor(sql, 'res-42', { now: NOW })
    expect(c.items.find((x) => x.id === id)?.relevance).toBe('NEARBY')
    expect(c.items.find((x) => x.id === id)?.ask).toBeNull()
    const a = await nearbyFor(sql, 'res-37', { now: NOW })
    expect(a.items.find((x) => x.id === id)?.relation).toBe('reporter')
  })

  it('3. confirmations are one per person, never duplicates, and the reporter is already counted', async () => {
    const r = await confirmIncident(sql, id, { installation_id: 'res-38', state: 'confirmed', now: at(2) })
    expect(r).toMatchObject({ confirm_count: 1, changed: true, context: 'home_in_scope' })
    expect((await confirmIncident(sql, id, { installation_id: 'res-38', state: 'confirmed', now: at(3) })).changed).toBe(false)
    await expect(confirmIncident(sql, id, { installation_id: 'res-37', state: 'confirmed' })).rejects.toThrow(/already/)
    await confirmIncident(sql, id, { installation_id: 'res-42', state: 'not_affected', now: at(3) })
    for (const k of [1, 2, 3]) await confirmIncident(sql, id, { installation_id: `walker-${k}`, state: 'confirmed', lat: 43.6557, lon: 51.1433, note: 'вижу воду на тротуаре', now: at(4 + k) })
    const d = (await incidentDetail(sql, id, { now: at(10) }))!
    expect(d.confirm_count).toBe(4)
    expect(d.residents).toBe(5)
    expect(d.signal_count).toBe(1)
    const [o] = await sql<{ payload: { confirms: number } }[]>`select payload from realtime_outbox where topic = 'incidents' and entity_id = ${id} order by id desc limit 1`
    expect(o!.payload.confirms).toBe(4)
    // The report flow offers the same incident to the next person instead of a new one.
    const p = await previewSignal(sql, 'У дома 37 в 14 мкр течёт вода из-под асфальта', { now: at(11) })
    expect(p.matches[0]?.id).toBe(id)
    expect(p.matches[0]?.likely).toBe(true)
  })

  it('4. priority rises with the evidence and is explained', async () => {
    const d = (await incidentDetail(sql, id, { now: at(10) }))!
    expect(d.priority_reasons.map((r) => r.key)).toEqual(expect.arrayContaining(['service_water', 'residents']))
  })

  it('5. assigned → the team commits → a changed deadline needs a reason and keeps history', async () => {
    await incidentAction(sql, id, { action: 'route', org: 'KZhSA · Kaspiy Zhylu Su Arnasy', team: 'Аварийная бригада' }, 'operator:test', at(15))
    await expect(incidentAction(sql, id, { action: 'commit', finish_at: at(60).toISOString() }, 'operator:test', at(16))).resolves.toBeTruthy()
    await expect(incidentAction(sql, id, { action: 'commit', finish_at: at(120).toISOString() }, 'operator:test', at(20))).rejects.toThrow(/why/)
    await incidentAction(sql, id, { action: 'commit', finish_at: at(150).toISOString(), reason: 'Требуется дополнительное оборудование' }, 'operator:test', at(21))
    const d = (await incidentDetail(sql, id, { now: at(22) }))!
    expect(d.status).toBe('ACCEPTED')
    expect(d.team).toBe('Аварийная бригада')
    expect(d.deadlines).toHaveLength(2)
    expect(d.deadlines[1]).toMatchObject({ from: at(60).toISOString(), to: at(150).toISOString(), reason: 'Требуется дополнительное оборудование' })
    const msgs = await sql<{ installation_id: string; kind: string }[]>`select installation_id, kind from incident_messages where incident_id = ${id} order by created_at`
    expect(msgs.filter((m) => m.kind === 'deadline_changed').map((m) => m.installation_id).sort()).toEqual(['res-37', 'res-38', 'walker-1', 'walker-2', 'walker-3'])
    expect(msgs.some((m) => m.installation_id === 'res-42')).toBe(false)
  })

  it('6. completion needs a description and, for a visible fix, an "after" photo', async () => {
    await incidentAction(sql, id, { action: 'dispatch' }, 'operator:test', at(30))
    await expect(incidentAction(sql, id, { action: 'complete', note: '' }, 'operator:test', at(90))).rejects.toThrow(/Describe/)
    await expect(incidentAction(sql, id, { action: 'complete', note: 'Заменён участок трубы' }, 'operator:test', at(90))).rejects.toThrow(/after/)
    await incidentAction(sql, id, { action: 'complete', note: 'Заменён повреждённый участок трубы', photos: [after], cause: 'Износ трубы' }, 'operator:test', at(90))
    const d = (await incidentDetail(sql, id, { installation_id: 'res-38', now: at(91) }))!
    expect(d.status).toBe('EVIDENCE_SUBMITTED')
    expect(d.verification.round).toBe(1)
    expect(d.cause_source).toBe('organization')
    expect(d.can_verify).toBe(true)
    expect((await nearbyFor(sql, 'res-38', { now: at(91) })).items.find((x) => x.id === id)?.ask).toBe('verify')
  })

  it('7. only people who experienced it verify; the aggregate closes it', async () => {
    await expect(verifyIncident(sql, id, 'res-42', { answer: 'yes' }, at(92))).rejects.toThrow(/Only residents/)
    expect((await verifyIncident(sql, id, 'res-38', { answer: 'yes', quality: 5, speed: 4 }, at(93))).outcome).toBe('pending')
    expect((await verifyIncident(sql, id, 'walker-1', { answer: 'no' }, at(94))).outcome).toBe('pending')
    const r = await verifyIncident(sql, id, 'walker-2', { answer: 'yes', quality: 4 }, at(95))
    expect(r).toMatchObject({ outcome: 'verified', yes: 2, no: 1, pct: 67 })
    const d = (await incidentDetail(sql, id, { now: at(96) }))!
    expect(d.status).toBe('VERIFIED')
    expect(d.closed_by).toBe('residents')
    expect(d.verify_quality).toBe(4.5)
  })

  it('8. the problem comes back → a new incident linked to the previous repair', async () => {
    const r = await reportReturned(sql, id, { installation_id: 'res-38', note: 'Снова течёт у дома 37' })
    const d = (await incidentDetail(sql, r.incident_id!))!
    expect(d.previous?.code).toBe(code)
    expect(d.priority_reasons.map((x) => x.key)).toContain('recurring')
    // Two "no" among three answers reopen it.
    await incidentAction(sql, d.id, { action: 'route', team: 'Бригада 2' }, 'operator:test')
    await confirmIncident(sql, d.id, { installation_id: 'res-37', state: 'confirmed' })
    await confirmIncident(sql, d.id, { installation_id: 'walker-9', state: 'confirmed' })
    await incidentAction(sql, d.id, { action: 'complete', note: 'Подтянули соединение', photos: [after] }, 'operator:test')
    await verifyIncident(sql, d.id, 'res-38', { answer: 'no' })
    await verifyIncident(sql, d.id, 'res-37', { answer: 'yes' })
    const out = await verifyIncident(sql, d.id, 'walker-9', { answer: 'no' })
    expect(out.outcome).toBe('reopen')
    const again = (await incidentDetail(sql, d.id))!
    expect(again.status).toBe('DISPUTED')
    expect(again.reopen_count).toBe(1)
  })

  it('9. a duplicate incident merges into one; nobody is counted twice', async () => {
    const a = await submitSignal(sql, { text: '14 мкр дом 21 не работает лифт', channel: 'APP', create: true, installation_id: 'lift-1', now: NOW })
    const b = await submitSignal(sql, { text: 'Лифт стоит, 14 микрорайон, 21 дом', channel: 'PHONE', create: true, now: NOW })
    await confirmIncident(sql, b.incident_id!, { installation_id: 'lift-1', state: 'confirmed' }).catch(() => null)
    await confirmIncident(sql, b.incident_id!, { installation_id: 'lift-2', state: 'confirmed' })
    await mergeIncident(sql, b.incident_id!, a.incident_id!, 'operator:test')
    const into = (await incidentDetail(sql, a.incident_id!))!
    expect(into.signal_count).toBe(2)
    expect(into.confirm_count).toBe(1)
    const from = (await incidentDetail(sql, b.incident_id!))!
    expect(from.merged_into?.id).toBe(a.incident_id)
  })

  it('10a. incidents from before scopes existed get one on the next sweep', async () => {
    const r = await submitSignal(sql, { text: '14 мкр дом 38 не горит фонарь во дворе', channel: 'PHONE', create: true, now: NOW })
    await sql`delete from incident_areas where incident_id = ${r.incident_id}`
    await sql`update incidents set scope_kind = null, scope_radius_m = null where id = ${r.incident_id}`
    const out = await incidentSweep(sql)
    expect(out.scoped).toBeGreaterThanOrEqual(1)
    const d = (await incidentDetail(sql, r.incident_id!))!
    expect(d.scope_kind).toBe('radius')
    expect(d.scope_radius_m).toBe(150)
  })

  it('10. analytics come from real incidents', async () => {
    const a = await incidentAnalytics(sql, { includeDemo: true })
    expect(a.verified).toBeGreaterThanOrEqual(1)
    expect(a.reopened).toBeGreaterThanOrEqual(1)
    expect(a.recurring).toBeGreaterThanOrEqual(1)
  })
})

describe('live demo session: same pipeline, the session is the scope', () => {
  it('QR members get the problem, confirm, see progress and verify; staff never count as residents', async () => {
    const s = await createSession(sql, { title: 'Smart City Aktau Hackathon', venue: 'Mangystau Hub', actor: 'admin:test' })
    for (const m of ['jury-b', 'jury-c', 'jury-d']) await joinSession(sql, s.code, m, 'ru')
    // The presenter (a staff account) reports through the normal report path.
    const r = await submitSignal(sql, { text: 'Wi-Fi в зале работает нестабильно', channel: 'APP', create: true, installation_id: 'presenter', origin: 'staff', session_id: s.id, public_title: 'Wi-Fi в зале работает нестабильно', actor: 'admin:test' })
    const incidentId = r.incident_id!
    let st = (await sessionState(sql, s.code, 'jury-b'))!
    expect(st.members).toBe(3)
    expect(st.current?.id).toBe(incidentId)
    expect(st.current?.scope_kind).toBe('demo_session')
    expect(st.current?.ask).toBe('confirm')
    expect((await sessionState(sql, s.code, 'stranger'))!.current?.ask).toBeNull()
    // Not visible to a city resident's home.
    expect((await nearbyFor(sql, 'res-38')).items.some((x) => x.id === incidentId)).toBe(false)

    for (const [k, m] of ['jury-b', 'jury-c', 'jury-d'].entries()) {
      const c = await confirmIncident(sql, incidentId, { installation_id: m, state: 'confirmed' })
      expect(c.confirm_count).toBe(k + 1)
    }
    await incidentAction(sql, incidentId, { action: 'route' }, 'admin:test')
    await incidentAction(sql, incidentId, { action: 'commit', finish_at: new Date(Date.now() + 10 * 60_000).toISOString() }, 'admin:test')
    await incidentAction(sql, incidentId, { action: 'dispatch' }, 'admin:test')
    st = (await sessionState(sql, s.code, 'jury-c'))!
    expect(st.current).toMatchObject({ status: 'IN_PROGRESS', team: 'Demo IT Team', responsible_org: 'Mangystau Hub' })
    await incidentAction(sql, incidentId, { action: 'complete', note: 'Перезагрузили точку доступа, канал сменён на свободный' }, 'admin:test')
    expect((await sessionState(sql, s.code, 'jury-b'))!.current?.ask).toBe('verify')
    // The presenter reported it but is staff: not asked, not counted.
    expect((await sessionState(sql, s.code, 'presenter'))!.current?.ask).toBeNull()
    await verifyIncident(sql, incidentId, 'jury-b', { answer: 'yes' })
    await verifyIncident(sql, incidentId, 'jury-c', { answer: 'yes' })
    await expect(verifyIncident(sql, incidentId, 'presenter', { answer: 'yes' })).rejects.toThrow(/Only residents/)
    const v = await verifyIncident(sql, incidentId, 'jury-d', { answer: 'no' })
    expect(v).toMatchObject({ outcome: 'verified', yes: 2, no: 1, pct: 67 })
    st = (await sessionState(sql, s.code, 'jury-b'))!
    expect(st.current?.status).toBe('VERIFIED')
    expect(st.live).toMatchObject({ resident_signals: 3, participants: 3, eligible: 3 })
    const [o] = await sql<{ payload: { session: string } }[]>`select payload from realtime_outbox where entity_id = ${incidentId} order by id desc limit 1`
    expect(o!.payload.session).toBe(s.id)
  })
})

describe('"only us": one flat is nobody else\'s outage until a second flat says so', () => {
  it('the neighbour is not told; "only us" again changes nothing; a report without it brings the house in', async () => {
    await home('flat-42b', '42')
    const t0 = at(24 * 60)
    const r = await submitSignal(sql, { text: '14 мкр дом 42, нет света в квартире', channel: 'APP', create: true, installation_id: 'res-42', actor: 'resident', now: t0 })
    const id = r.incident_id!
    let d = (await incidentDetail(sql, id, { now: t0 }))!
    expect(d).toMatchObject({ service: 'electricity', scope_kind: 'buildings', scope_houses: [] })
    const told = async (inst: string, now: Date) => (await nearbyFor(sql, inst, { now })).items.find((x) => x.id === id)?.relevance
    expect(await told('flat-42b', t0)).not.toBe('DIRECT')

    // The same words again (the same flat, another channel): still nobody else.
    const again = await previewSignal(sql, 'Нет света только у нас, 14 мкр 42', { now: at(24 * 60 + 5) })
    expect(again.matches[0]).toMatchObject({ id, likely: true })
    await submitSignal(sql, { text: 'Нет света только у нас, 14 мкр 42', channel: 'PHONE', attach_to: id, now: at(24 * 60 + 5) })
    d = (await incidentDetail(sql, id, { now: at(24 * 60 + 5) }))!
    expect(d.scope_houses).toEqual([])

    // Someone in the house without "only us": the house is in, and the neighbour is told.
    await submitSignal(sql, { text: '14 мкр дом 42 нет света', channel: 'PHONE', attach_to: id, now: at(24 * 60 + 10) })
    d = (await incidentDetail(sql, id, { now: at(24 * 60 + 10) }))!
    expect(d.scope_houses).toEqual(['42'])
    expect(await told('flat-42b', at(24 * 60 + 11))).toBe('DIRECT')
  })
})
