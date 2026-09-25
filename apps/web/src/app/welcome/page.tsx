import type { Metadata } from 'next'
import { cityPulse, getSql } from '@aktau/server'
import { WelcomeView } from '@/components/welcome'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Aktau — 173 calls. One burst pipe.' }

export default async function WelcomePage() {
  const pulse = await cityPulse(getSql()).catch(() => ({ open: 0, signals: 0, merged: 0, verified: 0, areas: 0 }))
  return <WelcomeView pulse={pulse} />
}
