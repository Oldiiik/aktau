import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { audit, log, runPilot, type PilotResult } from '@aktau/server'
import { cacheGet, cacheSet } from '@aktau/server/cache'
import { fail, handle, json, requireOperator, sql } from '@/lib/api'

// Pilot simulation (staff): a generated week of resident messages through the
// 109 engine, measured against the week's ground truth. Streams NDJSON:
// start → progress (every 500 messages) → result. Nothing is written to the
// city's incidents; the last result is kept for the page.
const Body = z.object({
  reports: z.number().int().min(500).max(50_000).default(10_000),
  days: z.number().int().min(1).max(30).default(7),
  seed: z.number().int().min(1).max(999_999_999).optional(),
})

const g = globalThis as unknown as { __aktauPilotRunning?: boolean }

export const GET = handle('ops-pilot-last', async (req: NextRequest) => {
  const staff = await requireOperator(req)
  if (staff instanceof Response) return staff
  const hit = await cacheGet<PilotResult>(sql(), 'pilot', 'last')
  return json({ result: hit?.payload ?? null, at: hit?.fetched_at ?? null })
})

export const POST = handle('ops-pilot', async (req: NextRequest) => {
  const staff = await requireOperator(req)
  if (staff instanceof Response) return staff
  if (g.__aktauPilotRunning) return fail(409, 'busy', 'A simulation is already running.')
  const b = Body.parse(await req.json().catch(() => ({})))
  const seed = b.seed ?? Math.floor(Math.random() * 999_999) + 1
  g.__aktauPilotRunning = true
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (x: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(x)}\n`))
      try {
        send({ type: 'start', reports: b.reports, days: b.days, seed })
        // The engine is synchronous between progress points: yield so each point reaches the browser.
        const result = await runPilot(sql(), { reports: b.reports, days: b.days, seed }, async (p) => {
          send({ type: 'progress', ...p })
          await new Promise((r) => setTimeout(r, 0))
        })
        await cacheSet(sql(), 'pilot', 'last', result, 30 * 86400)
        await audit(sql(), staff.actor, 'pilot.simulate', 'pilot', null, null, { reports: b.reports, days: b.days, seed, incidents: result.dedup.incidents })
        send({ type: 'result', result })
      } catch (err) {
        log('error', 'pilot.failed', { err: err as Error })
        send({ type: 'error', message: 'The simulation failed.' })
      } finally {
        g.__aktauPilotRunning = false
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } })
})
