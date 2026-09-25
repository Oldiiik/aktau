// Source hierarchy and conflict resolution.
//
//   OFFICIAL UTILITY  >  AKIMAT / GOVERNMENT  >  109  >  VERIFIED MEDIA  >  COMMUNITY
//
// Media that *reports* an official announcement ("По информации ГКП «АУЭС»")
// is still the publisher; the attributed authority is kept separately and
// raises verification to OFFICIAL-attributed, never the other way round.
import type { SourceType, Verification } from '@aktau/types'

export type SourceLike = { slug: string; source_type: SourceType; authority_level: number }

/** Organisations whose announcements are primary for utility state. */
export const KNOWN_AUTHORITIES: Array<{ key: string; label: string; patterns: RegExp[]; authority: number; categories: string[] }> = [
  { key: 'AUES', label: 'AUES', patterns: [/ауэс/i, /aues/i, /актауск\w* электр\w* сет/i], authority: 100, categories: ['ELECTRICITY'] },
  { key: 'MAEK', label: 'MAEK', patterns: [/маэк/i, /\bmaek\b/i, /мангистауск\w* атомн/i], authority: 100, categories: ['WATER', 'HOT_WATER', 'HEATING', 'ELECTRICITY'] },
  { key: 'KZHSA', label: 'KZhSA', patterns: [/кжса/i, /каспий жылу/i, /kzhsa/i, /каспий жылу,? су арнасы/i], authority: 100, categories: ['WATER', 'HOT_WATER', 'HEATING'] },
  { key: 'MREK', label: 'MREK', patterns: [/мрэк/i, /мангистаус\w* распределит\w* электросет/i], authority: 100, categories: ['ELECTRICITY'] },
  { key: 'AKIMAT', label: 'Aktau Akimat', patterns: [/акимат\w*/i, /әкімдігі/i, /әкімдік/i], authority: 80, categories: [] },
  { key: '109', label: '109', patterns: [/\b109\b/], authority: 70, categories: [] },
  { key: 'KAZHYDROMET', label: 'Kazhydromet', patterns: [/казгидромет/i, /қазгидромет/i, /kazhydromet/i], authority: 95, categories: ['WEATHER'] },
  { key: 'DCHS', label: 'Emergency Department', patterns: [/дчс/i, /тжд/i, /департамент по чрезвычайн/i], authority: 90, categories: ['EMERGENCY'] },
]

export function detectAuthority(text: string): { key: string; label: string; authority: number } | null {
  let best: { key: string; label: string; authority: number; index: number } | null = null
  for (const a of KNOWN_AUTHORITIES) {
    for (const p of a.patterns) {
      const m = p.exec(text)
      // Prefer the most authoritative; among equals, the first mentioned.
      if (m && (!best || a.authority > best.authority || (a.authority === best.authority && m.index < best.index))) {
        best = { key: a.key, label: a.label, authority: a.authority, index: m.index }
      }
    }
  }
  return best ? { key: best.key, label: best.label, authority: best.authority } : null
}

/** Effective authority of a piece of information: publisher, or the attributed authority when a lower-ranked publisher explicitly cites one. */
export function effectiveAuthority(source: SourceLike, reportedAuthority?: string | null): number {
  if (!reportedAuthority) return source.authority_level
  const a = KNOWN_AUTHORITIES.find((k) => k.key === reportedAuthority.toUpperCase() || k.label === reportedAuthority)
  // Attribution by media is strong but not identical to first-hand: cap below the utility itself.
  return a ? Math.max(source.authority_level, Math.min(a.authority - 5, 90)) : source.authority_level
}

export function verificationFor(source: SourceLike, opts: { reportedAuthority?: string | null; confirmations?: number; manualReview?: boolean } = {}): Verification {
  if (source.source_type === 'OFFICIAL' || source.source_type === 'GOVERNMENT') return 'OFFICIAL'
  if (source.source_type === 'COMMUNITY') return (opts.confirmations ?? 0) >= 2 ? 'CORROBORATED' : 'COMMUNITY'
  if (opts.reportedAuthority) return 'VERIFIED' // media citing a named authority, human-reviewed
  if ((opts.confirmations ?? 0) >= 1) return 'CORROBORATED'
  if (source.source_type === 'API' || source.source_type === 'PROVIDER') return 'VERIFIED'
  return opts.manualReview ? 'VERIFIED' : 'UNCONFIRMED'
}

export type StateClaim<T> = { value: T; authority: number; observedAt: Date }

/**
 * Conflict rule for the *current* value of a field (status, ETA):
 * the newest claim wins unless it comes from a clearly less authoritative
 * source than the claim it would replace (> 20 points lower). History is
 * never deleted — callers record the losing value in city_event_updates.
 */
export function resolveClaim<T>(current: StateClaim<T>, incoming: StateClaim<T>): { winner: 'current' | 'incoming'; reason: string } {
  const newer = incoming.observedAt.getTime() >= current.observedAt.getTime()
  const gap = current.authority - incoming.authority
  if (newer && gap <= 20) return { winner: 'incoming', reason: 'newer information from a comparable or higher authority' }
  if (!newer && incoming.authority > current.authority + 20) return { winner: 'incoming', reason: 'older but substantially more authoritative' }
  if (newer) return { winner: 'current', reason: `newer claim is ${gap} authority points lower — kept as contradicting evidence` }
  return { winner: 'current', reason: 'current claim is newer' }
}

export function sourceTypeRank(t: SourceType): number {
  return { OFFICIAL: 6, GOVERNMENT: 5, PROVIDER: 3, API: 3, MEDIA: 2, MANUAL: 2, COMMUNITY: 1 }[t]
}
