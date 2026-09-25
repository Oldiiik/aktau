import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSql, listIncidents, opsStats, pendingSignals } from '@aktau/server'
import { Screen } from '@/components/app'
import { OpsConsole } from '@/components/ops'
import { canUseCopilot } from '@/lib/auth'
import { currentAccount } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: '109 Copilot · Aktau' }

// 109 Copilot: a section of Aktau for operator and admin accounts.
// ?embed=1 renders it without the app chrome (the split-screen /demo);
// ?incident=INC-1042 (or the uuid) opens that incident.
export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ embed?: string; incident?: string }> }) {
  const me = await currentAccount()
  if (!canUseCopilot(me?.role)) redirect(`/signin?next=/copilot${me ? '&need=operator' : ''}`)
  const sql = getSql()
  const [{ embed, incident }, stats, incidents, pending] = await Promise.all([searchParams, opsStats(sql), listIncidents(sql, { open: true }), pendingSignals(sql)])
  const view = <OpsConsole initial={JSON.parse(JSON.stringify({ stats, incidents, pending }))} demo={process.env.DEMO_MODE === 'true'} embed={embed === '1'} focus={incident ?? null} />
  return embed === "1" ? view : <Screen bare>{view}</Screen>
}
