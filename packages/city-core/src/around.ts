// Around-me ranking: urgency and time relevance first, distance second.
import type { CityEventDTO } from '@aktau/types'
import { urgencyScore } from './now.ts'

export function rankAroundMe(events: CityEventDTO[], now: Date): CityEventDTO[] {
  const score = (e: CityEventDTO) => urgencyScore(e, now) - Math.min(600, (e.distance_m ?? 0) / 5)
  return [...events].sort((a, b) => score(b) - score(a))
}
