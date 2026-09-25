import type { Metadata } from 'next'
import { getSql, getWeatherDetail } from '@aktau/server'
import { Screen } from '@/components/app'
import { WeatherView } from '@/components/weather'
import { getLang } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Weather · Aktau' }

// Opened from Home's weather card (and the assistant); deliberately not in the nav.
export default async function WeatherPage() {
  const w = await getWeatherDetail(getSql(), new Date(), await getLang())
  return <Screen><WeatherView w={JSON.parse(JSON.stringify(w))} /></Screen>
}
