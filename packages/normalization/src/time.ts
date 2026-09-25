// Time handling. Storage is always UTC; everything human-facing is Asia/Aqtau.
// Relative phrases ("завтра", "ертең") are resolved against the source's own
// publication time — never against "now" — and the original phrase is kept.

export const AQTAU_TZ = 'Asia/Aqtau'

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: AQTAU_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  hourCycle: 'h23', weekday: 'short',
})
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function localParts(date: Date, tz = AQTAU_TZ): Parts {
  const f = tz === AQTAU_TZ ? partsFormatter : new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short',
  })
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]))
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: WEEKDAYS[p.weekday as string] ?? 0,
  }
}

/** Offset of `tz` from UTC in minutes at the given instant. */
export function tzOffsetMinutes(date: Date, tz = AQTAU_TZ): number {
  const p = localParts(date, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000)
}

/** Wall-clock time in Aqtau → absolute instant. */
export function fromLocal(year: number, month: number, day: number, hour = 0, minute = 0, tz = AQTAU_TZ): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute))
  const off1 = tzOffsetMinutes(guess, tz)
  const first = new Date(guess.getTime() - off1 * 60000)
  const off2 = tzOffsetMinutes(first, tz)
  return off1 === off2 ? first : new Date(guess.getTime() - off2 * 60000)
}

export type LocalDate = { year: number; month: number; day: number }

export function localDate(date: Date): LocalDate {
  const p = localParts(date)
  return { year: p.year, month: p.month, day: p.day }
}

export function addDays(d: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

export function sameLocalDay(a: Date, b: Date): boolean {
  const x = localParts(a), y = localParts(b)
  return x.year === y.year && x.month === y.month && x.day === y.day
}

export function startOfLocalDay(date: Date): Date {
  const d = localDate(date)
  return fromLocal(d.year, d.month, d.day)
}

/** [start, end) of an Aqtau calendar day offset from `date`. */
export function localDayRange(date: Date, offsetDays = 0): [Date, Date] {
  const d = addDays(localDate(date), offsetDays)
  const e = addDays(d, 1)
  return [fromLocal(d.year, d.month, d.day), fromLocal(e.year, e.month, e.day)]
}

/** Half-open interval overlap. Null bounds mean "unbounded" on that side. */
export function rangesOverlap(aStart: Date | null, aEnd: Date | null, bStart: Date | null, bEnd: Date | null): boolean {
  const as = aStart?.getTime() ?? -Infinity
  const ae = aEnd?.getTime() ?? Infinity
  const bs = bStart?.getTime() ?? -Infinity
  const be = bEnd?.getTime() ?? Infinity
  return as < be && bs < ae
}

export function fmtTime(date: Date): string {
  const p = localParts(date)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  kk: ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'],
} as const

export function fmtDate(date: Date, lang: 'en' | 'ru' | 'kk'): string {
  const p = localParts(date)
  return lang === 'en' ? `${p.day} ${MONTHS.en[p.month - 1]}` : `${p.day} ${MONTHS[lang][p.month - 1]}`
}

// Spelled out rather than Intl: Chrome ships no Kazakh date data ("M09 26, Sat"),
// so Intl output differs between Node and the browser and breaks hydration.
const WEEKDAY_NAMES = {
  en: { long: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], short: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
  ru: { long: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'], short: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] },
  kk: { long: ['жексенбі', 'дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі'], short: ['Жс', 'Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб'] },
} as const

export function fmtWeekday(date: Date, lang: 'en' | 'ru' | 'kk', width: 'long' | 'short' = 'long'): string {
  return WEEKDAY_NAMES[lang][width][localParts(date).weekday]!
}

/** Month lookup for parsing (Russian genitive/nominative stems, Kazakh). */
export const MONTH_PATTERNS: Array<{ re: RegExp; month: number }> = [
  { re: /^январ|^қаңтар/, month: 1 }, { re: /^феврал|^ақпан/, month: 2 }, { re: /^март|^наурыз/, month: 3 },
  { re: /^апрел|^сәуір/, month: 4 }, { re: /^ма[йя]|^мамыр/, month: 5 }, { re: /^июн|^маусым/, month: 6 },
  { re: /^июл|^шілде/, month: 7 }, { re: /^август|^тамыз/, month: 8 }, { re: /^сентябр|^қыркүйек/, month: 9 },
  { re: /^октябр|^қазан/, month: 10 }, { re: /^ноябр|^қараша/, month: 11 }, { re: /^декабр|^желтоқсан/, month: 12 },
]

export function monthFromWord(word: string): number | null {
  const w = word.toLowerCase()
  return MONTH_PATTERNS.find((m) => m.re.test(w))?.month ?? null
}

/** Picks the year that puts day/month closest to the reference (announcements rarely look > 6 months away). */
export function inferYear(month: number, day: number, reference: Date): number {
  const ref = localDate(reference)
  const candidates = [ref.year - 1, ref.year, ref.year + 1]
  let best = ref.year
  let bestDist = Infinity
  for (const y of candidates) {
    const dist = Math.abs(Date.UTC(y, month - 1, day) - Date.UTC(ref.year, ref.month - 1, ref.day))
    if (dist < bestDist) { best = y; bestDist = dist }
  }
  return best
}
