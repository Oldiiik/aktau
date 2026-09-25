// Presentation of canonical events (client + server safe). Facts — times,
// districts, house numbers, organisations — are interpolated verbatim.
import { agoShort, eventHeadline, t } from '@aktau/i18n'
import { addDays, fmtDate, fmtTime, localDate, localParts, sameLocalDay } from '@aktau/normalization/time'
import type { Category, CityEventDTO, Lang } from '@aktau/types'
import type { BadgeTone, IconName } from '@/components/primitives'

export const CATEGORY_ICON: Record<Category, IconName> = {
  WATER: 'water', HOT_WATER: 'water', ELECTRICITY: 'power', HEATING: 'power', GAS: 'power', ROAD: 'roads', TRANSPORT: 'bus',
  WEATHER: 'wind', AIR_QUALITY: 'wind', CASPIAN: 'wind', EMERGENCY: 'shield', EVENT: 'calendar', OTHER: 'shield',
}

export const isOngoing = (e: CityEventDTO) => ['ACTIVE', 'DELAYED', 'DEGRADED'].includes(e.display_status)

/** "today" / "tomorrow" / "24 September" relative to now (Asia/Aqtau). */
export function dayWord(lang: Lang, iso: string | null, now = new Date()): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (sameLocalDay(d, now)) return t(lang, 'when.today')
  const tm = addDays(localDate(now), 1)
  const ld = localDate(d)
  if (ld.day === tm.day && ld.month === tm.month && ld.year === tm.year) return t(lang, 'when.tomorrow')
  return fmtDate(d, lang)
}

/** True when the source gave a clock time (not just a date anchored at 00:00). */
export function hasClock(e: Pick<CityEventDTO, 'starts_at' | 'time_text'>): boolean {
  if (!e.starts_at) return false
  const p = localParts(new Date(e.starts_at))
  return !(p.hour === 0 && p.minute === 0 && !/\d[:.]\d{2}/.test(e.time_text ?? ''))
}

export function windowText(lang: Lang, e: CityEventDTO): string | null {
  const s = e.starts_at && hasClock(e) ? fmtTime(new Date(e.starts_at)) : null
  const end = e.expected_ends_at ? fmtTime(new Date(e.expected_ends_at)) : null
  if (s && end) return t(lang, 'time.window', { start: s, end })
  if (s) return t(lang, 'time.from', { start: s })
  if (end) return t(lang, 'time.until', { end })
  return null
}

export function areasText(lang: Lang, e: CityEventDTO, opts: { houses?: boolean } = {}): string {
  const nums = e.areas.filter((a) => a.designator && /^\d/.test(a.designator)).map((a) => a.designator!)
  const named = e.areas.filter((a) => !(a.designator && /^\d/.test(a.designator)) && a.designator !== null).map((a) => (lang === 'ru' ? a.name_ru : lang === 'kk' ? a.name_kk : a.name) ?? a.name)
  const city = e.areas.some((a) => a.designator === null)
  let out = ''
  if (nums.length === 1) out = lang === 'en' ? `${nums[0]} microdistrict` : lang === 'ru' ? `${nums[0]}-й микрорайон` : `${nums[0]} шағын аудан`
  else if (nums.length > 1) out = lang === 'en' ? `${nums.join(', ')} microdistricts` : lang === 'ru' ? `${nums.join(', ')} микрорайоны` : `${nums.join(', ')} шағын аудандар`
  out = [out, ...named].filter(Boolean).join(' · ')
  if (!out && city) out = t(lang, 'loc.city')
  if (opts.houses && e.building_count) {
    const list = e.buildings.map((b) => b.house_number)
    out += ` · ${t(lang, 'scope.buildings', { list: list.length > 8 ? `${list.slice(0, 8).join(', ')} +${e.building_count - 8}` : list.join(', ') })}`
  }
  return out
}

/** "Water interruption tomorrow" — headline plus day for upcoming items. */
export function headline(lang: Lang, e: CityEventDTO, now = new Date()): { head: string; when: string | null } {
  const head = eventHeadline(lang, e)
  const upcoming = e.display_status === 'SCHEDULED' && e.starts_at && new Date(e.starts_at) > now
  return { head, when: upcoming ? dayWord(lang, e.starts_at, now) : null }
}

/** Organisation shown to people: the attributed authority when a publisher cites one. */
export function authorityName(e: CityEventDTO): string {
  const map: Record<string, string> = { AUES: 'AUES', MAEK: 'MAEK', KZHSA: 'KZhSA', MREK: 'MREK', AKIMAT: 'Aktau Akimat', '109': '109', KAZHYDROMET: 'Kazhydromet' }
  return e.reported_authority ? map[e.reported_authority] ?? e.reported_authority : e.primary_source.name
}

export function trust(lang: Lang, e: CityEventDTO): { tone: BadgeTone; label: string; kind: string } {
  if (e.advisory_origin === 'APP_ADVISORY') return { tone: 'unknown', label: t(lang, 'badge.appAdvisory'), kind: t(lang, 'badge.appAdvisory') }
  if (e.verification_status === 'COMMUNITY' || e.verification_status === 'UNCONFIRMED') return { tone: 'community', label: t(lang, 'badge.community'), kind: t(lang, 'badge.community') }
  return { tone: 'official', label: t(lang, 'badge.official'), kind: t(lang, 'source.official') }
}

/** "MAEK · Official · Updated 12m ago" */
export function sourceLine(lang: Lang, e: CityEventDTO, now = new Date()): string {
  return t(lang, 'source.line', { source: authorityName(e), kind: trust(lang, e).kind, ago: agoShort(lang, e.last_confirmed_at, now) })
}

export function statusBadge(lang: Lang, e: CityEventDTO): { tone: BadgeTone; label: string } {
  if (e.display_status === 'UNCONFIRMED') return { tone: 'unknown', label: t(lang, 'badge.UNCONFIRMED') }
  if (e.display_status === 'RESOLVED') return { tone: 'resolved', label: t(lang, 'badge.RESOLVED') }
  if (e.display_status === 'CANCELLED') return { tone: 'neutral', label: t(lang, 'badge.CANCELLED') }
  if (isOngoing(e)) return { tone: 'active', label: t(lang, e.display_status === 'DELAYED' ? 'badge.DELAYED' : 'badge.ACTIVE') }
  if (e.relevance === 'DIRECT') return { tone: 'planned', label: t(lang, 'badge.affectsHome') }
  return { tone: 'planned', label: t(lang, 'badge.SCHEDULED') }
}

export function etaText(lang: Lang, e: CityEventDTO, now = new Date()): string {
  if (e.expected_ends_at) {
    const end = new Date(e.expected_ends_at)
    if (end < now && isOngoing(e)) return t(lang, 'eta.passed', { time: fmtTime(end) })
    return t(lang, 'eta.expected', { time: fmtTime(end) })
  }
  return t(lang, 'eta.unknown')
}

export function relevanceText(lang: Lang, e: CityEventDTO): string | null {
  if (!e.relevance || e.relevance === 'NO') return null
  return t(lang, `relevance.${e.relevance}`)
}

export function tone(e: CityEventDTO | null): 'surface' | 'amber' | 'red' | 'green' {
  if (!e) return 'surface'
  if (e.display_status === 'RESOLVED') return 'green'
  if (isOngoing(e) && e.relevance === 'DIRECT') return 'red'
  return 'amber'
}

export function kmOrM(m: number | null | undefined): string | null {
  if (m == null) return null
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}
