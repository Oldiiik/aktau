import type { Metadata } from 'next'
import { getSql, whatsOn } from '@aktau/server'
import { AfishaView } from '@/components/afisha'
import { Screen } from '@/components/app'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Afisha · Aktau', description: 'Where to go in Aktau: cinema sessions, concerts, stand-up, theatre and festivals, linked to the organisers.' }

export default async function AfishaPage() {
  const data = await whatsOn(getSql())
  return <Screen wide="xl"><AfishaView initial={JSON.parse(JSON.stringify(data))} /></Screen>
}
