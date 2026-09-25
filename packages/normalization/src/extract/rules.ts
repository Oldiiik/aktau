// Deterministic extraction — always runs first, needs no network, and is the
// reference the LLM stage is checked against. Handles Russian and Kazakh
// utility / road announcements as published by AUES, MAEK, KZhSA, the akimat
// and local media ("По информации ГКП «АУЭС», с 13:30 до 17:30 ...").
import { detectAuthority } from '@aktau/source-ranking'
import { ExtractionSchema, type Category, type EventStatus, type Extraction, type ExtractionWarning } from '@aktau/types'
import { canonicalNumberDesignator, normalizeHouseNumber, parseDistrictDesignator } from '../text.ts'
import { addDays, fromLocal, inferYear, localDate, monthFromWord, type LocalDate } from '../time.ts'

export const PARSER_VERSION = 'rules-2026.09.3'

export type ExtractInput = {
  text: string
  title?: string | null
  /** Publication time of the source — the anchor for "сегодня/завтра". */
  published_at?: Date | null
  /** When we fetched / received it; used for status when no publication time. */
  fetched_at: Date
  reported_authority?: string | null
}

export type RuleSegment = {
  index: number
  text: string
  extraction: Extraction
  warnings: ExtractionWarning[]
  errors: ExtractionWarning[]
}

// Cyrillic-aware word boundaries (JS \b is ASCII-only).
const L = 'а-яёәғқңөұүһіa-z'
const B = `(?<![${L}])`
const E = `(?![${L}])`

/** Length-preserving fold so regex indices map back onto the original text. */
function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[‐-―−]/g, '-').replace(/ /g, ' ')
}

// ── Category ────────────────────────────────────────────────────────────────
const CATEGORY_RULES: Array<[Category, RegExp]> = [
  ['HOT_WATER', new RegExp(`горяч[${L}]* вод|${B}гвс${E}|ыстық су`)],
  ['WATER', new RegExp(`питьев|водоснабж|подач[${L}]* (?:питьев[${L}]* )?вод|холодн[${L}]* вод|без воды|${B}вод[аыуеой]${E}|водопровод|водовод|ауыз су|сумен жабдықта|${B}су${E}|${B}суды${E}|${B}суы${E}`)],
  ['ELECTRICITY', new RegExp(`электроэнерг|электроснабж|электричеств|${B}свет[ау]?${E}|без света|${B}электр|жарық|қуат`)],
  ['HEATING', new RegExp(`отоплен|теплоснабж|${B}тепл[оа]${E}|${B}жылу${E}|жылыту`)],
  ['GAS', new RegExp(`газоснабж|подач[${L}]* газа|${B}газ[аы]?${E}`)],
  ['ROAD', new RegExp(`перекрыт[${L}]* (?:движ|дорог|улиц|участ)|ограничен[${L}]* движ|ремонт[${L}]* дорог|дорожн[${L}]* работ|${B}жол[${L}]* жабыл|қозғалыс[${L}]* шектел|закрыт[${L}]* (?:движ|проезд)|${B}объезд`)],
  ['TRANSPORT', new RegExp(`автобус|${B}маршрут|общественн[${L}]* транспорт|қоғамдық көлік`)],
  ['EMERGENCY', new RegExp(`чрезвычайн|эвакуац|${B}чс${E}|төтенше`)],
  ['WEATHER', new RegExp(`штормов|сильн[${L}]* ветер|порыв[${L}]* ветра|гололед|${B}боран|${B}дауыл`)],
]

function detectCategory(t: string): { category: Category; hits: number } {
  const scores = CATEGORY_RULES.map(([c, re]) => ({ c, n: (t.match(new RegExp(re.source, 'g')) ?? []).length }))
  const hot = scores.find((s) => s.c === 'HOT_WATER')!
  if (hot.n > 0 && !/питьев|холодн/.test(t)) return { category: 'HOT_WATER', hits: hot.n }
  const best = scores.filter((s) => s.c !== 'HOT_WATER').sort((a, b) => b.n - a.n)[0]!
  return best.n > 0 ? { category: best.c, hits: best.n } : { category: 'OTHER', hits: 0 }
}

// ── Nature of the notice ────────────────────────────────────────────────────
const RESTORED = new RegExp(`восстановлен[аоы]?(?![${L}])|возобновлен[аоы]?(?![${L}])|подач[${L}]* [${L} ]*возобновл|${B}включен[ао]? обратно|қалпына келтірілді|беріле бастады|беру қайта`)
const CANCELLED = new RegExp(`${B}отмен[еи]н|отменяется|не будет производиться|тоқтатылмайды|болмайды`)
const EMERGENCY = new RegExp(`авари|${B}порыв|повреждени|${B}апат|внепланов|${B}утечк`)
const PLANNED = new RegExp(`планов|запланирован|будет отключ|будут отключ|${B}отключат|ограничат|будет ограничен|будет прекращ|будут прекращ|жоспарлы|өшіріледі|тоқтатылады|шектеледі`)
const ETA_PHRASE = new RegExp(`время восстановления|ориентировочн[${L}]* (?:время|срок)|ожидается восстановлени|восстановят к|қалпына келтіру уақыты`)
const ETA_UNKNOWN = new RegExp(`время восстановления (?:будет )?(?:сообщ|уточн|не извест)|сроки [${L} ]*не (?:извест|определ)|уақыты хабарланады`)
const PARTIAL = new RegExp(`${B}част[${L}]* (?:жил[${L}]* массив|микрорайон|мкр|район|дом|улиц)|частично|${B}бөлігі`)

// ── Times ───────────────────────────────────────────────────────────────────
const T = '(\\d{1,2})[:.](\\d{2})'
const RANGE_PATTERNS: RegExp[] = [
  new RegExp(`${B}(?:с|от)\\s*${T}\\s*(?:ч\\.?|час[${L}]*)?\\s*до\\s*${T}`, 'g'),
  new RegExp(`${B}(?:с|от)\\s*(\\d{1,2})\\s*(?:ч\\.?|час[${L}]*)\\s*до\\s*(\\d{1,2})\\s*(?:ч|час)`, 'g'),
  new RegExp(`(?:сағат\\s*)?${T}\\s*-?\\s*(?:дан|ден|тан|тен)\\s*${T}\\s*-?\\s*(?:ға|ге|қа|ке)?\\s*дейін`, 'g'),
  new RegExp(`${T}\\s*-\\s*${T}`, 'g'),
]
const START_PATTERN = new RegExp(`(?:${B}начиная с|${B}с|${B}в|${B}от|сағат)\\s*${T}(?!\\s*(?:-|до\\s*\\d))`, 'g')
const END_PATTERN = new RegExp(`(?:время восстановления|ориентировочн[${L}]*|ожидается[${L} ]*|восстановят|возобновят|${B}до)\\s*[-:—]?\\s*(?:в|к|до)?\\s*${T}`, 'g')

type TimeHit = { start?: [number, number]; end?: [number, number]; text: string; span: [number, number] }

function validHM(h: number, m: number) {
  return h >= 0 && h <= 24 && m >= 0 && m < 60
}

function findTimes(t: string): TimeHit | null {
  for (const re of RANGE_PATTERNS) {
    re.lastIndex = 0
    const m = re.exec(t)
    if (!m) continue
    const nums = m.slice(1).filter((x) => x !== undefined).map(Number)
    const [h1, m1, h2, m2] = nums.length === 2 ? [nums[0]!, 0, nums[1]!, 0] : (nums as [number, number, number, number])
    if (validHM(h1, m1) && validHM(h2, m2)) return { start: [h1, m1], end: [h2, m2], text: m[0], span: [m.index, m.index + m[0].length] }
  }
  START_PATTERN.lastIndex = 0
  END_PATTERN.lastIndex = 0
  const s = START_PATTERN.exec(t)
  let e = END_PATTERN.exec(t)
  // "Ориентировочное время восстановления … в 14 мкр — 18:30": ETA phrase, time later in the sentence.
  if (!e) {
    const eta = ETA_PHRASE.exec(t)
    if (eta) {
      const rest = t.slice(eta.index)
      const tm = new RegExp(`(?<![\\d])${T}`).exec(rest.split(/[.;!?](?:\s|$)/)[0] ?? rest)
      if (tm) {
        const fake = Object.assign([tm[0], tm[1], tm[2]], { index: eta.index + tm.index, input: t }) as unknown as RegExpExecArray
        e = fake
      }
    }
  }
  if (!s && !e) return null
  const hit: TimeHit = { text: '', span: [Infinity, -Infinity] }
  if (s && validHM(+s[1]!, +s[2]!)) {
    hit.start = [+s[1]!, +s[2]!]
    hit.text = s[0]
    hit.span = [s.index, s.index + s[0].length]
  }
  if (e && validHM(+e[1]!, +e[2]!) && (!s || e.index !== s.index)) {
    hit.end = [+e[1]!, +e[2]!]
    hit.text = hit.text ? `${hit.text} … ${e[0]}` : e[0]
    hit.span = [Math.min(hit.span[0], e.index), Math.max(hit.span[1], e.index + e[0].length)]
  }
  return hit.start || hit.end ? hit : null
}

// ── Dates ───────────────────────────────────────────────────────────────────
type DateHit = { date: LocalDate; text: string }

function findDate(t: string, reference: Date, masked: Array<[number, number]>): DateHit | null {
  const inMask = (i: number) => masked.some(([a, b]) => i >= a && i < b)
  const monthRe = new RegExp(`${B}(\\d{1,2})\\s+([${L}]{3,})(?:\\s+(\\d{4}))?`, 'g')
  let m: RegExpExecArray | null
  while ((m = monthRe.exec(t))) {
    const month = monthFromWord(m[2]!)
    const day = Number(m[1])
    if (!month || day < 1 || day > 31 || inMask(m.index)) continue
    const year = m[3] ? Number(m[3]) : inferYear(month, day, reference)
    return { date: { year, month, day }, text: m[0] }
  }
  const numRe = /(?<![\d:.])(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?(?![\d:])/g
  while ((m = numRe.exec(t))) {
    const day = Number(m[1]), month = Number(m[2])
    if (inMask(m.index) || day < 1 || day > 31 || month < 1 || month > 12) continue
    if (!m[3] && /(?:с|до|в|от)\s*$/.test(t.slice(Math.max(0, m.index - 4), m.index))) continue // "с 10.09" is a time
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : inferYear(month, day, reference)
    return { date: { year, month, day }, text: m[0] }
  }
  const rel: Array<[RegExp, number]> = [
    [new RegExp(`${B}(?:послезавтра|бүрсігүні)${E}`), 2],
    [new RegExp(`${B}(?:завтра|ертең)`), 1],
    [new RegExp(`${B}(?:сегодня|бүгін)`), 0],
  ]
  for (const [re, days] of rel) {
    const r = re.exec(t)
    if (r) return { date: addDays(localDate(reference), days), text: r[0] }
  }
  return null
}

// ── Areas ───────────────────────────────────────────────────────────────────
const MKR = `(?:микрорайон[${L}]*|мкр\\.?|мкрн\\.?|шағын\\s*аудан[${L}]*|шагын\\s*аудан[${L}]*)`
const NUM = `\\d{1,2}(?:[а-яa-z](?![${L}]))?`
const LIST = `${NUM}(?:\\s*(?:,|${B}и${E}|${B}және${E}|;)\\s*${NUM})*`
const AREA_BEFORE = new RegExp(`(${LIST})(?:-?(?:м|й|ом|ый|ой|ші|шы|ыи))?\\s*${MKR}`, 'g')
const AREA_AFTER = new RegExp(`${MKR}\\s*№?\\s*(${LIST})(?![\\d:.])`, 'g')
const AREA_NAMED = new RegExp(`${B}(шыгыс|шығыс|толкын|толқын|самал)(?:\\s*-\\s*|\\s+)?(\\d)?`, 'g')
const HOUSE_WORD = new RegExp(`(?:${B}дом[${L}]*|${B}д\\.|№|${B}үй[${L}]*)\\s*[:\\s]*$`)

function splitList(list: string): string[] {
  return list.split(new RegExp(`\\s*(?:,|;|${B}и${E}|${B}және${E})\\s*`)).map((x) => x.trim()).filter(Boolean)
}

function findAreas(t: string): { areas: string[]; text: string[] } {
  const areas = new Set<string>()
  const texts: string[] = []
  for (const re of [AREA_BEFORE, AREA_AFTER]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) {
      let items = splitList(m[1]!)
      // "дом 5, 14 микрорайон": numbers right after a house keyword are houses.
      if (re === AREA_BEFORE && HOUSE_WORD.test(t.slice(Math.max(0, m.index - 12), m.index))) items = items.slice(-1)
      // "шағын аудандағы 12, 14 үйлерде" / "мкр 14, дома 5": a list followed by a house word is houses.
      if (re === AREA_AFTER && new RegExp(`^\\s*-?\\s*(?:үй|дом|д\\.)`).test(t.slice(m.index + m[0].length))) {
        texts.push(m[0].replace(m[1]!, '').trim())
        continue
      }
      for (const it of items) {
        const d = canonicalNumberDesignator(it)
        if (/^\d{1,2}[А-Я]?$/.test(d) && Number.parseInt(d, 10) > 0 && Number.parseInt(d, 10) <= 40) areas.add(d)
      }
      texts.push(m[0])
    }
  }
  AREA_NAMED.lastIndex = 0
  let n: RegExpExecArray | null
  while ((n = AREA_NAMED.exec(t))) {
    const d = parseDistrictDesignator(`${n[1]}${n[2] ? `-${n[2]}` : ''} микрорайон`)
    if (d) {
      areas.add(d)
      texts.push(n[0])
    }
  }
  return { areas: [...areas], text: texts }
}

// ── Buildings ───────────────────────────────────────────────────────────────
const HOUSE_TOKEN = `№?\\s*\\d{1,3}(?:[а-яa-z](?![${L}]))?(?:\\/\\d{1,3})?`
const HOUSE_SEP = `\\s*(?:,|;|${B}и${E}|${B}және${E}|-|–)\\s*`
const HOUSES_AFTER = new RegExp(`(?:${B}(?:жил[${L}]*\\s+)?дом(?:а|ов|ах|е|у)?${E}|${B}д\\.|${B}здани[${L}]*)\\s*[:]?\\s*((?:${HOUSE_TOKEN})(?:${HOUSE_SEP}${HOUSE_TOKEN})*)`, 'g')
const HOUSES_BEFORE_KK = new RegExp(`((?:${HOUSE_TOKEN})(?:${HOUSE_SEP}${HOUSE_TOKEN})*)\\s*-?\\s*(?:үй|үйлер|үйлерде|үйлерінде)${E}`, 'g')

function findBuildings(t: string): { buildings: string[]; text: string[] } {
  const out: string[] = []
  const texts: string[] = []
  for (const re of [HOUSES_AFTER, HOUSES_BEFORE_KK]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) {
      // Guard: a list followed by "микрорайон" is districts, not houses.
      if (new RegExp(`^\\s*-?(?:[${L}]{0,3})\\s*${MKR}`).test(t.slice(m.index + m[0].length))) continue
      texts.push(m[0])
      const parts = m[1]!.split(/\s*(?:,|;|(?<![а-яa-z])и(?![а-яa-z])|және)\s*/)
      for (const p of parts) {
        const clean = p.replace(/№/g, '').trim()
        const range = clean.match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/)
        if (range) {
          const a = Number(range[1]), b = Number(range[2])
          if (b > a && b - a <= 40) for (let i = a; i <= b; i++) out.push(String(i))
          else out.push(String(a), String(b))
          continue
        }
        for (const piece of clean.split(/\s*[-–]\s*/)) if (/^\d/.test(piece)) out.push(normalizeHouseNumber(piece))
      }
    }
  }
  return { buildings: [...new Set(out)], text: texts }
}

// ── Reason ──────────────────────────────────────────────────────────────────
// A reason clause ends where the notice itself continues ("…работами, будет отключена …").
const REASON_STOP = new RegExp(`\\s*(?:,|\\(|${B}будет|${B}будут|${B}прекращ|${B}отключ|${B}ограничен|${B}с\\s*\\d|${B}в\\s*\\d|${B}в\\s+(?:микрорайон|мкр|жил)|${B}на\\s+территории|${B}до\\s*\\d)`)

function findReason(original: string, t: string): string | null {
  const ru = new RegExp(`(?:в связи с|по причине|из-за|ввиду|в целях)\\s+([^.;\\n]{5,160})`).exec(t)
  if (ru) {
    const start = ru.index + ru[0].length - ru[1]!.length
    const stop = REASON_STOP.exec(ru[1]!)
    const text = original.slice(start, start + (stop ? stop.index : ru[1]!.length)).trim()
    return text.length >= 4 ? text : null
  }
  const kk = new RegExp(`([^.;\\n,]{5,120})\\s+(?:байланысты|себепті)`).exec(t)
  if (kk) {
    let text = original.slice(kk.index, kk.index + kk[1]!.length)
    const lead = new RegExp(`^.*(?:үйлерде|үйлерінде|аудан[${L}]*|мкр\\.?)\\s+`, 'i').exec(fold(text))
    if (lead) text = text.slice(lead[0].length)
    return text.trim().length >= 4 ? text.trim() : null
  }
  return null
}

// ── Segmentation ────────────────────────────────────────────────────────────
type Seg = { text: string; hasTime: boolean; hasLocation: boolean }

function segment(text: string): Seg[] {
  const paragraphs = text.split(/\n\s*\n|\r?\n/).map((p) => p.trim()).filter(Boolean)
  const segs: Seg[] = []
  for (const p of paragraphs) {
    const sentences = p.split(/(?<=[.!?;])\s+(?=[А-ЯЁӘҒҚҢӨҰҮҺІA-Z0-9«"])/)
    let current: Seg | null = null
    for (const s of sentences) {
      const f = fold(s)
      const hasTime = !!findTimes(f)
      const hasLocation = findAreas(f).areas.length > 0 || findBuildings(f).buildings.length > 0
      // A sentence with its own time window starts a new notice.
      if (!current || (hasTime && current.hasTime)) {
        current = { text: s, hasTime, hasLocation }
        segs.push(current)
      } else {
        current.text += ` ${s}`
        current.hasTime ||= hasTime
        current.hasLocation ||= hasLocation
      }
    }
  }
  // Merge a time-only segment with a following location-only one (and vice versa).
  const merged: Seg[] = []
  for (const s of segs) {
    const prev = merged.at(-1)
    if (prev && ((prev.hasTime && !prev.hasLocation && s.hasLocation && !s.hasTime) || (!prev.hasTime && prev.hasLocation && s.hasTime && !s.hasLocation))) {
      prev.text += ` ${s.text}`
      prev.hasTime = prev.hasLocation = true
    } else merged.push({ ...s })
  }
  return merged.filter((s) => s.hasTime || s.hasLocation)
}

// ── Main ────────────────────────────────────────────────────────────────────
const CATEGORY_NOUN: Record<Category, string> = {
  WATER: 'water', HOT_WATER: 'hot water', ELECTRICITY: 'electricity', HEATING: 'heating', GAS: 'gas', ROAD: 'road',
  TRANSPORT: 'transport', WEATHER: 'weather', AIR_QUALITY: 'air quality', CASPIAN: 'Caspian', EMERGENCY: 'emergency',
  EVENT: 'city event', OTHER: 'city notice',
}

function canonicalTitle(category: Category, type: Extraction['event_type'], areas: string[]): string {
  const noun = CATEGORY_NOUN[category]
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
  const head =
    type === 'restoration' ? `${cap(noun)} restored`
    : type === 'planned_outage' ? `Planned ${noun} interruption`
    : type === 'emergency_outage' ? `${cap(noun)} interruption`
    : type === 'road_closure' ? 'Road closure'
    : type === 'road_works' ? 'Road works'
    : `${cap(noun)} notice`
  const where = areas.length ? ` · ${areas.slice(0, 4).map((a) => (/^\d/.test(a) ? `${a} mkr` : a)).join(', ')}${areas.length > 4 ? ` +${areas.length - 4}` : ''}` : ''
  return `${head}${where}`
}

export function extractWithRules(input: ExtractInput): RuleSegment[] {
  const reference = input.published_at ?? input.fetched_at
  const docAuthority = detectAuthority(`${input.title ?? ''} ${input.text}`)?.key ?? input.reported_authority ?? null
  const titleCat = input.title ? detectCategory(fold(input.title)).category : 'OTHER'
  // Document-level date context (e.g. "сегодня" in the headline).
  let carriedDate: DateHit | null = input.title ? findDate(fold(input.title), reference, []) : null
  let carriedCategory: Category = titleCat

  const results: RuleSegment[] = []
  const segs = segment(input.text)
  segs.forEach((seg, index) => {
    const t = fold(seg.text)
    const warnings: ExtractionWarning[] = []
    const errors: ExtractionWarning[] = []

    let { category, hits } = detectCategory(t)
    if (category === 'OTHER' && carriedCategory !== 'OTHER') {
      category = carriedCategory
      warnings.push({ field: 'category', code: 'category_from_context', message: 'Category taken from the headline / previous paragraph.' })
    }
    if (category !== 'OTHER') carriedCategory = category

    const times = findTimes(t)
    const masked: Array<[number, number]> = times ? [times.span] : []
    const ownDate = findDate(t, reference, masked)
    if (ownDate) carriedDate = ownDate
    const date = ownDate ?? carriedDate
    const { areas, text: areaTexts } = findAreas(t)
    const { buildings, text: bTexts } = findBuildings(t)
    const partial = PARTIAL.test(t)

    let starts_at: Date | null = null
    let expected_ends_at: Date | null = null
    if (times) {
      let day = date?.date
      if (!day) {
        day = localDate(reference)
        warnings.push({ field: 'starts_at', code: 'date_assumed', message: 'No date in the text; assumed the publication day.' })
      }
      if (times.start) starts_at = fromLocal(day.year, day.month, day.day, times.start[0] % 24, times.start[1])
      if (times.end) {
        expected_ends_at = fromLocal(day.year, day.month, day.day, times.end[0] % 24, times.end[1])
        if (times.end[0] === 24) expected_ends_at = new Date(expected_ends_at.getTime() + 86400000)
        if (starts_at && expected_ends_at <= starts_at) expected_ends_at = new Date(expected_ends_at.getTime() + 86400000) // overnight window
      }
    }

    // Date without a clock time ("С 25 сентября перекрыто …"): anchor at the
    // start of that day and say so — the verbatim phrase stays in time_text.
    if (!times && ownDate) {
      starts_at = fromLocal(ownDate.date.year, ownDate.date.month, ownDate.date.day)
      warnings.push({ field: 'starts_at', code: 'day_only', message: 'Only a date was given, no time of day.' })
    }

    let event_type: Extraction['event_type']
    let status: EventStatus
    const now = input.fetched_at
    if (RESTORED.test(t)) { event_type = 'restoration'; status = 'RESOLVED' }
    else if (CANCELLED.test(t)) { event_type = category === 'ROAD' ? 'road_closure' : 'planned_outage'; status = 'CANCELLED' }
    else if (category === 'ROAD') { event_type = /перекр|закрыт|жабыл/.test(t) ? 'road_closure' : 'road_works'; status = 'SCHEDULED' }
    else if (category === 'TRANSPORT') { event_type = 'transport_change'; status = 'SCHEDULED' }
    else if (category === 'WEATHER' || category === 'EMERGENCY') { event_type = 'weather_warning'; status = 'ACTIVE' }
    else if (EMERGENCY.test(t) && !PLANNED.test(t.replace(/внепланов/g, ''))) { event_type = 'emergency_outage'; status = 'ACTIVE' }
    else if (EMERGENCY.test(t)) { event_type = 'emergency_outage'; status = 'ACTIVE' }
    else if (PLANNED.test(t) || starts_at) { event_type = 'planned_outage'; status = 'SCHEDULED' }
    else if (ETA_PHRASE.test(t) && expected_ends_at) { event_type = 'emergency_outage'; status = 'ACTIVE' }
    else { event_type = 'other'; status = 'UNCONFIRMED' }

    // A restoration notice's single time is when service came back, not a start.
    if (event_type === 'restoration' && starts_at && !expected_ends_at) {
      expected_ends_at = starts_at
      starts_at = null
    }
    if (status !== 'RESOLVED' && status !== 'CANCELLED') {
      if (starts_at && starts_at > now) status = 'SCHEDULED'
      else if (starts_at && starts_at <= now) status = 'ACTIVE'
    }

    if (event_type === 'emergency_outage' && !expected_ends_at) {
      warnings.push({ field: 'expected_ends_at', code: ETA_UNKNOWN.test(t) ? 'eta_not_announced' : 'eta_absent', message: 'Restoration time has not been announced — kept as null.' })
    }
    if (category === 'OTHER') errors.push({ field: 'category', code: 'category_unknown', message: 'Could not determine which service this is about.' })
    if (!areas.length && !buildings.length) errors.push({ field: 'areas', code: 'no_location', message: 'No microdistrict or building found.' })
    if (buildings.length && areas.length > 1) warnings.push({ field: 'buildings', code: 'buildings_area_ambiguous', message: 'Houses listed with several districts; check which district each belongs to.' })
    if (buildings.length && !areas.length) errors.push({ field: 'buildings', code: 'buildings_without_area', message: 'Houses listed without a microdistrict.' })
    if (!starts_at && event_type === 'planned_outage') warnings.push({ field: 'starts_at', code: 'start_absent', message: 'No start time found.' })

    const authority = detectAuthority(seg.text)?.key ?? docAuthority
    let confidence = 0.4
    if (hits > 0) confidence += 0.15
    if (times) confidence += 0.15
    if (areas.length) confidence += 0.12
    if (authority) confidence += 0.1
    if (ownDate || carriedDate) confidence += 0.05
    confidence -= 0.1 * errors.length + 0.03 * warnings.filter((w) => w.code !== 'eta_not_announced' && w.code !== 'eta_absent').length
    confidence = Math.max(0.05, Math.min(0.95, Math.round(confidence * 100) / 100))

    const candidate = {
      category,
      event_type,
      status,
      title: canonicalTitle(category, event_type, areas),
      summary: seg.text.length > 600 ? `${seg.text.slice(0, 597)}…` : seg.text,
      starts_at: starts_at?.toISOString() ?? null,
      expected_ends_at: expected_ends_at?.toISOString() ?? null,
      areas,
      buildings,
      partial_area: partial,
      reason: findReason(seg.text, t),
      authority,
      time_text: [date?.text, times?.text].filter(Boolean).join(', ') || null,
      location_text: [...areaTexts, ...bTexts].join('; ').slice(0, 400) || null,
      confidence,
    }
    const parsed = ExtractionSchema.safeParse(candidate)
    if (!parsed.success) {
      errors.push({ field: '*', code: 'schema_invalid', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
    }
    results.push({ index, text: seg.text, extraction: parsed.success ? parsed.data : (candidate as Extraction), warnings, errors })
  })
  return results
}
