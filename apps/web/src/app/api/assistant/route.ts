import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { assistantMode, log, runAssistant } from '@aktau/server'
import { handle, installationOf, json, langOf, limited, sql } from '@/lib/api'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// A photo is resized in the browser (≤1280 px JPEG); ~1.5 MB of base64 is plenty.
const Image = z.object({ media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().max(1_600_000).regex(/^[A-Za-z0-9+/=]+$/) })
const Body = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000), images: z.array(Image).max(3).optional() })).min(1).max(40),
  lang: z.enum(['en', 'ru', 'kk']).optional(),
  // The user's current position, only when they tapped "use my location". Used for this answer, not stored.
  here: z.object({ lat: z.number().min(42.9).max(44.1), lon: z.number().min(50.6).max(51.8) }).nullable().optional(),
})

export const GET = handle('assistant-info', async () => json({ mode: assistantMode() }))

// POST → a stream of newline-delimited JSON events (text deltas, tool status, cards).
export const POST = handle('assistant', async (req: NextRequest) => {
  const tooMany = await limited(req, 'assistant', 30, 600)
  if (tooMany) return tooMany
  const b = Body.parse(await req.json())
  const enc = new TextEncoder()
  const gen = runAssistant(sql(), { messages: b.messages, lang: b.lang ?? langOf(req), installation_id: installationOf(req), here: b.here ?? null })
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next()
        if (done) return controller.close()
        controller.enqueue(enc.encode(JSON.stringify(value) + '\n'))
      } catch (err) {
        log('error', 'assistant.failed', { err: err as Error })
        controller.enqueue(enc.encode(JSON.stringify({ type: 'error', message: 'The assistant could not answer. Try again.' }) + '\n'))
        controller.close()
      }
    },
    async cancel() { await gen.return(undefined) },
  })
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } })
})
