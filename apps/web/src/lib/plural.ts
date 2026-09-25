// Plural forms for numbers in copy. Russian has three, Kazakh none after a numeral.
import type { Lang } from '@aktau/types'

export type Forms = { en: [string, string]; ru: [string, string, string]; kk: string }

export function plural(lang: Lang, n: number, f: Forms) {
  if (lang === 'kk') return f.kk
  if (lang === 'en') return f.en[n === 1 ? 0 : 1]
  const m10 = n % 10, m100 = n % 100
  return f.ru[m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2]
}
