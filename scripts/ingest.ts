// Run a connector job from the command line (same code path as cron):
//   npm run ingest -- media        (lada)
//   npm run ingest -- weather | observations | air-marine | places | lifecycle
//   npm run ingest -- source lada  (a single source)
import { createSql, runJob, runSource } from '../packages/server/src/index.ts'

const [kind, arg] = process.argv.slice(2)
const sql = createSql(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/postgres', { max: 1 })
const out = kind === 'source' && arg ? [await runSource(sql, arg)] : await runJob(sql, (kind ?? 'media') as Parameters<typeof runJob>[1])
console.table(out)
await sql.end()
