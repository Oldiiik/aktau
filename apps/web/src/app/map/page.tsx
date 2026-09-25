import { Suspense } from 'react'
import { Screen } from '@/components/app'
import { MapView } from '@/components/map'

export default function MapPage() {
  return <Screen bare><Suspense><MapView /></Suspense></Screen>
}
