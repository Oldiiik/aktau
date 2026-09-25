// Caspian Safety on real PostGIS with the real registry seed: the official list
// matches the act's current revision, unmapped entries never answer, prohibited
// wins, and an authority's closure changes the answer without touching legality.
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canISwimHere, caspianState, createSql, setZoneStatus, type Sql } from '@aktau/server'
import { migrate, seed } from '../packages/server/src/db/migrate.ts'

let db: PGlite
let server: PGLiteSocketServer
let sql: Sql

beforeAll(async () => {
  db = await PGlite.create({ extensions: { postgis } })
  server = new PGLiteSocketServer({ db, port: 0, maxConnections: 2 })
  await server.start()
  const port = (server as unknown as { server: { address(): { port: number } } }).server.address().port
  sql = createSql(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1 })
  await migrate(sql, () => {})
  await seed(sql, () => {})
})

afterAll(async () => {
  await sql?.end()
  await server?.stop()
  await db?.close()
})

const SOLDATSKY = { lat: 43.6216, lon: 51.2072 }
const RIVIERA_SHORE = { lat: 43.63281, lon: 51.157 }

describe('Caspian Safety registry', () => {
  it('lists the current revision of the act (items removed by № 99 are absent)', async () => {
    const s = await caspianState(sql, 'ru')
    const official = s.zones.filter((z) => z.legal_status === 'OFFICIAL')
    expect(official).toHaveLength(16)
    expect(official.every((z) => z.source.revision === '2026-06-26')).toBe(true)
    expect(s.zones.map((z) => z.official_text).join(' ')).not.toMatch(/Балдаурен|Алау/)
    expect(s.zones.filter((z) => z.legal_status === 'PROHIBITED')).toHaveLength(3)
  })

  it('draws only zones with a located map object', async () => {
    const s = await caspianState(sql, 'en')
    const drawn = new Set(s.geojson.features.filter((f) => f.properties.layer === 'zone').map((f) => f.properties.id))
    for (const z of s.zones) expect(drawn.has(z.id)).toBe(z.location.confidence !== 'unmapped')
  })
})

describe('can I swim here?', () => {
  it('official beach', async () => {
    const r = await canISwimHere(sql, SOLDATSKY.lat, SOLDATSKY.lon, 'en')
    expect(r.verdict).toMatchObject({ kind: 'official', operational: 'UNKNOWN' })
    expect(r.zone?.slug).toBe('soldatsky')
  })

  it('prohibited stretch, with the nearest official beach offered', async () => {
    const r = await canISwimHere(sql, RIVIERA_SHORE.lat, RIVIERA_SHORE.lon, 'en')
    expect(r.verdict.kind).toBe('prohibited')
    expect(r.zone?.slug).toBe('riviera-shevchenko')
    expect(r.nearest_official?.distance_m).toBeGreaterThan(1000)
  })

  it('shore in neither list, and a point inland', async () => {
    expect((await canISwimHere(sql, 43.63, 51.19, 'en')).verdict.kind).toBe('unlisted')
    expect((await canISwimHere(sql, 43.66, 51.17, 'en')).verdict.kind).toBe('inland')
  })

  it("an authority's closure changes the answer and the suggestion, not the legal status", async () => {
    const [z] = await sql<{ id: string }[]>`select id from coast_zones where slug = 'soldatsky'`
    await setZoneStatus(sql, z!.id, { status: 'CLOSED', source: 'ДЧС Мангистауской области', note: 'Шторм' }, 'test', null)
    const r = await canISwimHere(sql, SOLDATSKY.lat, SOLDATSKY.lon, 'en')
    expect(r.verdict).toMatchObject({ kind: 'official', operational: 'CLOSED' })
    expect(r.nearest_official?.slug).not.toBe('soldatsky')
    const [audit] = await sql<{ action: string }[]>`select action from audit_log where entity_id = ${z!.id}`
    expect(audit?.action).toBe('coast_zone.status')
    await setZoneStatus(sql, z!.id, { status: 'UNKNOWN', source: 'test reset' }, 'test', null)
    const [after] = await sql<{ operational_source: string | null }[]>`select operational_source from coast_zones where id = ${z!.id}`
    expect(after?.operational_source).toBeNull()
  })
})
