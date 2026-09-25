// The pilot simulation runs the production engine. Two checks on the real
// seeded city (PGlite + PostGIS, the real migrations):
//   1. a simulated week keeps the properties the pilot depends on
//      (duplicates grouped, nobody's real report blocked, dangers critical,
//      the right residents told), measured against the scenario's ground truth;
//   2. the same reports replayed through the real database pipeline
//      (previewSignal → confirmIncident / submitSignal) form the same incidents
//      as the in-memory engine: the simulation is not a separate model.
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { confirmIncident, createSql, loadPilotCity, previewSignal, registerDevice, runPilot, saveLocation, simulatePilot, submitSignal, type PilotCity, type Sql } from '@aktau/server'
import { migrate, seed } from '../packages/server/src/db/migrate.ts'

let db: PGlite
let server: PGLiteSocketServer
let sql: Sql
let city: PilotCity
const NOW = new Date('2026-09-25T06:00:00Z')

beforeAll(async () => {
  db = await PGlite.create({ extensions: { postgis } })
  server = new PGLiteSocketServer({ db, port: 0, maxConnections: 2 })
  await server.start()
  const port = (server as unknown as { server: { address(): { port: number } } }).server.address().port
  sql = createSql(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1 })
  await migrate(sql, () => {})
  await seed(sql, () => {})
  city = await loadPilotCity(sql)
})

afterAll(async () => {
  await sql?.end()
  await server?.stop()
  await db?.close()
})

describe('pilot simulation', () => {
  it('loads the real city: microdistricts, buildings, adjacency', () => {
    expect(city.areas.length).toBeGreaterThan(60)
    expect(city.buildings.length).toBeGreaterThan(3000)
    expect([...city.adjacency.values()].some((s) => s.size > 0)).toBe(true)
  })

  it('a simulated week: duplicates grouped, no real report blocked, dangers first, the right people told', async () => {
    const r = await runPilot(sql, { reports: 3000, seed: 11, now: NOW })
    expect(r.input.reports).toBe(3000)
    expect(r.dedup.incidents).toBeLessThan(r.input.reports / 8)
    expect(r.dedup.reports_placed_right).toBeGreaterThanOrEqual(95)
    expect(r.gate.genuine_blocked).toBe(0)
    expect(r.gate.blocked_by_rules + r.gate.stopped_no_address).toBeGreaterThan(r.gate.spam * 0.6)
    expect(r.safety.critical).toBeGreaterThanOrEqual(r.safety.dangers - 1)
    expect(r.safety.blocked).toBe(0)
    expect(r.understanding.service_ok).toBeGreaterThanOrEqual(97)
    expect(r.notify.precision).toBeGreaterThanOrEqual(80)
    // "No water in my flat" is not the whole house's, and an outage tells the houses it is in.
    expect(r.understanding.house_ok).toBeGreaterThanOrEqual(97)
    expect(r.notify.precision_by.outages!.precision).toBeGreaterThanOrEqual(95)
    expect(r.notify.precision_by.building!.precision).toBeGreaterThanOrEqual(60)
    expect(r.notify.recall).toBeGreaterThanOrEqual(75)
    expect(r.routing.correct).toBeGreaterThanOrEqual(80)
  }, 120_000)

  it('the same reports through the real database pipeline form the same incidents', async () => {
    const sim = await simulatePilot(city, { reports: 260, days: 1, seed: 5, now: NOW, spamShare: 0, lifecycle: false, debug: true })
    const { sc, outcomes } = (sim as unknown as { debug: { sc: { reports: Array<{ id: number; at: number; channel: string; resident: number | null }>; residents: Array<{ building: number; hasHome: boolean }> }; outcomes: Array<{ action: string; incident: number | null; input: { text: string; lat: number | null; lon: number | null } }> } }).debug
    // Residents who report from the app get a device and, if they saved one, a home.
    const devices = new Set<number>()
    for (const rep of sc.reports) {
      if (rep.resident == null || devices.has(rep.resident)) continue
      devices.add(rep.resident)
      const iid = `pilot-${rep.resident}`
      await registerDevice(sql, { installation_id: iid, platform: 'web', language: 'ru' })
      const res = sc.residents[rep.resident]!
      if (res.hasHome) await saveLocation(sql, iid, { label: 'Home', type: 'HOME', building_id: city.buildings[res.building]!.id })
    }
    // Replay: the resident (or operator) takes the "already reported" suggestion at 80 %, otherwise opens a new incident.
    const dbIncident = new Map<number, string | null>()
    for (const rep of sc.reports) {
      const oc = outcomes[rep.id]!
      if (oc.action === 'stopped' || oc.action === 'blocked') continue
      const now = new Date(rep.at)
      const { text, lat, lon } = oc.input
      const p = await previewSignal(sql, text, { now, lat, lon })
      const likely = p.matches.find((m) => m.likely) ?? null
      const iid = rep.resident != null ? `pilot-${rep.resident}` : null
      if (rep.channel === 'APP') {
        if (likely) {
          try { await confirmIncident(sql, likely.id, { installation_id: iid!, state: 'confirmed', lat, lon, now }) } catch { /* already counted */ }
          dbIncident.set(rep.id, likely.id)
          continue
        }
        const s = await submitSignal(sql, { text, channel: 'APP', create: true, installation_id: iid, lat, lon, now, actor: 'resident' })
        dbIncident.set(rep.id, s.incident_id)
      } else {
        const s = likely
          ? await submitSignal(sql, { text, channel: rep.channel as 'PHONE', attach_to: likely.id, now, actor: 'operator' })
          : await submitSignal(sql, { text, channel: rep.channel as 'PHONE', create: true, now, actor: 'operator' })
        dbIncident.set(rep.id, s.incident_id)
      }
    }
    // Same partition: two reports share a simulated incident exactly when they share a database incident.
    const pairs = new Map<number, string>()
    let agree = 0, total = 0
    for (const [id, dbId] of dbIncident) {
      const n = outcomes[id]!.incident!
      total++
      if (!pairs.has(n)) pairs.set(n, dbId!)
      if (pairs.get(n) === dbId) agree++
    }
    const distinctDb = new Set(pairs.values()).size
    expect(total).toBeGreaterThan(200)
    expect(distinctDb).toBe(pairs.size)
    expect(agree / total).toBeGreaterThanOrEqual(0.98)
  }, 180_000)
})
