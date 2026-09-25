// Grounding: every operational fact an LLM returns must be literally present in
// the source text. Anything that is not — an ETA, a house number, a district,
// an authority, a reason — is removed (set to null / dropped) and flagged, and
// the candidate goes to human review. The LLM can structure; it cannot add.
import { detectAuthority } from '@aktau/source-ranking'
import type { Extraction, ExtractionWarning } from '@aktau/types'
import { normalizeHouseNumber, normalizeText } from '../text.ts'
import { localParts } from '../time.ts'

const L = 'а-яёәғқңөұүһіa-z'

function hasToken(haystack: string, token: string): boolean {
  const esc = token.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return new RegExp(`(?<![\\d${L}])${esc}(?![\\d${L}])`, 'i').test(haystack)
}

function timeAppears(text: string, iso: string): boolean {
  const p = localParts(new Date(iso))
  const hh = String(p.hour).padStart(2, '0')
  const mm = String(p.minute).padStart(2, '0')
  const variants = [`${hh}:${mm}`, `${p.hour}:${mm}`, `${hh}.${mm}`, `${p.hour}.${mm}`]
  if (p.minute === 0) variants.push(`${p.hour} ч`, `${p.hour} час`, `${hh} ч`)
  // A day-start anchor (00:00) is legitimate when the text gives a date only.
  if (p.hour === 0 && p.minute === 0) return true
  return variants.some((v) => text.includes(v))
}

export function groundExtraction(e: Extraction, sourceText: string): { extraction: Extraction; errors: ExtractionWarning[] } {
  const text = normalizeText(sourceText)
  const errors: ExtractionWarning[] = []
  const out: Extraction = { ...e, areas: [...e.areas], buildings: [...e.buildings] }

  out.areas = e.areas.filter((a) => {
    const num = a.match(/^\d+/)?.[0]
    const ok = num ? hasToken(text, a.toLowerCase()) || hasToken(text, num) : text.includes(a.split('-')[0]!.toLowerCase().slice(0, 4))
    if (!ok) errors.push({ field: 'areas', code: 'ungrounded', message: `District "${a}" is not in the source text — removed.` })
    return ok
  })

  const foldedHouses = text.replace(/№/g, ' ')
  out.buildings = e.buildings.filter((b) => {
    const n = normalizeHouseNumber(b)
    const ok = hasToken(foldedHouses, n.toLowerCase()) || hasToken(foldedHouses, b.toLowerCase())
      || isInsideRange(foldedHouses, n)
    if (!ok) errors.push({ field: 'buildings', code: 'ungrounded', message: `House "${b}" is not in the source text — removed.` })
    return ok
  })

  for (const f of ['starts_at', 'expected_ends_at'] as const) {
    const v = out[f]
    if (v && !timeAppears(sourceText, v)) {
      errors.push({ field: f, code: 'ungrounded', message: `${f} ${v} does not appear in the source text — set to null.` })
      out[f] = null
    }
  }

  if (out.authority) {
    const detected = detectAuthority(sourceText)?.key
    if (detected !== out.authority.toUpperCase() && !text.includes(out.authority.toLowerCase())) {
      errors.push({ field: 'authority', code: 'ungrounded', message: `Authority "${out.authority}" is not named in the source — set to null.` })
      out.authority = detected ?? null
    }
  }

  if (out.reason) {
    const r = normalizeText(out.reason)
    const words = r.split(/[^\p{L}\d]+/u).filter((w) => w.length > 3)
    const covered = words.filter((w) => text.includes(w)).length
    if (!text.includes(r) && (words.length === 0 || covered / words.length < 0.8)) {
      errors.push({ field: 'reason', code: 'ungrounded', message: 'Reason is not stated in the source text — set to null.' })
      out.reason = null
    }
  }
  return { extraction: out, errors }
}

function isInsideRange(text: string, house: string): boolean {
  const n = Number(house)
  if (!Number.isInteger(n)) return false
  for (const m of text.matchAll(/(\d{1,3})\s*[-–]\s*(\d{1,3})/g)) {
    const a = Number(m[1]), b = Number(m[2])
    if (b > a && b - a <= 40 && n >= a && n <= b) return true
  }
  return false
}
