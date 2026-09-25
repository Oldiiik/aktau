// Ask Aktau is not "question → LLM → answer". It is:
//   question → intent → entities → structured query (server) → trusted rows → formatter
// This module holds the deterministic intent/entity layer and the answer
// templates. An LLM may rephrase the final sentence; it never decides facts.
import { t, eventHeadline } from '@aktau/i18n'
import { addDays, fmtTime, fromLocal, localDate, localDayRange, localParts, sameLocalDay, fmtDate } from '@aktau/normalization/time'
import { parseDistrictDesignator } from '@aktau/normalization/text'
import type { AskIntent, Category, CityEventDTO, Lang, ServiceKey } from '@aktau/types'

const L = 'а-яёәғқңөұүһіa-z'
const B = `(?<![${L}])`

export type AskEntities = {
  service: ServiceKey | null
  categories: Category[]
  window: { start: Date; end: Date; kind: 'point' | 'range' | 'day' | 'now' } | null
  district: string | null
  placeCategory: string | null
  destination: string | null
}

const SERVICE_WORDS: Array<[ServiceKey, Category[], RegExp]> = [
  ['water', ['WATER', 'HOT_WATER'], new RegExp(`${B}(?:water|вод[аыуе]|водоснабж|${B}су${B}|${B}суы|ауыз су|hot water|горяч)`)],
  ['electricity', ['ELECTRICITY'], new RegExp(`electric|power|${B}свет|электр|жарық|қуат`)],
  ['heating', ['HEATING', 'GAS'], new RegExp(`heating|${B}heat${B}|отоплен|${B}тепл|${B}жылу|${B}газ|${B}gas${B}`)],
  ['roads', ['ROAD'], new RegExp(`${B}road|traffic|closure|дорог|перекрыт|пробк|${B}жол`)],
  ['transport', ['TRANSPORT'], new RegExp(`${B}bus|transport|автобус|транспорт|көлік`)],
]

const PLACE_WORDS: Array<[string, RegExp]> = [
  ['food', new RegExp(`${B}eat|food|restaurant|cafe|café|dinner|lunch|breakfast|поесть|кафе|ресторан|еда|поужинать|тамақ|мейрамхана|асхана`)],
  ['pharmacy', new RegExp(`pharmac|аптек|дәріхана`)],
  ['hospital', new RegExp(`hospital|clinic|больниц|поликлиник|аурухана|емхана`)],
  ['atm', new RegExp(`${B}atm|банкомат`)],
  ['fuel', new RegExp(`fuel|petrol|gas station|азс|заправк|жанармай`)],
  ['park', new RegExp(`${B}park|парк|${B}саябақ`)],
  ['attraction', new RegExp(`sight|attraction|visit|достопримечател|көрікті`)],
]

export function classifyIntent(q: string, now: Date = new Date()): { intent: AskIntent; entities: AskEntities } {
  const text = q.toLowerCase().replace(/ё/g, 'е')
  const svc = SERVICE_WORDS.find(([, , re]) => re.test(text))
  const place = PLACE_WORDS.find(([, re]) => re.test(text))
  const entities: AskEntities = {
    service: svc?.[0] ?? null,
    categories: svc?.[1] ?? [],
    window: null,
    district: findDistrict(text),
    placeCategory: place?.[0] ?? null,
    destination: /airport|аэропорт|әуежай/.test(text) ? 'airport' : null,
  }
  const future = /tomorrow|tonight|morning|evening|weekend|at \d|\d\s*(?:am|pm)|завтра|вечер|утр|ночь|в \d{1,2}[:.]?\d{0,2}|ертең|кешке|таңертең|сағат/.test(text)

  let intent: AskIntent
  if (/how (?:do|can) i get|how to get|directions|как добраться|как доехать|маршрут до|қалай жетемін|қалай барамын/.test(text) || entities.destination) intent = 'DIRECTIONS'
  else if (/caspian|sea\b|swim|waves?|beach|каспи|море|волн|купат|пляж|теңіз|толқын|жағажай/.test(text) && !/coast.*wind|wind.*coast|ветер|жел/.test(text)) intent = 'CASPIAN'
  else if (svc && (svc[0] === 'water' || svc[0] === 'electricity' || svc[0] === 'heating')) intent = future ? 'UPCOMING_OUTAGE' : 'UTILITY_STATUS'
  else if (svc?.[0] === 'roads') intent = 'ROAD_STATUS'
  else if (svc?.[0] === 'transport') intent = 'TRANSPORT'
  else if (/weather|wind|windy|temperature|rain|hot|cold|погод|ветер|ветр|температур|дожд|жарк|холодн|ауа райы|жел\b|жаңбыр|ыстық|суық/.test(text)) intent = 'WEATHER'
  else if (place) intent = 'PLACE_SEARCH'
  else if (/weekend|concert|festival|event|what's on|whats on|выходн|концерт|фестивал|событи|мероприят|демалыс|іс-шара/.test(text)) intent = 'EVENT_SEARCH'
  else if (/near (?:me|home)|around|happening|рядом|вокруг|происходит|жаныңда|жанында|айналада|не болып/.test(text)) intent = 'AROUND_ME'
  else if (/aktau|city|город|актау|ақтау|қала/.test(text)) intent = 'CITY_STATE'
  else intent = 'UNKNOWN'

  entities.window = findWindow(text, now)
  return { intent, entities }
}

function findDistrict(text: string): string | null {
  const m = text.match(new RegExp(`(\\d{1,2}\\s?[а-яa-z]?)(?:-?(?:й|м|ом|ый))?\\s*(?:мкр|микрорайон[${L}]*|mkr|microdistrict|шағын аудан[${L}]*)|(?:мкр\\.?|микрорайон[${L}]*|mkr)\\s*(\\d{1,2}[а-яa-z]?)`))
  if (!m) return null
  return parseDistrictDesignator(`${(m[1] ?? m[2])!.trim()} мкр`)
}

/** Natural-language time → absolute window in Asia/Aqtau. */
export function findWindow(text: string, now: Date): AskEntities['window'] {
  const base = /tomorrow|завтра|ертең/.test(text) ? addDays(localDate(now), 1)
    : /day after tomorrow|послезавтра|бүрсігүні/.test(text) ? addDays(localDate(now), 2) : localDate(now)
  const explicitDay = base.day !== localDate(now).day || /today|сегодня|бүгін/.test(text)
  // "at 3 PM", "в 15:00", "сағат 15-те"
  const pm = text.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/)
  const hm = text.match(/(?:в|at|сағат|к)\s*(\d{1,2})(?:[:.](\d{2}))?(?![\d])/)
  if (pm || hm) {
    let h = Number((pm ?? hm)![1]), m = Number((pm ?? hm)![2] ?? 0)
    if (pm?.[3] === 'pm' && h < 12) h += 12
    if (pm?.[3] === 'am' && h === 12) h = 0
    if (h <= 23 && m < 60) {
      const at = fromLocal(base.year, base.month, base.day, h, m)
      return { start: at, end: new Date(at.getTime() + 60_000), kind: 'point' }
    }
  }
  const range = (h1: number, h2: number, dayOffset = 0) => {
    const d = addDays(base, dayOffset)
    const e = h2 <= h1 ? addDays(d, 1) : d
    return { start: fromLocal(d.year, d.month, d.day, h1), end: fromLocal(e.year, e.month, e.day, h2 % 24), kind: 'range' as const }
  }
  if (/morning|утр|таңертең|таңғы/.test(text)) return range(5, 12)
  if (/afternoon|днем|днём|түсте/.test(text)) return range(12, 18)
  if (/evening|вечер|кешке|кеште/.test(text)) return range(18, 23)
  if (/tonight|night|ночь|ночью|түнде/.test(text)) return range(21, 6)
  if (/weekend|выходн|демалыс/.test(text)) {
    const wd = localParts(now).weekday
    const toSat = (6 - wd + 7) % 7
    const sat = addDays(localDate(now), toSat)
    const mon = addDays(sat, 2)
    return { start: fromLocal(sat.year, sat.month, sat.day), end: fromLocal(mon.year, mon.month, mon.day), kind: 'range' }
  }
  if (explicitDay) {
    const [s, e] = localDayRange(fromLocal(base.year, base.month, base.day, 12), 0)
    return { start: s, end: e, kind: 'day' }
  }
  if (/now|right now|currently|сейчас|қазір/.test(text)) return { start: now, end: new Date(now.getTime() + 60_000), kind: 'now' }
  return null
}

// ── Answer templates ────────────────────────────────────────────────────────
export type UtilityAnswer = { message: string; detail: string | null; affected: 'yes' | 'area' | 'no_information' }

export function formatUtilityAnswer(
  lang: Lang,
  service: ServiceKey,
  direct: CityEventDTO[],
  area: CityEventDTO[],
  window: AskEntities['window'],
  areaLabel: string,
  now: Date,
): UtilityAnswer {
  const svcWord = t(lang, `service.${service}`).toLowerCase()
  const primary = direct[0]
  if (primary) {
    const start = primary.starts_at ? new Date(primary.starts_at) : null
    const end = primary.expected_ends_at ? new Date(primary.expected_ends_at) : null
    const ongoing = primary.display_status === 'ACTIVE' || primary.display_status === 'DELAYED'
    let message: string
    if (window?.kind === 'point' && start && end) message = t(lang, 'ask.utility.no.point', { start: fmtTime(start), end: fmtTime(end) })
    else if (start && end) message = t(lang, 'ask.utility.no', { start: fmtTime(start), end: fmtTime(end) })
    else if (start) message = t(lang, 'ask.utility.no.open', { start: fmtTime(start) })
    else message = t(lang, 'ask.utility.no.now')
    const eta = end ? t(lang, 'eta.expected', { time: fmtTime(end) }) : t(lang, 'eta.unknown')
    const detail = ongoing ? t(lang, 'ask.utility.detail.active', { area: areaLabel, eta }) : t(lang, 'ask.utility.detail.planned', { area: areaLabel })
    const day = start && !sameLocalDay(start, now) ? ` ${fmtDate(start, lang)}.` : ''
    return { message, detail: `${detail}${day}`.trim(), affected: 'yes' }
  }
  if (area[0]) {
    return { message: t(lang, 'ask.utility.nearby', { area: areaLabel }), detail: eventHeadline(lang, area[0]), affected: 'area' }
  }
  return { message: t(lang, 'ask.no_info.utility', { service: svcWord }), detail: t(lang, 'ask.no_info.detail'), affected: 'no_information' }
}

/** Guard for optional LLM phrasing: every number/time in the template must survive verbatim. */
export function phrasingPreservesFacts(template: string, phrased: string): boolean {
  const facts = template.match(/\d{1,2}[:.]\d{2}|\d+/g) ?? []
  return facts.every((f) => phrased.includes(f)) && phrased.length < template.length * 3 + 80
}
