// Realtime: one tail of realtime_outbox per process, fanned out to every open
// SSE stream. Each stream used to poll the database on its own every 2 s; now a
// single loop polls every 500 ms while anyone listens, and a reconnecting
// client gets what it missed (Last-Event-ID) straight from the table.
//
// Rows are written by triggers in the same transaction as the change, so an
// event always describes a persisted state. Clients still refetch canonical
// state from the API: an event is a hint, never the source of truth.
import type { Sql } from './db/client.ts'

export type OutboxRow = { id: number; topic: string; kind: string; entity_id: string | null; payload: Record<string, unknown> }
type Sub = (rows: OutboxRow[]) => void

type Tail = { subs: Set<Sub>; last: number; timer: ReturnType<typeof setInterval> | null; seen: Set<number>; order: number[]; busy: boolean }
// Next.js may load this module more than once per process; the tail is shared.
const g = globalThis as typeof globalThis & { __aktauTail?: Tail }
const tail: Tail = (g.__aktauTail ??= { subs: new Set(), last: 0, timer: null, seen: new Set(), order: [], busy: false })

const POLL_MS = 500
// A transaction that commits late can surface an id below the last one seen
// (concurrent writers on a pooled database): look back a little, skip what was sent.
const LOOKBACK = 200

async function poll(sql: Sql) {
  if (tail.busy) return
  tail.busy = true
  try {
    const rows = await sql<OutboxRow[]>`
      select id, topic, kind, entity_id, payload from realtime_outbox where id > ${Math.max(0, tail.last - LOOKBACK)} order by id limit 500`
    const fresh = rows.filter((r) => !tail.seen.has(r.id))
    for (const r of fresh) {
      tail.seen.add(r.id)
      tail.order.push(r.id)
      if (r.id > tail.last) tail.last = r.id
    }
    while (tail.order.length > 5000) tail.seen.delete(tail.order.shift()!)
    if (fresh.length) for (const s of [...tail.subs]) s(fresh)
  } catch { /* transient database hiccup: next tick */ } finally {
    tail.busy = false
  }
}

async function maxId(sql: Sql) {
  const [r] = await sql<{ max: number }[]>`select coalesce(max(id), 0)::int max from realtime_outbox`
  return r?.max ?? 0
}

/**
 * Subscribe to outbox rows. `since` (the client's Last-Event-ID) replays rows
 * it missed while disconnected. Returns an unsubscribe function.
 */
export async function subscribeOutbox(sql: Sql, since: number | null, cb: Sub): Promise<() => void> {
  if (!tail.subs.size) {
    // Nobody was listening: start from now.
    tail.last = await maxId(sql)
    tail.seen.clear()
    tail.order = []
  }
  if (since != null && Number.isFinite(since) && since < tail.last) {
    const missed = await sql<OutboxRow[]>`
      select id, topic, kind, entity_id, payload from realtime_outbox where id > ${since} and id <= ${tail.last} order by id limit 500`
    if (missed.length) cb(missed)
  }
  tail.subs.add(cb)
  tail.timer ??= setInterval(() => void poll(sql), POLL_MS)
  return () => {
    tail.subs.delete(cb)
    if (!tail.subs.size && tail.timer) { clearInterval(tail.timer); tail.timer = null }
  }
}
