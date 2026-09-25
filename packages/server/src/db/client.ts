import postgres from 'postgres'

export type Sql = postgres.Sql<Record<string, never>>

// Next.js can load this module more than once per process (the instrumentation
// hook, route handlers and server components are bundled separately). The pool
// lives on globalThis so every copy shares it: PGlite must see one connection.
const g = globalThis as typeof globalThis & { __aktauSql?: Sql }

/**
 * One pooled connection per process. DATABASE_URL is server-only — it points
 * at the local PGlite server in dev and at Supabase Postgres in production.
 */
export function getSql(): Sql {
  if (g.__aktauSql) return g.__aktauSql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)')
  g.__aktauSql = createSql(url)
  return g.__aktauSql
}

export function createSql(url: string, opts: { max?: number } = {}): Sql {
  const local = /127\.0\.0\.1|localhost/.test(url)
  // PGlite is a single Postgres session. Its socket multiplexer does not
  // isolate the extended-protocol messages of concurrent connections, so the
  // local dev database gets exactly one connection (queries queue in the
  // client). Supabase/any real Postgres gets a normal pool.
  const max = opts.max ?? Number(process.env.DB_MAX_CONNECTIONS ?? (local ? 1 : 10))
  return postgres(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 15,
    // Supabase's transaction pooler and PGlite's multiplexer both prefer
    // unnamed statements.
    prepare: false,
    ssl: local ? false : 'require',
    onnotice: () => {},
    types: {
      // numeric → number (confidence, ratings, measurements are small)
      numeric: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
      bigint: { to: 20, from: [20], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
    },
  }) as unknown as Sql
}

/** Test/CLI helper: swap the process-wide connection. */
export function setSql(sql: Sql | undefined) {
  g.__aktauSql = sql
}
