import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Sql } from './client.ts'

const repoRoot = new URL('../../../../', import.meta.url).pathname

/**
 * Applies supabase/migrations in order, tracked in _aktau_migrations.
 * On a non-Supabase Postgres (no `auth` schema) the local compatibility shim
 * runs first. On Supabase you may equally use `supabase db push`.
 */
export async function migrate(sql: Sql, log: (m: string) => void = console.log) {
  await sql`create table if not exists _aktau_migrations (name text primary key, applied_at timestamptz not null default now())`
  const applied = new Set((await sql<{ name: string }[]>`select name from _aktau_migrations`).map((r) => r.name))

  const rows = await sql<{ has_auth: boolean }[]>`select exists (select 1 from pg_namespace where nspname = 'auth') as has_auth`
  const has_auth = rows[0]?.has_auth ?? false
  if (!has_auth || applied.has('local/000_supabase_compat.sql')) {
    await applyFile(sql, 'local/000_supabase_compat.sql', join(repoRoot, 'supabase/local/000_supabase_compat.sql'), applied, log)
  }
  const dir = join(repoRoot, 'supabase/migrations')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await applyFile(sql, f, join(dir, f), applied, log)
  }
}

export async function seed(sql: Sql, log: (m: string) => void = console.log) {
  await sql`create table if not exists _aktau_migrations (name text primary key, applied_at timestamptz not null default now())`
  const applied = new Set((await sql<{ name: string }[]>`select name from _aktau_migrations`).map((r) => r.name))
  const dir = join(repoRoot, 'supabase/seed')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await applyFile(sql, `seed/${f}`, join(dir, f), applied, log)
  }
}

async function applyFile(sql: Sql, name: string, path: string, applied: Set<string>, log: (m: string) => void) {
  if (applied.has(name)) return
  const body = readFileSync(path, 'utf8')
  const t0 = Date.now()
  await sql.begin(async (tx) => {
    await tx.unsafe(body)
    await tx`insert into _aktau_migrations (name) values (${name})`
  })
  applied.add(name)
  log(`  ✓ ${name} (${Date.now() - t0} ms)`)
}
