import type { NextRequest } from 'next/server'
import { getSql, subscribeOutbox, type OutboxRow } from '@aktau/server'

// Realtime via Server-Sent Events. One shared tail of realtime_outbox per
// process fans out to every open stream (identical on PGlite and Supabase);
// a reconnecting client replays what it missed from Last-Event-ID. Clients get
// compact change notices, never raw source data, and refetch the canonical
// state they care about.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sql = getSql()
  const enc = new TextEncoder()
  const header = req.headers.get('last-event-id')
  const since = header != null && /^\d+$/.test(header) ? Number(header) : null
  let unsubscribe: (() => void) | null = null
  let ping: ReturnType<typeof setInterval> | undefined
  const stop = () => { unsubscribe?.(); unsubscribe = null; if (ping) clearInterval(ping) }
  const stream = new ReadableStream({
    async start(controller) {
      const push = (s: string) => { try { controller.enqueue(enc.encode(s)) } catch { stop() } }
      push(`retry: 3000\n: connected\n\n`)
      const send = (rows: OutboxRow[]) => {
        for (const r of rows) push(`id: ${r.id}\nevent: ${r.topic}\ndata: ${JSON.stringify({ kind: r.kind, id: r.entity_id, ...r.payload })}\n\n`)
      }
      unsubscribe = await subscribeOutbox(sql, since, send)
      if (req.signal.aborted) stop()
      ping = setInterval(() => push(`: ping\n\n`), 15_000)
    },
    cancel: stop,
  })
  req.signal.addEventListener('abort', stop)
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } })
}
