import type { Sql } from './db/client.ts'

export type Cached<T> = { payload: T; fetched_at: Date; expires_at: Date; stale: boolean }

export async function cacheGet<T>(sql: Sql, provider: string, key: string, now = new Date()): Promise<Cached<T> | null> {
  const rows = await sql<{ payload: T; fetched_at: Date; expires_at: Date }[]>`
    select payload, fetched_at, expires_at from api_cache where provider = ${provider} and key = ${key}`
  const r = rows[0]
  return r ? { ...r, stale: r.expires_at < now } : null
}

export async function cacheSet(sql: Sql, provider: string, key: string, payload: unknown, ttlSeconds: number, now = new Date()) {
  await sql`
    insert into api_cache (provider, key, payload, fetched_at, expires_at)
    values (${provider}, ${key}, ${sql.json(payload as never)}, ${now}, ${new Date(now.getTime() + ttlSeconds * 1000)})
    on conflict (provider, key) do update set payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`
}

/** Serve fresh cache; otherwise refresh; if the refresh fails serve stale cache (with its timestamp). */
export async function cached<T>(sql: Sql, provider: string, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<Cached<T> | null> {
  const hit = await cacheGet<T>(sql, provider, key)
  if (hit && !hit.stale) return hit
  try {
    const payload = await load()
    await cacheSet(sql, provider, key, payload, ttlSeconds)
    const now = new Date()
    return { payload, fetched_at: now, expires_at: new Date(now.getTime() + ttlSeconds * 1000), stale: false }
  } catch {
    return hit ? { ...hit, stale: true } : null
  }
}
