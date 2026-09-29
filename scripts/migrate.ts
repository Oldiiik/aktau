// Apply migrations + seed to any Postgres (e.g. Supabase) via DATABASE_URL.
//   DATABASE_URL=postgres://… npm run db:migrate
// On Supabase the local compatibility shim is skipped automatically (the real
// `auth` schema exists). `supabase db push` works equally well for migrations.
// On Vercel it runs before every build (apps/web/vercel.json); already applied
// files are skipped, and a project with no database connected builds anyway.
import { createSql, databaseUrl } from '../packages/server/src/db/client.ts'
import { migrate, seed } from '../packages/server/src/db/migrate.ts'

const url = databaseUrl()
if (!url && process.env.VERCEL) { console.log('▸ no database connected: migrations skipped'); process.exit(0) }
if (!url) throw new Error('DATABASE_URL is required')
const sql = createSql(url, { max: 1 })
console.log(`▸ database ${new URL(url).hostname}`)
console.log('▸ migrations'); await migrate(sql)
if (!process.argv.includes('--no-seed')) { console.log('▸ seed'); await seed(sql) }

// Vercel production: point Supabase Cron at this app. The cron secret is
// generated inside Vault and never leaves the database (the app reads it from
// there too). Every job also runs once now, so a fresh database has news,
// notices and afisha without waiting for their schedule.
const host = process.env.VERCEL_ENV === 'production' ? process.env.VERCEL_PROJECT_PRODUCTION_URL : undefined
const [{ vault } = { vault: false }] = await sql<{ vault: boolean }[]>`select exists (select 1 from pg_namespace where nspname = 'vault') as vault`
if (host && vault) {
  await sql`select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'Bearer for /api/cron/*')
            where not exists (select 1 from vault.secrets where name = 'cron_secret')`
  const base = `https://${host}`
  const [existing] = await sql<{ id: string }[]>`select id from vault.secrets where name = 'app_base_url'`
  if (existing) await sql`select vault.update_secret(${existing.id}::uuid, ${base})`
  else await sql`select vault.create_secret(${base}, 'app_base_url', 'Aktau production URL for Supabase Cron')`
  const [{ r } = { r: '' }] = await sql<{ r: string }[]>`select public.aktau_schedule_jobs() as r`
  await sql`select public.call_aktau_job(j) from unnest(array['weather', 'observations', 'air-marine', 'notices', 'media', 'places', 'afisha']) j`
  console.log(`▸ cron → ${base}: ${r}, first run queued`)
}

// Staff: accounts listed in AKTAU_ADMIN_EMAILS become admins. Sign up first,
// then add the address, so nobody else can register it in between.
const admins = (process.env.AKTAU_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
if (admins.length) {
  const done = await sql`update accounts set role = 'admin' where lower(email) = any(${admins}) and role <> 'admin' returning 1`
  console.log(`▸ admins: ${done.length} promoted`)
}

// A labelled demo incident in 6 microdistrict (scripts/demo-6mkr.ts), when asked for.
if (process.env.AKTAU_DEMO_SEED === '6mkr') {
  const { seedSixMkrDemo } = await import('./demo-6mkr.ts')
  console.log(`▸ demo: ${await seedSixMkrDemo(sql)}`)
}

await sql.end()
console.log('▸ done')
