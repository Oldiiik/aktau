// Duplicate detection: five sources describing one outage must become one
// CityEvent with five pieces of evidence, not five cards.
import type { Category } from '@aktau/types'
import { normalizeHouseNumber, normalizeText } from './text.ts'

export type DedupSubject = {
  category: Category
  event_type: string
  areas: string[]           // designators
  buildings: string[]       // house numbers (any form)
  starts_at: Date | null
  expected_ends_at: Date | null
  reason: string | null
  authority: string | null
}

export type DedupScore = { score: number; parts: Record<string, number>; verdict: 'same' | 'possible' | 'different' }

const FAMILY: Partial<Record<Category, string>> = { WATER: 'water', HOT_WATER: 'water', HEATING: 'heat', GAS: 'heat' }

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

function words(s: string | null): Set<string> {
  return new Set(normalizeText(s ?? '').split(/[^\p{L}\d]+/u).filter((w) => w.length > 3).map((w) => w.slice(0, 6)))
}

export function duplicateScore(a: DedupSubject, b: DedupSubject): DedupScore {
  const parts: Record<string, number> = {}
  if (a.category !== b.category) {
    const fa = FAMILY[a.category], fb = FAMILY[b.category]
    if (!fa || fa !== fb) return { score: 0, parts: { category: 0 }, verdict: 'different' }
    parts.category = 0.5
  } else parts.category = 1

  const areasA = new Set(a.areas), areasB = new Set(b.areas)
  const areaJ = jaccard(areasA, areasB)
  if (areasA.size && areasB.size && areaJ === 0) return { score: 0, parts: { ...parts, areas: 0 }, verdict: 'different' }
  parts.areas = areaJ

  const bA = new Set(a.buildings.map(normalizeHouseNumber)), bB = new Set(b.buildings.map(normalizeHouseNumber))
  parts.buildings = bA.size && bB.size ? jaccard(bA, bB) : 0.6 // one side not building-limited: neutral

  const restorationPair = a.event_type === 'restoration' || b.event_type === 'restoration'
  if (restorationPair) parts.time = 0.8 // a restoration notice refers back to an ongoing event
  else if (a.starts_at && b.starts_at) {
    const diffH = Math.abs(a.starts_at.getTime() - b.starts_at.getTime()) / 3_600_000
    parts.time = diffH <= 0.5 ? 1 : diffH <= 2 ? 0.8 : diffH <= 12 ? 0.3 : 0
  } else parts.time = 0.5

  parts.authority = a.authority && b.authority ? (a.authority === b.authority ? 1 : 0.2) : 0.5
  parts.reason = a.reason && b.reason ? jaccard(words(a.reason), words(b.reason)) : 0.5

  const score =
    parts.category * 0.15 + parts.areas * 0.3 + parts.buildings * 0.15 + parts.time * 0.25 + parts.authority * 0.08 + parts.reason * 0.07
  const s = Math.round(score * 100) / 100
  return { score: s, parts, verdict: s >= 0.78 ? 'same' : s >= 0.55 ? 'possible' : 'different' }
}
