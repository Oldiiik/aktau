// Caspian Safety rules. Two separate questions, never merged:
//   LEGAL  is swimming permitted here at all?  → only an authority's list answers
//   NOW    what is the sea doing?               → facts, described on standard scales
// Nothing here ever produces "safe to swim". A weather model cannot make a
// place legal, and a legal beach is not declared safe by the numbers.

export type LegalStatus = 'OFFICIAL' | 'PROHIBITED'
export type OperationalStatus = 'UNKNOWN' | 'OPEN' | 'RESTRICTED' | 'CLOSED'

/** How far from a drawn stretch still counts as "at" it. The official stretch is
 *  already ±150 m of the beach's map location, so this only absorbs GPS error. */
export const SWIM_CHECK = {
  /** Inside a prohibited stretch: generous, because a false "no" is the safe error. */
  prohibitedWithinM: 120,
  /** At an official beach: tight, so rocks next to a beach are not called the beach. */
  officialWithinM: 60,
  /** Further than this from the shore: not at the sea at all. */
  inlandBeyondM: 1500,
} as const

export type SwimVerdict =
  | { kind: 'prohibited'; zone_id: string }
  | { kind: 'official'; zone_id: string; operational: OperationalStatus }
  | { kind: 'unlisted' }
  | { kind: 'inland' }

export type SwimCheckInput = {
  distance_to_shore_m: number | null
  prohibited: Array<{ id: string; distance_m: number }>
  official: Array<{ id: string; distance_m: number; operational: OperationalStatus }>
}

/** Prohibited wins over everything; then official; otherwise the shore is simply
 *  not an official swimming area (the authorities' advice: swim only at those). */
export function swimVerdict(i: SwimCheckInput): SwimVerdict {
  const p = i.prohibited.filter((z) => z.distance_m <= SWIM_CHECK.prohibitedWithinM).sort((a, b) => a.distance_m - b.distance_m)[0]
  if (p) return { kind: 'prohibited', zone_id: p.id }
  if (i.distance_to_shore_m == null || i.distance_to_shore_m > SWIM_CHECK.inlandBeyondM) return { kind: 'inland' }
  const o = i.official.filter((z) => z.distance_m <= SWIM_CHECK.officialWithinM).sort((a, b) => a.distance_m - b.distance_m)[0]
  if (o) return { kind: 'official', zone_id: o.id, operational: o.operational }
  return { kind: 'unlisted' }
}

// ── NOW: conditions, described, not judged ──────────────────────────────────
// Beaufort (wind) and Douglas (sea state) are the standard marine scales; the
// words are theirs. They describe the numbers; they are not a permission.

export type WindWord = 'calm' | 'light' | 'moderate' | 'strong' | 'gale'
export type SeaWord = 'calm' | 'slight' | 'moderate' | 'rough' | 'very_rough'

export function windWord(ms: number | null | undefined): WindWord | null {
  if (ms == null) return null
  if (ms < 1.6) return 'calm'       // Beaufort 0–1
  if (ms < 5.5) return 'light'      // 2–3
  if (ms < 10.8) return 'moderate'  // 4–5
  if (ms < 17.2) return 'strong'    // 6–7
  return 'gale'                     // 8+
}

export function seaWord(waveM: number | null | undefined): SeaWord | null {
  if (waveM == null) return null
  if (waveM < 0.1) return 'calm'      // Douglas 0–1
  if (waveM < 0.5) return 'slight'    // 2
  if (waveM < 1.25) return 'moderate' // 3
  if (waveM < 2.5) return 'rough'     // 4
  return 'very_rough'                 // 5+
}

export type SeaConditions = {
  wind_ms: number | null
  gust_ms: number | null
  wave_m: number | null
  sea_temp_c: number | null
  wind: WindWord | null
  gusts: WindWord | null
  sea: SeaWord | null
  /** Conditions the ДЧС names as dangerous for the Aktau coast (storm weather). */
  attention: boolean
}

export function describeConditions(x: { wind_ms?: number | null; gust_ms?: number | null; wave_m?: number | null; sea_temp_c?: number | null }): SeaConditions {
  const wind = windWord(x.wind_ms), gusts = windWord(x.gust_ms), sea = seaWord(x.wave_m)
  return {
    wind_ms: x.wind_ms ?? null, gust_ms: x.gust_ms ?? null, wave_m: x.wave_m ?? null, sea_temp_c: x.sea_temp_c ?? null,
    wind, gusts, sea,
    attention: wind === 'strong' || wind === 'gale' || gusts === 'gale' || sea === 'rough' || sea === 'very_rough',
  }
}
