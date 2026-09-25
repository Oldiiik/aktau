import { getSql } from '@aktau/server'
import { json } from '@/lib/api'

export async function GET() {
  const t0 = Date.now()
  try {
    await getSql()`select 1`
    return json({ ok: true, db_ms: Date.now() - t0 })
  } catch {
    return json({ ok: false }, { status: 503 })
  }
}
