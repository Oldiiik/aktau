// Apply migrations + seed to any Postgres (e.g. Supabase) via DATABASE_URL.
//   DATABASE_URL=postgres://… npm run db:migrate
// On Supabase the local compatibility shim is skipped automatically (the real
// `auth` schema exists). `supabase db push` works equally well for migrations.
import { createSql } from '../packages/server/src/db/client.ts'
import { migrate, seed } from '../packages/server/src/db/migrate.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const sql = createSql(url, { max: 1 })
console.log('▸ migrations'); await migrate(sql)
if (!process.argv.includes('--no-seed')) { console.log('▸ seed'); await seed(sql) }
await sql.end()
console.log('▸ done')
