import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSql, type PilotResult } from '@aktau/server'
import { cacheGet } from '@aktau/server/cache'
import { Screen } from '@/components/app'
import { PilotView } from '@/components/pilot'
import { canUseCopilot } from '@/lib/auth'
import { currentAccount } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Pilot simulation · 109 Copilot · Aktau' }

// A week of 10 000 resident messages through the 109 engine, against a known
// ground truth: staff only (operators and admins), like the rest of 109 Copilot.
export default async function PilotPage() {
  const me = await currentAccount()
  if (!canUseCopilot(me?.role)) redirect(`/signin?next=/copilot/pilot${me ? '&need=operator' : ''}`)
  const last = await cacheGet<PilotResult>(getSql(), 'pilot', 'last').catch(() => null)
  return <Screen wide="xl"><PilotView initial={last ? JSON.parse(JSON.stringify(last.payload)) : null} /></Screen>
}
