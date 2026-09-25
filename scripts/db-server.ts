// Local PostgreSQL for development without Docker:
// PGlite (PostgreSQL 18 compiled to WASM) + PostGIS, persisted to .data/pglite,
// exposed over the Postgres wire protocol so the app connects with a normal
// DATABASE_URL — exactly as it does to Supabase in production.
//
//   npm run db          start (migrates + seeds on first boot)
//   npm run db -- --reset   wipe .data/pglite first
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createSql } from '../packages/server/src/db/client.ts'
import { migrate, seed } from '../packages/server/src/db/migrate.ts'

const root = new URL('..', import.meta.url).pathname
const dataDir = join(root, '.data/pglite')
const port = Number(process.env.PGLITE_PORT ?? 54329)

if (process.argv.includes('--reset')) rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const t0 = Date.now()
const db = await PGlite.create({ dataDir, extensions: { postgis } })
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 4 })
await server.start()
console.log(`▸ PGlite ${(await db.query<{ v: string }>('select version() v')).rows[0]?.v.split(' ').slice(0, 2).join(' ')} + PostGIS on 127.0.0.1:${port} (${Date.now() - t0} ms)`)

const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
const sql = createSql(url, { max: 1 })
console.log('▸ migrations')
await migrate(sql)
console.log('▸ seed')
await seed(sql)
const [c] = await sql<{ areas: number; buildings: number; sources: number }[]>`
  select (select count(*) from areas)::int areas, (select count(*) from buildings)::int buildings, (select count(*) from sources)::int sources`
await sql.end()
console.log(`▸ ready · ${c?.areas} areas · ${c?.buildings} buildings · ${c?.sources} sources`)
console.log(`  DATABASE_URL=${url}`)

const shutdown = async () => {
  await server.stop()
  await db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
