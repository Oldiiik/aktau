import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { CHANNELS } from '@aktau/city-core'
import { previewSignal, submitSignal } from '@aktau/server'
import { handle, json, requireOperator, sql } from '@/lib/api'

// Operator intake: a call transcript or a message from another channel.
// preview=true runs the copilot only; otherwise the signal lands in the queue.
const Body = z.object({ text: z.string().trim().min(3).max(4000), channel: z.enum(CHANNELS).default('PHONE'), preview: z.boolean().default(false) })

export const POST = handle('ops-signal', async (req: NextRequest) => {
  const admin = await requireOperator(req)
  if (admin instanceof Response) return admin
  const b = Body.parse(await req.json())
  if (b.preview) return json(await previewSignal(sql(), b.text))
  const r = await submitSignal(sql(), { text: b.text, channel: b.channel, actor: 'operator' })
  return json({ signal_id: r.signal_id })
})
