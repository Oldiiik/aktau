// 109 Copilot — pure, deterministic incident intelligence.
//
//   signal text → INTAKE (service, place, time, scope, risk, missing)
//               → MATCH against open incidents (same thing, same place, same time?)
//               → ROUTE through the responsibility graph
//               → SLA guardian · response quality · proof-of-resolution checks
//
// The copilot proposes; a 109 operator or executor confirms. Nothing here
// needs a network or a language model, so it is fast, testable and explainable:
// every score comes with the reasons that produced it.
import type { Category, Lang } from '@aktau/types'

// ── Taxonomy ────────────────────────────────────────────────────────────────
export const SERVICES = [
  'water', 'hot_water', 'electricity', 'heating', 'gas', 'streetlight', 'garbage', 'road', 'sewer',
  'elevator', 'building_safety', 'yard', 'transport', 'other',
] as const
export type IncidentService = (typeof SERVICES)[number]

type L3 = { en: string; ru: string; kk: string }
export const SERVICE_META: Record<IncidentService, { category: Category; label: L3; outage: L3; damage?: L3; buildingLevel: boolean }> = {
  water: { category: 'WATER', label: { en: 'Water', ru: 'Вода', kk: 'Су' }, outage: { en: 'No water', ru: 'Нет воды', kk: 'Су жоқ' }, damage: { en: 'Water leak', ru: 'Течь воды', kk: 'Су ағып жатыр' }, buildingLevel: false },
  hot_water: { category: 'HOT_WATER', label: { en: 'Hot water', ru: 'Горячая вода', kk: 'Ыстық су' }, outage: { en: 'No hot water', ru: 'Нет горячей воды', kk: 'Ыстық су жоқ' }, damage: { en: 'Hot water leak', ru: 'Течь горячей воды', kk: 'Ыстық су ағып жатыр' }, buildingLevel: false },
  electricity: { category: 'ELECTRICITY', label: { en: 'Electricity', ru: 'Электричество', kk: 'Электр' }, outage: { en: 'Power outage', ru: 'Нет света', kk: 'Жарық жоқ' }, buildingLevel: false },
  heating: { category: 'HEATING', label: { en: 'Heating', ru: 'Отопление', kk: 'Жылу' }, outage: { en: 'No heating', ru: 'Нет отопления', kk: 'Жылу жоқ' }, damage: { en: 'Heating pipe leak', ru: 'Течь отопления', kk: 'Жылу құбыры ағып жатыр' }, buildingLevel: false },
  gas: { category: 'GAS', label: { en: 'Gas', ru: 'Газ', kk: 'Газ' }, outage: { en: 'Gas problem', ru: 'Проблема с газом', kk: 'Газ ақаулығы' }, buildingLevel: true },
  streetlight: { category: 'OTHER', label: { en: 'Street lighting', ru: 'Уличное освещение', kk: 'Көше жарығы' }, outage: { en: 'Street lights out', ru: 'Не работает освещение', kk: 'Көше жарығы жанбайды' }, buildingLevel: false },
  garbage: { category: 'OTHER', label: { en: 'Waste', ru: 'Мусор', kk: 'Қоқыс' }, outage: { en: 'Waste not collected', ru: 'Не вывезен мусор', kk: 'Қоқыс шығарылмаған' }, buildingLevel: false },
  road: { category: 'ROAD', label: { en: 'Roads', ru: 'Дороги', kk: 'Жолдар' }, outage: { en: 'Road damage', ru: 'Повреждение дороги', kk: 'Жол бұзылған' }, buildingLevel: false },
  sewer: { category: 'OTHER', label: { en: 'Sewer', ru: 'Канализация', kk: 'Кәріз' }, outage: { en: 'Sewer blockage', ru: 'Засор канализации', kk: 'Кәріз бітелген' }, buildingLevel: true },
  elevator: { category: 'OTHER', label: { en: 'Elevator', ru: 'Лифт', kk: 'Лифт' }, outage: { en: 'Elevator stopped', ru: 'Не работает лифт', kk: 'Лифт істемейді' }, buildingLevel: true },
  building_safety: { category: 'EMERGENCY', label: { en: 'Building safety', ru: 'Безопасность здания', kk: 'Ғимарат қауіпсіздігі' }, outage: { en: 'Facade hazard', ru: 'Опасность на фасаде', kk: 'Қасбет қауіпті' }, buildingLevel: true },
  yard: { category: 'OTHER', label: { en: 'Yards & parks', ru: 'Дворы и скверы', kk: 'Аула мен саябақ' }, outage: { en: 'Yard issue', ru: 'Проблема во дворе', kk: 'Аула мәселесі' }, buildingLevel: false },
  transport: { category: 'TRANSPORT', label: { en: 'Public transport', ru: 'Транспорт', kk: 'Көлік' }, outage: { en: 'Transport issue', ru: 'Проблема с транспортом', kk: 'Көлік мәселесі' }, buildingLevel: false },
  other: { category: 'OTHER', label: { en: 'Other', ru: 'Другое', kk: 'Басқа' }, outage: { en: 'City issue', ru: 'Городская проблема', kk: 'Қала мәселесі' }, buildingLevel: false },
}

export const CHANNELS = ['PHONE', 'WHATSAPP', 'INSTAGRAM', 'KOMEK109', 'APP'] as const
export type Channel = (typeof CHANNELS)[number]

export type RiskLevel = 'none' | 'elevated' | 'imminent'
/** Who the report says is affected. 'household' = "only us / in my flat": nobody else, until someone else says so; 'single' = not said. */
export type Scope = 'household' | 'single' | 'building' | 'multiple' | 'area'
export type StartHint = 'now' | 'this_morning' | 'last_night' | 'yesterday_evening' | 'yesterday' | 'hours_ago' | 'days_ago' | 'clock' | null

export type Intake = {
  lang: Lang
  service: IncidentService
  service_confidence: number
  kind: 'outage' | 'damage' | 'hazard' | 'complaint'
  designator: string | null
  house: string | null
  near_house: boolean
  entrance: string | null
  location_text: string | null
  started_text: string | null
  started_hint: StartHint
  started_at: string | null
  scope: Scope
  scope_text: string | null
  risk: RiskLevel
  risk_flags: string[]
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'
  missing: string[]
  confidence: number
  /** Exact fragments of the input each field came from — grounding for the UI. */
  spans: Array<{ field: string; text: string }>
}

// Cyrillic-aware word boundaries (JS \b is ASCII-only).
const W = 'а-яёәғқңөұүһіa-z0-9'
const B = `(?<![${W}])`
const E = `(?![${W}])`

const SERVICE_RULES: Array<[IncidentService, RegExp, number]> = [
  // Specific first: a dark yard is streetlight, not electricity; hot water is not water.
  ['streetlight', new RegExp(`фонар|освещени|${B}темн[${W}]* (?:во )?двор|двор[${W}]* темн|уличн[${W}]* свет|көше жарығ|${B}шам(?:дар|ы|дары|дарды)?${E}|жарықтандыр|street ?light|lamp ?post|${B}fonar`, 'g'), 3],
  ['gas', new RegExp(`запах газа|пахнет газ|газ иіс|утечк[${W}]* газ|gas (?:smell|leak)|${B}газ(?:а|ом)?(?![${W}])|${B}gas${E}`, 'g'), 3],
  ['building_safety', new RegExp(`кондиционер|фасад|балкон|обруш|трещин[${W}]* (?:в|на) (?:стен|дом)|кровл|крыш(?!к)|сосульк|аварийн[${W}]* дом|облицовк|плитк[${W}]* (?:пада|отва)|қасбет|кондиционер|facade|balcony|air ?conditioner`, 'g'), 3],
  ['hot_water', new RegExp(`горяч[${W}]* вод|${B}гвс${E}|ыстық су|hot water|goryach[a-z]* vod|${B}gvs${E}`, 'g'), 3],
  ['sewer', new RegExp(`канализ|засор|${B}сток|затопил[${W}]* подвал|подвал[${W}]* (?:затоп|вод)|(?:теч[её]т|льется|идет) в подвал|жертөле|${B}люк|${B}колод[ец]|кәріз|sewage|sewer|manhole|kanaliz|zatopil[a-z]* podval|podval[a-z]* (?:zatop|vod)`, 'g'), 3],
  ['elevator', new RegExp(`${B}лифт|${B}lift${E}|elevator`, 'g'), 3],
  ['heating', new RegExp(`отоплен|батаре|радиатор|холодно в (?:квартир|дом)|${B}жылу${E}|жылыту|heating|radiator|otoplen|batare`, 'g'), 2],
  ['water', new RegExp(`${B}вод(?:а|ы|у|е|ой|ою)?(?![${W}])|водоснабж|водопровод|кран|напор|${B}теч(?:ь|[её]т)|протеч|прорыв[${W}]* труб|труб[${W}]* прорв|прорвал[${W}]* труб|лопнул[${W}]* труб|труб[${W}]* лопнул|құбыр|${B}су(?:ы|ды|сыз)?(?![${W}])|${B}water${E}|water leak|${B}vod[auy]${E}|${B}vody${E}`, 'g'), 2],
  ['electricity', new RegExp(`${B}свет[ау]?(?![${W}])|электр|розетк|${B}провод|${B}жарық(?:ты|тың|сыз|қа|та)?(?![${W}])|қуат|${B}сым(?:дар)?${E}|power|electricity|${B}svet[au]?${E}|elektr|${B}wires?${E}`, 'g'), 2],
  ['garbage', new RegExp(`мусор|свалк|контейнер|отход|қоқыс|garbage|trash|rubbish|waste|${B}bins?${E}|overflowing|${B}musor`, 'g'), 2],
  ['road', new RegExp(`${B}ям[ауы]?(?![${W}])|выбоин|асфальт|дорог|лежач[${W}]* полицейск|бордюр|${B}жол(?:да|дың|ы)?(?![${W}])|шұңқыр|pothole|${B}road|speed bump`, 'g'), 2],
  ['yard', new RegExp(`детск[${W}]* площадк|качел|дерев|газон|скамейк|ойын алаң|балалар алаң|ағаш құла|playground|${B}tree`, 'g'), 1],
  ['transport', new RegExp(`автобус|маршрут|остановк|аялдама|${B}bus${E}`, 'g'), 1],
]

/**
 * Misspelled key words ("фноарь", "жраық", "элеткро", "доорга"): one swapped or wrong
 * letter in the stem of a word the rules know. Used only when no rule matched.
 */
const FUZZY_STEMS: Array<[string, IncidentService]> = [
  ['фонар', 'streetlight'], ['освещ', 'streetlight'], ['мусор', 'garbage'], ['контейн', 'garbage'], ['қоқыс', 'garbage'], ['асфальт', 'road'],
  ['дорог', 'road'], ['выбоин', 'road'], ['канализ', 'sewer'], ['электр', 'electricity'], ['жарық', 'electricity'], ['горяч', 'hot_water'],
  ['отоплен', 'heating'], ['батаре', 'heating'], ['водопровод', 'water'], ['кондиционер', 'building_safety'], ['автобус', 'transport'],
  ['electric', 'electricity'], ['heating', 'heating'], ['garbage', 'garbage'], ['elevator', 'elevator'], ['sewage', 'sewer'],
]
function nearStem(word: string, stem: string): boolean {
  const w = word.slice(0, stem.length)
  if (w.length !== stem.length || w === stem) return w === stem
  const diff: number[] = []
  for (let i = 0; i < w.length && diff.length < 3; i++) if (w[i] !== stem[i]) diff.push(i)
  if (diff.length === 1) return diff[0]! > 0
  return diff.length === 2 && diff[1] === diff[0]! + 1 && w[diff[0]!] === stem[diff[1]!] && w[diff[1]!] === stem[diff[0]!]
}
export function fuzzyService(t: string): { service: IncidentService; word: string } | null {
  const words = t.split(/[^a-zа-яёәғқңөұүһі]+/)
  for (const word of words) {
    if (word.length < 5) continue
    for (const [stem, service] of FUZZY_STEMS) if (nearStem(word, stem)) return { service, word }
  }
  // "затпоило подвал": a flooded basement, the verb misspelt, is the building's sewer.
  const flooded = words.find((w) => w.length >= 7 && nearStem(w, 'затопил'))
  if (flooded && words.some((w) => w.startsWith('подвал'))) return { service: 'sewer', word: flooded }
  return null
}

const RISK_RULES: Array<[string, RegExp, RiskLevel]> = [
  ['fall_hazard', new RegExp(`${B}висит|свиса|может (?:упасть|сорваться|рухнуть)|пада[ею]т|обруш|құла|hanging|may fall|falling`), 'imminent'],
  ['electrical_hazard', new RegExp(`искр(?:ит|ят|ение|ил[аио]?)|оголен[${W}]* провод|оборван[${W}]* провод|провод[${W}]* (?:висит|лежит|оборван)|бьет током|ток бь|сым(?:дар)? (?:жерде|үзіл)|ұшқын|sparking|live wire`), 'imminent'],
  // A gas leak is as urgent as a smell of gas.
  ['gas_smell', new RegExp(`запах газа|пахнет газ|газ иіс|утечк[${W}]* газ|газ ағ|gas smell|smell of gas|gas leak`), 'imminent'],
  ['open_manhole', new RegExp(`открыт[${W}]* (?:канализационн[${W}]* )?(?:люк|колод)|(?:люк|колод)[${W}]* (?:открыт|без крышки)|без крышки|нет крышки|крышк[${W}]* нет|ашық люк|қақпағы жоқ|қақпақсыз|open manhole|manhole (?:is )?open|missing manhole cover`), 'imminent'],
  ['flooding', new RegExp(`затопил|затаплива|заливает|потоп|${B}течет с потолка|су басты|flood`), 'elevated'],
  ['children', new RegExp(`${B}дет(?:и|ей|ям|ск)|${B}ребен|балалар|${B}бала${E}|children|${B}kids`), 'elevated'],
  ['vulnerable', new RegExp(`пожил|инвалид|лежач[${W}]* больн|${B}больн|қарт|мүгедек|elderly|disabled`), 'elevated'],
  ['cold', new RegExp(`${B}холодно${E}|мерзн|замерза|суық|тоңып|freezing`), 'elevated'],
]

const MONTHS_RU = ['январ', 'феврал', 'март', 'апрел', 'ма[йя]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр']

export function detectLang(text: string): Lang {
  const t = text.toLowerCase()
  if (/[әғқңөұүһі]/.test(t) || new RegExp(`${B}(?:жоқ|үй(?:де|ге|і)?|ш\\/а|бар ма|қашан|неге)${E}`).test(t)) return 'kk'
  const cyr = (t.match(/[а-яё]/g) ?? []).length
  const lat = (t.match(/[a-z]/g) ?? []).length
  return lat > cyr ? 'en' : 'ru'
}

function fold(s: string) {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[‐-―−]/g, '-').replace(/ /g, ' ')
}

const DESIGNATOR_WORDS = `(?:мкр\\.?|мкрн\\.?|микрорайон[${W}]*|м-н|ш\\/а|ш\\.а\\.?|шағын\\s*аудан[${W}]*|шагын\\s*аудан[${W}]*|mkr\\.?|microdistrict)`

function findPlace(t: string): { designator: string | null; house: string | null; near: boolean; entrance: string | null; spans: Intake['spans']; text: string | null } {
  const spans: Intake['spans'] = []
  let designator: string | null = null
  let house: string | null = null
  let near = false
  let tail = ''
  const pre = new RegExp(`${B}(\\d{1,2}\\s?[абвгa-d]?)(?:-?(?:й|ый|ой|ші|шы|ыншы|інші))?\\s*${DESIGNATOR_WORDS}`).exec(t)
  const post = new RegExp(`${DESIGNATOR_WORDS}\\s*№?\\s*(\\d{1,2}\\s?[абвгa-d]?)(?![${W}])`).exec(t)
  const named = new RegExp(`${B}(самал|samal|шыгыс[\\s-]*\\d|шығыс[\\s-]*\\d|shygys[\\s-]*\\d|толкын[\\s-]*\\d?|толқын[\\s-]*\\d?)`).exec(t)
  // "Шыгыс-3 мкр" is Shygys-3, not microdistrict 3: a named district wins over a number inside its own name.
  const inNamed = (m: RegExpExecArray | null) => !!m && !!named && m.index >= named.index && m.index < named.index + named[0].length
  const hit = inNamed(pre) || inNamed(post) ? null : pre ?? post
  if (hit?.[1]) {
    designator = hit[1].replace(/\s+/g, '').toUpperCase().replace(/[ABCD]/g, (c) => ({ A: 'А', B: 'Б', C: 'В', D: 'Г' })[c] ?? c)
    spans.push({ field: 'designator', text: hit[0].trim() })
    tail = t.slice(hit.index + hit[0].length)
  } else if (named?.[1]) {
    const n = named[1].replace(/\s+/g, '')
    designator = /самал|samal/.test(n) ? 'САМАЛ' : /толк|толқ/.test(n) ? `ТОЛКЫН-${n.match(/\d/)?.[0] ?? '1'}` : `ШЫГЫС-${n.match(/\d/)?.[0]}`
    spans.push({ field: 'designator', text: named[0].trim() })
    tail = t.slice(named.index + named[0].length)
  }
  // A house: "24", "24Д", "21к", "7 к1", "38 В," ("д.38 в кране" is "in the tap", not 38В), "14/2", "31/1б", "39 / 40".
  const L = `[абвгдежкa-fk]\\d?`
  const LETTER = `(?:${L}|\\s${L}(?=\\s*(?:[,.;:!?)]|$)))`
  const SLASH = `(?:\\s?\\/\\s?\\d{1,3}(?:${L})?)?`
  const HOUSE = `\\d{1,3}${LETTER}?${SLASH}`
  const houseRe = [
    new RegExp(`(возле|около|рядом с|напротив|${B}у|near|vozle|okolo|жанында|қасында)?\\s*(?:дом[${W}]*|д\\.|${B}[дd](?=\\s*№?\\s*\\d)|house|${B}dom[a-z]?)\\s*№?\\s*(${HOUSE})(?![${W}])`),
    new RegExp(`${B}(${HOUSE})(?:-?(?:й|ый|ой|ші|шы))?\\s*(?:дом[${W}]*|үй(?:де|дің|і|ге)?)(?![${W}])`),
  ]
  const hm1 = houseRe[0]!.exec(t)
  const hm2 = hm1 ? null : houseRe[1]!.exec(t)
  if (hm1?.[2]) { house = hm1[2]; near = !!hm1[1]; spans.push({ field: 'house', text: hm1[0].trim() }) }
  else if (hm2?.[1] && hm2[1] !== designator?.toLowerCase()) { house = hm2[1]; spans.push({ field: 'house', text: hm2[0].trim() }) }
  else if (designator) {
    // "14 мкр, 21" / "14 мкр 21" — a bare number right after the district.
    // Not "14 мкр, 5 дней нет воды": a number of days or hours is not a house.
    const bare = new RegExp(`^\\s*[,.]?\\s*№?\\s*(${HOUSE})(?![\\d:${W}]|\\.\\d|\\s*(?:дн|ден|сут|час|мин|недел|сағ|күн|апта|hour|day|min|week))`).exec(tail)
    if (bare?.[1]) { house = bare[1]; spans.push({ field: 'house', text: bare[0].trim() }) }
  }
  if (!designator) {
    // Operator shorthand: "14-21", "14/21 heating".
    const short = new RegExp(`^\\s*(\\d{1,2}[абвг]?)\\s*[-/]\\s*(\\d{1,3}[абвг]?)(?![\\d:.])`).exec(t)
    if (short) { designator = short[1]!.toUpperCase(); house = short[2]!; spans.push({ field: 'designator', text: short[0].trim() }) }
  }
  // Outside the building: "N үй жанында", "во дворе", "на улице", "из-под асфальта".
  if (house && !near && new RegExp(`${B}${HOUSE}\\s*үй(?:дің)?\\s*(?:жанында|қасында)|на улице|во дворе|из-под (?:асфальта|земли)|(?:по|на|посреди) дорог|көшеде|аулада|on the street|in the yard|outside`).test(t)) near = true
  const ent = new RegExp(`(?:подъезд[${W}]*\\s*№?\\s*(\\d{1,2})|(\\d{1,2})[-\\s]?(?:й|ый|ой)?\\s*подъезд|(\\d{1,2})[-\\s]?(?:ші|шы)?\\s*кіреберіс)`).exec(t)
  if (house) house = house.replace(/\s+/g, '').toUpperCase().replace(/[ABCD]/g, (c) => ({ A: 'А', B: 'Б', C: 'В', D: 'Г' })[c] ?? c)
  const text = designator ? `${designator} mkr${house ? `, ${near ? 'near ' : ''}house ${house}` : ''}` : null
  return { designator, house, near, entrance: ent ? (ent[1] ?? ent[2] ?? ent[3] ?? null) : null, spans, text }
}

function localHM(d: Date): { h: number; m: number; y: number; mo: number; day: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Aqtau', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]))
  return { h: Number(p.hour) % 24, m: Number(p.minute), y: Number(p.year), mo: Number(p.month), day: Number(p.day) }
}
/** Aqtau is UTC+5 all year (no DST since 2024 unification). */
function aqtau(y: number, mo: number, day: number, h: number, m = 0) {
  return new Date(Date.UTC(y, mo - 1, day, h - 5, m))
}

function findStart(t: string, now: Date): { hint: StartHint; at: Date | null; text: string | null } {
  const l = localHM(now)
  const today = (h: number, m = 0) => aqtau(l.y, l.mo, l.day, h, m)
  const yesterday = (h: number) => new Date(today(h).getTime() - 86400_000)
  const rules: Array<[RegExp, (m: RegExpExecArray) => { hint: StartHint; at: Date | null }]> = [
    [/(?:со?|since)\s*(?:вчерашнего\s*вечера|вчера\s*вечер[а-я]*)|вчера вечером|кеше кешке?|кешкі|last evening|yesterday evening/, () => ({ hint: 'yesterday_evening', at: yesterday(20) })],
    [/(?:с|since)\s*(\d{1,2})[:.](\d{2})|сағат\s*(\d{1,2})[:.]?(\d{2})?-?(?:дан|ден|тан|тен)/, (m) => ({ hint: 'clock', at: today(Number(m[1] ?? m[3]), Number(m[2] ?? m[4] ?? 0)) })],
    [/с\s*(\d{1,2})\s*(?:утра|часов утра)/, (m) => ({ hint: 'clock', at: today(Number(m[1])) })],
    [/(?:уже|already)?\s*(\d{1,2})\s*(?:час[а-я]*|сағат|hours?)(?:\s*(?:нет|как|бойы))?/, (m) => ({ hint: 'hours_ago', at: new Date(now.getTime() - Number(m[1]) * 3600_000) })],
    [/(\d{1,2})\s*(?:дн[яей]+|сут(?:ок|ки)|күн|days?)/, (m) => ({ hint: 'days_ago', at: new Date(now.getTime() - Number(m[1]) * 86400_000) })],
    [/(?:с|со)\s*утра|утром|с самого утра|таңертең(?:нен)?|таңнан|since (?:this )?morning|this morning/, () => ({ hint: 'this_morning', at: today(8) })],
    [/(?:с|со)\s*ночи|ночью|түнде|түннен|overnight|last night/, () => ({ hint: 'last_night', at: today(2) })],
    [/(?:со?)\s*вчера|вчера|кешеден|кеше|since yesterday|yesterday/, () => ({ hint: 'yesterday', at: yesterday(12) })],
    [/неделю|week/, () => ({ hint: 'days_ago', at: new Date(now.getTime() - 7 * 86400_000) })],
    [/сейчас|только что|прямо сейчас|қазір|just now|right now/, () => ({ hint: 'now', at: now })],
  ]
  for (const [re, f] of rules) {
    const m = re.exec(t)
    if (m) {
      const r = f(m)
      if (r.at && r.at > now) r.at = new Date(r.at.getTime() - 86400_000)
      return { ...r, text: m[0].trim() }
    }
  }
  const md = new RegExp(`(\\d{1,2})\\s*(${MONTHS_RU.join('|')})`).exec(t)
  if (md) return { hint: 'days_ago', at: null, text: md[0] }
  return { hint: null, at: null, text: null }
}

// "Нет" alone is any negation ("толку нет", "нет крышки"): it means an outage only next to what is missing.
const MISSING = `(?:вод|свет|электр|газ|отоплен|тепл|горяч|гвс|напор|лифт|интернет)`
const OUTAGE = new RegExp(`${B}нету?\\s+(?:[${W}]+\\s+){0,2}${MISSING}|${MISSING}[${W}]*\\s+(?:[${W}]+\\s+)?(?:тоже\\s+)?нету?(?![${W}])|${B}без (?:воды|света|электр|газа|отоплен|горяч|тепла|лифта)|отключ|пропал|не работа|не гор|не гор[ия]т|нету|не ид[её]т|не поступа|отсутству|${B}дадут|${B}net${E}|otklyuch|propal|${B}жоқ${E}|сөнді|өшір|істемейді|жанбайды|берілмей|ақпайды|no (?:water|power|light|heat)|${B}out${E}|is off|not working`)
const DAMAGE = new RegExp(`${B}ям|выбоин|сломан|разбит|поврежд|трещин|${B}теч[её]т|${B}течь|протек|протечк|прорыв|прорвал|лопнул|фонтан|хлещ|затаплива|бұзыл|сынған|ағып|жарыл|broken|damaged|pothole|leak|burst`)

/** Structured intake of one resident message (RU / KK / EN, voice transcript or text). */
export function intake(raw: string, now: Date = new Date()): Intake {
  const t = fold(raw)
  const lang = detectLang(raw)
  const spans: Intake['spans'] = []
  // Service: weighted rule hits; the first (most specific) rule wins ties.
  let best: { s: IncidentService; score: number; text: string } = { s: 'other', score: 0, text: '' }
  let total = 0
  for (const [s, re, w] of SERVICE_RULES) {
    const hits = [...t.matchAll(re)]
    if (!hits.length) continue
    const score = hits.length * w
    total += score
    if (score > best.score) best = { s, score, text: hits[0]![0] }
  }
  // Nothing matched: a misspelled key word still says what it is (with less confidence).
  const fuzzy = best.score ? null : fuzzyService(t)
  if (fuzzy) best = { s: fuzzy.service, score: 1, text: fuzzy.word }
  if (best.text) spans.push({ field: 'service', text: best.text.trim() })
  const service_confidence = fuzzy ? 0.5 : best.score ? Math.min(0.99, 0.62 + (best.score / Math.max(total, 1)) * 0.36) : 0.3

  const place = findPlace(t)
  spans.push(...place.spans)
  const start = findStart(t, now)
  if (start.text) spans.push({ field: 'started', text: start.text })

  const scopeRules: Array<[Scope, RegExp]> = [
    ['area', new RegExp(`(?:весь|всему|во всем|по всему|целый)\\s*(?:микрорайон|мкр|район)|бүкіл шағын|бүкіл аудан|whole (?:district|area)`)],
    ['multiple', new RegExp(`сосед|у всех|несколько дом|другие дом|соседни[хе] дом|көршілер|барлығында|neighbou?rs|everyone`)],
    // The whole building (a riser, the building's inlet): for a sewer it is still the building's own system.
    ['building', new RegExp(`весь дом|во всем доме|всем домом|весь подъезд|во всем подъезде|бүкіл үй|whole building|entire building`)],
    ['household', new RegExp(`только у (?:нас|меня)|у (?:нас|меня) одн|в (?:моей |нашей |своей )?квартире|пәтер(?:де|імде|імізде)|(?:бізде|менде) ғана|тек (?:бізде|менде)|only (?:us|me|at ours|in (?:my|our))|in (?:my|our) (?:flat|apartment)`)],
  ]
  let scope: Scope = 'single'
  let scope_text: string | null = null
  for (const [s, re] of scopeRules) { const m = re.exec(t); if (m) { scope = s; scope_text = m[0]; spans.push({ field: 'scope', text: m[0] }); break } }
  if (scope === 'single' && ['streetlight', 'road', 'garbage', 'yard', 'transport'].includes(best.s)) scope = 'area'

  const risk_flags: string[] = []
  let risk: RiskLevel = 'none'
  for (const [flag, re, level] of RISK_RULES) {
    const m = re.exec(t)
    if (!m) continue
    risk_flags.push(flag)
    spans.push({ field: `risk:${flag}`, text: m[0] })
    if (level === 'imminent' || (level === 'elevated' && risk === 'none')) risk = level
  }
  if (best.s === 'gas' && !risk_flags.includes('gas_smell') && /запах|пахн|иіс|smell/.test(t)) { risk_flags.push('gas_smell'); risk = 'imminent' }
  const longOutage = start.at ? now.getTime() - start.at.getTime() > 12 * 3600_000 : false
  if (longOutage && risk === 'none' && ['water', 'heating', 'electricity', 'hot_water'].includes(best.s)) { risk = 'elevated'; risk_flags.push('long_outage') }

  const kind: Intake['kind'] = risk === 'imminent' ? 'hazard' : OUTAGE.test(t) ? 'outage' : DAMAGE.test(t) ? 'damage' : 'complaint'
  const priority: Intake['priority'] = risk === 'imminent' ? 'CRITICAL'
    : risk === 'elevated' || (scope !== 'single' && scope !== 'household' && ['water', 'heating', 'electricity'].includes(best.s)) ? 'HIGH'
    : ['yard', 'transport', 'other'].includes(best.s) ? 'LOW' : 'NORMAL'

  const missing: string[] = []
  if (best.s === 'other') missing.push('service')
  if (!place.designator) missing.push('address')
  else if (!place.house && SERVICE_META[best.s].buildingLevel) missing.push('house')
  if (!start.text && kind === 'outage') missing.push('start_time')
  if (scope === 'single' && kind === 'outage' && ['water', 'electricity', 'heating', 'hot_water'].includes(best.s)) missing.push('neighbours')

  const confidence = Math.min(0.99, Number((
    0.28 + (best.score ? 0.3 * service_confidence : 0) + (place.designator ? 0.22 : 0) + (place.house ? 0.08 : 0) + (start.text ? 0.07 : 0) + (scope !== 'single' ? 0.04 : 0)
  ).toFixed(2)))

  return {
    lang, service: best.s, service_confidence: Number(service_confidence.toFixed(2)), kind,
    designator: place.designator, house: place.house, near_house: place.near, entrance: place.entrance, location_text: place.text,
    started_text: start.text, started_hint: start.hint, started_at: start.at?.toISOString() ?? null,
    scope, scope_text, risk, risk_flags, priority, missing, confidence, spans,
  }
}

export function incidentTitle(service: IncidentService, lang: Lang, kind: Intake['kind'] | null = 'outage', flags: string[] = []): string {
  const m = SERVICE_META[service]
  if (flags.includes('open_manhole')) return { en: 'Open manhole', ru: 'Открытый люк', kk: 'Ашық люк' }[lang]
  if (kind === 'damage' && m.damage) return m.damage[lang]
  return kind === 'outage' || kind === 'hazard' || !kind ? m.outage[lang] : m.label[lang]
}

// ── Matching ────────────────────────────────────────────────────────────────
export type OpenIncident = {
  id: string
  code: string
  service: IncidentService
  status: string
  area_id: string | null
  designator: string | null
  house: string | null
  last_signal_at: string
  first_signal_at: string
  signal_count: number
  confirm_count?: number
  /** Incident point, when it is known to building (or GPS) precision. */
  lat?: number | null
  lon?: number | null
  precise?: boolean
  kind?: Intake['kind'] | null
  /** Content words of the first report (never shown; used for similarity only). */
  words?: string[]
  /** Demo session the incident belongs to (null = the city). */
  session_id?: string | null
  /**
   * Metres from the new report to the incident's footprint: its own point or any
   * building already in its scope (set by the caller when the report is precise).
   * An outage spreads house by house; its first report is only where it started.
   */
  near_m?: number | null
}

export type MatchInput = {
  service: IncidentService; designator: string | null; house: string | null; area_id: string | null; at: Date
  lat?: number | null; lon?: number | null; precise?: boolean; kind?: Intake['kind'] | null; words?: string[]; session_id?: string | null
}

const RELATED: Array<[IncidentService, IncidentService]> = [['water', 'hot_water'], ['heating', 'hot_water'], ['sewer', 'water']]
const CLOSED = new Set(['RESOLVED', 'VERIFIED', 'REJECTED'])
/** Problems you can point at: two of them far enough apart are two problems, even in one microdistrict. */
const LOCAL_SERVICES = new Set<IncidentService>(['streetlight', 'garbage', 'road', 'yard', 'sewer', 'building_safety', 'elevator', 'gas', 'transport', 'other'])
/**
 * How far apart (m) two reports of a problem you can point at may be and still be one problem:
 * a yard's lamp line or one container site is a few hundred metres; a road or a bus route is longer.
 * (A pilot simulation of 10 000 reports showed two container sites 400 m apart merging at 700 m.)
 */
const FAR_M: Partial<Record<IncidentService, number>> = { streetlight: 350, garbage: 350, yard: 350, sewer: 350, building_safety: 350, elevator: 350, gas: 300, other: 400, road: 600, transport: 800 }
/** Network outages: a neighbouring microdistrict joins only when it touches the outage's houses, not just its map border. */
const NETWORK_SERVICES = new Set<IncidentService>(['water', 'hot_water', 'electricity', 'heating'])

const STOP = new Set(['возле', 'около', 'рядом', 'микрорайон', 'микрорайоне', 'дом', 'дома', 'доме', 'очень', 'уже', 'тоже', 'сейчас', 'сегодня', 'жанында', 'шағын', 'аудан', 'house', 'near', 'there', 'with', 'since', 'still'])
/** Content words cut to a 5-letter stem ("фонари" ≈ "фонарь", "контейнеры" ≈ "контейнер"): crude, cheap, and only ever a small bonus. */
export function contentWords(text: string): string[] {
  const out = new Set<string>()
  for (const w of normaliseReport(text).split(' ')) {
    if (w.length < 4 || /\d/.test(w) || STOP.has(w)) continue
    out.add(w.slice(0, 5))
  }
  return [...out].slice(0, 40)
}

export function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371000, r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * How likely a new signal describes an existing incident. Returns 0..1 plus
 * the reasons, so the operator sees *why* ("same service · same area · overlapping time").
 * `adjacent` holds area ids within walking distance of the signal's area.
 * A city report never matches a demo-session incident, and the other way round.
 */
export function matchScore(s: MatchInput, inc: OpenIncident, adjacent: Set<string> = new Set()): { score: number; reasons: string[] } {
  if ((s.session_id ?? null) !== (inc.session_id ?? null)) return { score: 0, reasons: [] }
  const reasons: string[] = []
  let score = 0
  if (inc.service === s.service) { score += 0.5; reasons.push('same_service') }
  else if (RELATED.some(([a, b]) => (a === s.service && b === inc.service) || (b === s.service && a === inc.service))) { score += 0.25; reasons.push('related_service') }
  else if (s.session_id && inc.session_id) { score += 0.3; reasons.push('same_session') }
  else return { score: 0, reasons: [] }

  // Geographic proximity, only when both sides are building-precise: to the incident's footprint when known, else to its point.
  const d = s.precise && inc.near_m != null ? inc.near_m
    : s.precise && inc.precise && s.lat != null && s.lon != null && inc.lat != null && inc.lon != null ? metresBetween({ lat: s.lat, lon: s.lon }, { lat: inc.lat, lon: inc.lon }) : null

  const sameArea = !!s.area_id && s.area_id === inc.area_id
  if (sameArea && s.house && inc.house && s.house === inc.house) { score += 0.32; reasons.push('same_building') }
  else if (sameArea) { score += SERVICE_META[s.service].buildingLevel && s.house && inc.house ? 0.05 : 0.28; reasons.push('same_area') }
  else if (s.area_id && inc.area_id && adjacent.has(inc.area_id)) {
    // Over a microdistrict border: a network outage joins when it touches the outage's houses;
    // a problem you can point at only when both places are known and close.
    const far = NETWORK_SERVICES.has(s.service) ? d != null && d > 600 : LOCAL_SERVICES.has(s.service) && (d == null || d > (FAR_M[s.service] ?? 700))
    if (far) reasons.push('adjacent_far')
    else { score += 0.15; reasons.push('adjacent_area') }
  }
  else if (s.session_id) { score += 0.28; reasons.push('same_place') }
  else if (!s.area_id) { score += 0.04; reasons.push('location_unknown') }
  // Metres apart on either side of a border line is the same place.
  if (d != null && d <= 150 && s.area_id && inc.area_id && !sameArea && !reasons.includes('adjacent_area')) { score += 0.15; reasons.push('across_border') }

  if (d != null) {
    if (d <= 150 && !reasons.includes('same_building')) { score += 0.1; reasons.push('very_close') }
    else if (LOCAL_SERVICES.has(s.service) && d > (FAR_M[s.service] ?? 700)) { score -= 0.3; reasons.push('far_apart') }
    else if (NETWORK_SERVICES.has(s.service) && d > 1500) { score -= 0.3; reasons.push('far_apart') }
  }
  // A leak is not an outage, even at the same address: at most "possibly related", never a duplicate by itself.
  const outageSide = (k: Intake['kind'] | null | undefined) => k === 'outage' || (k === 'complaint' && NETWORK_SERVICES.has(s.service))
  const different = !!s.kind && !!inc.kind && s.kind !== inc.kind && (s.kind === 'damage' ? outageSide(inc.kind) : inc.kind === 'damage' && outageSide(s.kind))
  if (different) { score -= 0.25; reasons.push('different_problem') }
  // Semantic similarity: shared content words with the first report.
  if (s.words?.length && inc.words?.length) {
    const a = new Set(s.words), shared = inc.words.filter((w) => a.has(w)).length
    if (shared / Math.min(a.size, inc.words.length) >= 0.34) { score += 0.06; reasons.push('similar_wording') }
  }

  const age = s.at.getTime() - new Date(inc.last_signal_at).getTime()
  if (!CLOSED.has(inc.status) && age < 24 * 3600_000) { score += 0.17; reasons.push('overlapping_time') }
  // A pothole or a dark yard does not go away by itself: while its incident is open, a report weeks later is the same problem.
  else if (!CLOSED.has(inc.status) && LOCAL_SERVICES.has(s.service) && age < 30 * 86400_000) { score += 0.17; reasons.push('still_open') }
  else if (!CLOSED.has(inc.status) && age < 72 * 3600_000) { score += 0.08; reasons.push('recent') }
  if (CLOSED.has(inc.status)) score -= 0.2
  if (different) score = Math.min(score, 0.75)
  return { score: Math.max(0, Math.min(0.99, Number(score.toFixed(2)))), reasons }
}

export function bestMatches(s: MatchInput, incidents: OpenIncident[], adjacent?: Set<string>, limit = 3) {
  return incidents
    .map((inc) => ({ incident: inc, ...matchScore(s, inc, adjacent) }))
    .filter((m) => m.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export const MATCH_LIKELY = 0.8
export const MATCH_POSSIBLE = 0.6

// ── Responsibility graph ────────────────────────────────────────────────────
export type ChainLink = { level: 'object' | 'system' | 'balance_holder' | 'service_company' | 'contractor' | 'department' | 'escalation'; name: string; note?: string }
export type Route = { org: string; chain: ChainLink[]; confidence: number; note: string; needs_review: boolean; alternatives: string[] }

export const ORGS = {
  KZHSA: 'KZhSA · Kaspiy Zhylu Su Arnasy',
  MAEK: 'MAEK-Kazatomprom',
  AUES: 'AUES · city power networks',
  OSI: 'Building OSI / KSK',
  LIGHTING: 'Street lighting contractor',
  WASTE: 'Waste collection operator',
  ROADS: 'Dept. of Passenger Transport & Roads',
  HOUSING: 'Akimat · Housing & Utilities Dept.',
  GAS: 'QazaqGaz Aimaq · gas emergency 104',
  POLICE: 'Police · 102',
  DCHS: 'Emergency Dept. · 112',
  ELEVATOR: 'Elevator service company',
  PARKS: 'Akimat · Landscaping',
} as const

/**
 * Responsibility graph: service + scope + location type + risk → who actually
 * owns the problem. `history` (org → incidents of this service resolved here)
 * raises confidence when past routing worked.
 */
export function route(i: Pick<Intake, 'service' | 'scope' | 'risk' | 'risk_flags' | 'designator' | 'house'> & Partial<Pick<Intake, 'kind' | 'near_house'>>, history: Record<string, number> = {}): Route {
  const obj: ChainLink = { level: 'object', name: i.designator ? `${i.designator} mkr${i.house ? `, house ${i.house}` : ''}` : 'Location to confirm' }
  // A leak outside a house ("возле дома 37") is the street network, not the building's pipes; a whole building
  // without water or power is its supply (the network), while a whole building's blocked sewer is its own riser.
  const wide = i.scope === 'multiple' || i.scope === 'area' || (i.scope === 'building' && i.service !== 'sewer') || (i.kind === 'damage' && !!i.near_house)
  let r: Route
  switch (i.service) {
    case 'water':
    case 'sewer':
      r = wide || !i.house
        ? { org: ORGS.KZHSA, confidence: 0.86, note: i.kind === 'damage' && i.near_house ? 'A leak outside the building → the street network.' : wide ? 'Several residents affected → distribution network, not in-building pipes.' : 'No house given — assuming the district network.', needs_review: false, alternatives: [ORGS.OSI],
            chain: [obj, { level: 'system', name: i.service === 'sewer' ? 'Sewer network' : 'Cold water distribution network' }, { level: 'balance_holder', name: ORGS.KZHSA }, { level: 'service_company', name: `${ORGS.MAEK} (source & trunk mains)`, note: 'upstream if the whole district is dry' }, { level: 'department', name: ORGS.HOUSING }] }
        : { org: ORGS.OSI, confidence: 0.64, note: 'One apartment affected → likely in-building pipes. Ask whether neighbours have water.', needs_review: true, alternatives: [ORGS.KZHSA],
            chain: [obj, { level: 'system', name: 'In-building pipes' }, { level: 'balance_holder', name: 'Apartment owners (common property)' }, { level: 'service_company', name: ORGS.OSI }, { level: 'department', name: ORGS.HOUSING }] }
      break
    case 'hot_water':
    case 'heating':
      r = wide || !i.house
        ? { org: ORGS.KZHSA, confidence: 0.84, note: 'Heat network serves the whole block.', needs_review: false, alternatives: [ORGS.OSI],
            chain: [obj, { level: 'system', name: 'District heat network' }, { level: 'balance_holder', name: ORGS.KZHSA }, { level: 'service_company', name: `${ORGS.MAEK} (heat source)` }, { level: 'department', name: ORGS.HOUSING }] }
        : { org: ORGS.OSI, confidence: 0.66, note: 'Single building → internal heating system of the house.', needs_review: true, alternatives: [ORGS.KZHSA],
            chain: [obj, { level: 'system', name: 'Internal heating system' }, { level: 'balance_holder', name: 'Apartment owners (common property)' }, { level: 'service_company', name: ORGS.OSI }, { level: 'contractor', name: 'Current maintenance contractor', note: 'from the OSI contract register' }, { level: 'department', name: ORGS.HOUSING }] }
      break
    case 'electricity':
      // Wires and poles in the street belong to the grid.
      r = wide || !i.house || (!!i.near_house && i.risk_flags.includes('electrical_hazard'))
        ? { org: ORGS.AUES, confidence: 0.88, note: 'Several homes without power → distribution network / substation.', needs_review: false, alternatives: [ORGS.OSI],
            chain: [obj, { level: 'system', name: '0.4–10 kV distribution network' }, { level: 'balance_holder', name: ORGS.AUES }, { level: 'department', name: ORGS.HOUSING }] }
        : { org: ORGS.OSI, confidence: 0.6, note: 'Only one apartment → check the building switchboard first.', needs_review: true, alternatives: [ORGS.AUES],
            chain: [obj, { level: 'system', name: 'Building switchboard & risers' }, { level: 'service_company', name: ORGS.OSI }, { level: 'balance_holder', name: ORGS.AUES, note: 'if the input cable is dead' }] }
      break
    case 'streetlight':
      r = { org: ORGS.LIGHTING, confidence: 0.82, note: 'Outdoor lighting is municipal property maintained under contract.', needs_review: false, alternatives: [ORGS.OSI],
        chain: [obj, { level: 'system', name: 'Street & yard lighting' }, { level: 'balance_holder', name: 'Aktau Akimat' }, { level: 'contractor', name: ORGS.LIGHTING, note: 'per the current maintenance contract' }, { level: 'department', name: ORGS.HOUSING }] }
      break
    case 'garbage':
      r = { org: ORGS.WASTE, confidence: 0.85, note: 'Container sites are served on a fixed schedule.', needs_review: false, alternatives: [ORGS.OSI],
        chain: [obj, { level: 'system', name: 'Container site' }, { level: 'contractor', name: ORGS.WASTE }, { level: 'department', name: ORGS.HOUSING }] }
      break
    case 'road':
    case 'transport':
      r = { org: ORGS.ROADS, confidence: 0.83, note: i.service === 'road' ? 'Public road / inter-block driveway.' : 'Routes and stops are set by the department.', needs_review: false, alternatives: [ORGS.OSI],
        chain: [obj, { level: 'system', name: i.service === 'road' ? 'Road surface & traffic calming' : 'Public transport network' }, { level: 'balance_holder', name: 'Aktau Akimat' }, { level: 'department', name: ORGS.ROADS }] }
      break
    case 'elevator':
      r = { org: ORGS.ELEVATOR, confidence: 0.8, note: 'Elevators are common property serviced under the OSI contract.', needs_review: false, alternatives: [ORGS.OSI],
        chain: [obj, { level: 'system', name: 'Elevator' }, { level: 'balance_holder', name: 'Apartment owners (common property)' }, { level: 'service_company', name: ORGS.OSI }, { level: 'contractor', name: ORGS.ELEVATOR }] }
      break
    case 'gas':
      r = { org: ORGS.GAS, confidence: 0.95, note: 'Any smell of gas goes straight to the gas emergency service.', needs_review: false, alternatives: [ORGS.DCHS],
        chain: [obj, { level: 'system', name: 'Gas distribution' }, { level: 'service_company', name: ORGS.GAS }, { level: 'escalation', name: ORGS.DCHS }] }
      break
    case 'building_safety':
      r = { org: ORGS.OSI, confidence: 0.55, note: 'Private / common property on a facade — ownership is often disputed. Safety first.', needs_review: true, alternatives: [ORGS.POLICE, ORGS.HOUSING],
        chain: [obj, { level: 'system', name: 'Facade & external units' }, { level: 'balance_holder', name: 'Owner of the unit / apartment owners' }, { level: 'service_company', name: ORGS.OSI }, ...(i.risk === 'imminent' ? [{ level: 'escalation' as const, name: ORGS.POLICE, note: 'imminent danger to passers-by' }] : []), { level: 'department', name: ORGS.HOUSING }] }
      break
    case 'yard':
      r = { org: ORGS.PARKS, confidence: 0.62, note: 'Yard territory can belong to the city or to the OSI — check the land plot.', needs_review: true, alternatives: [ORGS.OSI],
        chain: [obj, { level: 'system', name: 'Yard / public green space' }, { level: 'balance_holder', name: 'Aktau Akimat or OSI' }, { level: 'department', name: ORGS.PARKS }] }
      break
    default:
      r = { org: ORGS.HOUSING, confidence: 0.4, note: 'Service unclear — operator to classify.', needs_review: true, alternatives: [],
        chain: [obj, { level: 'department', name: ORGS.HOUSING }] }
  }
  if (i.risk === 'imminent' && i.service !== 'gas' && i.service !== 'building_safety') {
    r.chain.push({ level: 'escalation', name: ORGS.DCHS, note: 'imminent danger' })
    r.needs_review = true
  }
  const past = history[r.org] ?? 0
  if (past > 0) {
    r.confidence = Math.min(0.97, r.confidence + Math.min(0.1, past * 0.02))
    r.note += ` ${past} similar incident${past === 1 ? '' : 's'} here were resolved by this organisation.`
  }
  r.confidence = Number(r.confidence.toFixed(2))
  return r
}

// ── SLA guardian ────────────────────────────────────────────────────────────
/** Acceptance window from the 109 regulation; resolution targets are internal and configurable. */
export const ACCEPT_MINUTES = 120
export const RESOLVE_HOURS: Record<Intake['priority'], number> = { CRITICAL: 4, HIGH: 24, NORMAL: 72, LOW: 168 }

export type SlaInput = {
  status: string
  priority: Intake['priority']
  routed_at: string | null
  accepted_at: string | null
  accept_due_at: string | null
  resolve_due_at: string | null
  returned_count: number
  evidence_count: number
  signal_count: number
  signals_last_hour?: number
  executor_rework_rate?: number
  /** The finish the responsible team committed to: once set, it is the deadline that counts. */
  commit_finish_at?: string | null
}
export type SlaState = { level: 'ok' | 'watch' | 'at_risk' | 'breached' | 'done'; minutes_left: number | null; deadline: string | null; reasons: string[] }

export function slaState(i: SlaInput, now = new Date()): SlaState {
  if (['RESOLVED', 'VERIFIED', 'REJECTED'].includes(i.status)) return { level: 'done', minutes_left: null, deadline: null, reasons: [] }
  // Completion reported: the team's clock stops; the residents' check is next.
  if (i.status === 'EVIDENCE_SUBMITTED') return { level: 'ok', minutes_left: null, deadline: null, reasons: ['awaiting_verification'] }
  const reasons: string[] = []
  const acceptPhase = !!i.routed_at && !i.accepted_at && i.status === 'ROUTED'
  const committed = !acceptPhase && !!i.commit_finish_at
  const deadline = acceptPhase ? i.accept_due_at : committed ? i.commit_finish_at! : i.resolve_due_at
  const minutes_left = deadline ? Math.round((new Date(deadline).getTime() - now.getTime()) / 60000) : null
  let level: SlaState['level'] = 'ok'
  const bump = (l: SlaState['level']) => { const order = ['ok', 'watch', 'at_risk', 'breached']; if (order.indexOf(l) > order.indexOf(level)) level = l }
  if (i.status === 'NEW') { reasons.push('awaiting_operator'); bump('watch') }
  if (minutes_left != null) {
    const windowMin = acceptPhase ? ACCEPT_MINUTES
      : committed && i.accepted_at ? Math.max(5, (new Date(i.commit_finish_at!).getTime() - new Date(i.accepted_at).getTime()) / 60000)
      : RESOLVE_HOURS[i.priority] * 60
    if (minutes_left < 0) { bump('breached'); reasons.push(acceptPhase ? 'accept_overdue' : committed ? 'commitment_overdue' : 'resolve_overdue') }
    else if (minutes_left < windowMin * 0.25) { bump('at_risk'); reasons.push('deadline_near') }
    else if (minutes_left < windowMin * 0.5) bump('watch')
  }
  if (acceptPhase && i.routed_at && now.getTime() - new Date(i.routed_at).getTime() > ACCEPT_MINUTES * 0.6 * 60000) { reasons.push('not_accepted'); bump('at_risk') }
  if (i.returned_count > 0) { reasons.push('returned_before'); bump('watch') }
  if (i.status === 'IN_PROGRESS' && i.evidence_count === 0 && minutes_left != null && minutes_left < RESOLVE_HOURS[i.priority] * 60 * 0.3) { reasons.push('missing_evidence'); bump('at_risk') }
  if ((i.executor_rework_rate ?? 0) > 0.2) { reasons.push('executor_rework_rate'); bump('watch') }
  if ((i.signals_last_hour ?? 0) >= 5) { reasons.push('signals_growing'); bump('watch') }
  if (i.status === 'DISPUTED') { reasons.push('disputed_by_residents'); bump('at_risk') }
  return { level, minutes_left, deadline, reasons }
}

// ── Response quality (regulation: motivated, concrete, answers the complaint, same language, appeal right) ──
export type Check = { key: string; ok: boolean }
export type QualityResult = { score: number; verdict: 'good' | 'needs_work' | 'insufficient'; checks: Check[] }

const SERVICE_WORDS: Record<IncidentService, RegExp> = {
  water: /вод|водопровод|су|water|pipe|труб/, hot_water: /горяч|гвс|ыстық|hot/, electricity: /свет|электр|кабел|трансформ|жарық|power|cable/,
  heating: /отоплен|батаре|тепл|жылу|heating/, gas: /газ|gas/, streetlight: /фонар|освещ|светильник|ламп|жарық|шам|light|lamp/,
  garbage: /мусор|контейнер|вывез|қоқыс|waste|garbage/, road: /дорог|ям|асфальт|покрыт|жол|road|asphalt/, sewer: /канализ|засор|кәріз|sewer/,
  elevator: /лифт|lift|elevator/, building_safety: /кондиционер|фасад|демонт|блок|қасбет|facade|unit/, yard: /двор|площадк|дерев|аула|yard/,
  transport: /автобус|маршрут|остановк|bus/, other: /./,
}

export function checkResponse(text: string, ctx: { lang: Lang; service: IncidentService; designator?: string | null; hasEvidence: boolean; needsEvidence: boolean }): QualityResult {
  const t = fold(text)
  const checks: Check[] = [
    { key: 'what_done', ok: t.length >= 40 && /замен|отремонт|устран|восстанов|установ|вывез|очищ|прочищ|демонт|залат|заасфальт|подключ|ауыстыр|жөнде|орнат|шығар|replaced|repaired|restored|installed|removed|cleared|fixed/.test(t) && SERVICE_WORDS[ctx.service].test(t) },
    { key: 'date', ok: /\d{1,2}[.:]\d{2}|\d{1,2}\s*(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)|сегодня|вчера|бүгін|кеше|today|yesterday|\d{1,2}\.\d{1,2}\.\d{2,4}/.test(t) },
    { key: 'result', ok: /восстановлен|работает|возобновл|устранен|в норм|горит|вывезен|қалпына|жұмыс істейді|жанады|restored|working|resolved|fixed/.test(t) },
    { key: 'addresses_complaint', ok: SERVICE_WORDS[ctx.service].test(t) && (!ctx.designator || t.includes(ctx.designator.toLowerCase())) },
    { key: 'cause', ok: /причин|в связи|из-за|по причине|вследствие|себебі|байланысты|due to|because|caused/.test(t) },
    { key: 'evidence', ok: !ctx.needsEvidence || ctx.hasEvidence },
    { key: 'language', ok: detectLang(text) === ctx.lang },
    { key: 'appeal_right', ok: /обжал|шағымдан|appeal/.test(t) },
  ]
  const weights: Record<string, number> = { what_done: 0.24, date: 0.12, result: 0.18, addresses_complaint: 0.14, cause: 0.08, evidence: 0.12, language: 0.06, appeal_right: 0.06 }
  const score = Number(checks.reduce((s, c) => s + (c.ok ? weights[c.key]! : 0), 0).toFixed(2))
  const critical = !checks.find((c) => c.key === 'what_done')!.ok || !checks.find((c) => c.key === 'result')!.ok
  return { score, verdict: score >= 0.8 && !critical ? 'good' : score >= 0.5 && !critical ? 'needs_work' : 'insufficient', checks }
}

// ── Proof of resolution ─────────────────────────────────────────────────────
export type EvidencePhoto = { kind: 'before' | 'after'; lat: number | null; lon: number | null; captured_at: string; hash: string; brightness: number; image?: string }
export type EvidenceResult = { verdict: 'consistent' | 'cannot_verify' | 'inconsistent'; checks: Array<Check & { detail?: string }> }

function hamming(a: string, b: string) {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

export function checkEvidence(photos: EvidencePhoto[], ctx: { service: IncidentService; point: { lat: number; lon: number } | null; opened_at: string }): EvidenceResult {
  const before = photos.find((p) => p.kind === 'before')
  const after = photos.filter((p) => p.kind === 'after').at(-1)
  const checks: EvidenceResult['checks'] = []
  checks.push({ key: 'after_present', ok: !!after })
  checks.push({ key: 'before_after', ok: !!before && !!after })
  if (after) {
    const geo = after.lat != null && after.lon != null && ctx.point ? Math.round(metresBetween(ctx.point, { lat: after.lat, lon: after.lon })) : null
    checks.push({ key: 'geo_match', ok: geo != null && geo <= 200, detail: geo == null ? 'no location in photo' : `${geo} m from the incident` })
    checks.push({ key: 'after_open', ok: new Date(after.captured_at) >= new Date(new Date(ctx.opened_at).getTime() - 10 * 60000), detail: new Date(after.captured_at).toISOString() })
    if (before) {
      const d = hamming(before.hash, after.hash)
      checks.push({ key: 'photos_differ', ok: d >= 6, detail: `${d}/64 bits differ` })
    }
    if (ctx.service === 'streetlight') {
      const h = (new Date(after.captured_at).getUTCHours() + 5) % 24
      const night = h >= 19 || h <= 6
      checks.push({ key: 'shows_light_on', ok: night && after.brightness < 0.5, detail: night ? 'captured after dark' : `captured at ${String(h).padStart(2, '0')}:xx — daylight cannot show a working lamp` })
    }
  }
  const failed = checks.filter((c) => !c.ok).map((c) => c.key)
  const verdict: EvidenceResult['verdict'] = !after ? 'cannot_verify'
    : failed.includes('geo_match') || failed.includes('after_open') ? 'inconsistent'
    : failed.length ? 'cannot_verify' : 'consistent'
  return { verdict, checks }
}

// ── Call QA (flag for review — never an automatic penalty) ──────────────────
export function callQa(transcript: string, registered: { service: IncidentService; designator: string | null; house: string | null; lang: Lang }): { review: boolean; checks: Check[] } {
  const t = fold(transcript)
  const operator = t.split('\n').filter((l) => /^(?:оператор|operator|109)\s*:/.test(l)).join(' ')
  const caller = t.split('\n').filter((l) => !/^(?:оператор|operator|109)\s*:/.test(l)).join(' ')
  const heard = intake(caller)
  const checks: Check[] = [
    { key: 'address_clarified', ok: !!registered.designator && (!!registered.house || !SERVICE_META[registered.service].buildingLevel) },
    { key: 'category_matches', ok: heard.service === registered.service || heard.service === 'other' },
  ]
  // Operator-side checks only when the transcript has the operator's lines.
  if (operator) checks.push(
    { key: 'number_given', ok: /номер (?:заявки|обращения)|inc-\d+|өтініш нөмірі|reference number|sms/.test(operator) },
    { key: 'language_matches', ok: detectLang(operator) === registered.lang },
    { key: 'risk_asked', ok: heard.risk === 'none' || /опасн|безопас|пострадав|қауіп|danger|safe/.test(operator) },
  )
  return { review: checks.some((c) => !c.ok), checks }
}

// ── Resident report gate: photo policy + anti-spam rules ────────────────────
// A photo is asked for where the problem is visible. It is never required for
// outages (you cannot photograph "no water"), for gas, or when the intake sees
// danger: a report about a hazard must never wait for a picture.
export const PHOTO_POLICY: Record<IncidentService, 'required' | 'optional'> = {
  streetlight: 'required', garbage: 'required', road: 'required', yard: 'required', building_safety: 'required',
  water: 'optional', hot_water: 'optional', electricity: 'optional', heating: 'optional', gas: 'optional',
  sewer: 'optional', elevator: 'optional', transport: 'optional', other: 'optional',
}

export function photoRequirement(i: Pick<Intake, 'service' | 'risk'>): 'required' | 'optional' {
  if (i.risk !== 'none' || i.service === 'gas') return 'optional'
  return PHOTO_POLICY[i.service]
}

export type SpamRule = 'gibberish' | 'advert' | 'duplicate' | 'link' | 'burst' | 'photo_reused'
/** Rules that block outright; the others only flag the report for the operator. */
export const BLOCKING_RULES: SpamRule[] = ['gibberish', 'advert', 'duplicate']

export type SpamContext = {
  /** The same installation sent the same (normalised) text in the last 24 h. */
  duplicate_of: string | null
  /** New reports from this installation in the last hour, before this one. */
  recent_count: number
  /** The same photo came from a different installation before. */
  photo_seen_elsewhere: boolean
}

export const normaliseReport = (text: string) => fold(text).replace(/[^a-zа-яёәғқңөұүһі0-9]+/g, ' ').trim()

export function spamRules(text: string, ctx: SpamContext): SpamRule[] {
  const t = fold(text)
  const letters = (t.match(/[a-zа-яёәғқңөұүһі]/g) ?? []).length
  const words = normaliseReport(text).split(' ').filter(Boolean)
  const out: SpamRule[] = []
  const repeated = words.length >= 6 && new Set(words).size / words.length < 0.3
  // A report says what and where, so it has at least two words; keyboard mashing inside longer text is left to the AI.
  const tooFewWords = words.filter((w) => /[a-zа-яёәғқңөұүһі]{2}/.test(w)).length < 2
  if (letters < 6 || tooFewWords || letters / Math.max(1, t.replace(/\s/g, '').length) < 0.5 || /(.)\1{7,}/.test(t) || repeated) out.push('gibberish')
  const ad = /продам|продаю|купл(?:ю|им)|скидк|акци[яи]\b|реклам|казино|ставк[иа] на|букмекер|заработ(?:ок|ай)|кредит без|займ|подписывайтесь|promo|discount|casino|betting|earn money|сатамын|жеңілдік/
  const contact = /(?:\+?7|8)[\s(-]*7\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}|@[a-z0-9_]{4,}|wa\.me|t\.me/
  if (ad.test(t) && (contact.test(t) || /https?:\/\//.test(t))) out.push('advert')
  else if (/https?:\/\/|www\./.test(t)) out.push('link')
  if (ctx.duplicate_of) out.push('duplicate')
  if (ctx.recent_count >= 5) out.push('burst')
  if (ctx.photo_seen_elsewhere) out.push('photo_reused')
  return out
}

export type AiReview = {
  verdict: 'ok' | 'suspicious' | 'spam'
  is_city_problem: boolean
  /** At most three short phrases, in the report's language. */
  reasons: string[]
  photo: 'matches' | 'mismatch' | 'unclear' | 'none'
  photo_note: string
  engine: string
}

export type ReportCode = 'ok' | 'photo_required' | 'gibberish' | 'advert' | 'duplicate' | 'not_a_city_problem' | 'photo_mismatch' | 'suspicious'
export type ReportDecision = {
  /** block: not sent, the resident sees why · confirm: ask "send anyway?" · pass: sent */
  outcome: 'block' | 'confirm' | 'pass'
  code: ReportCode
  /** Everything an operator should see (non-blocking rules, AI doubts, "sent anyway"). */
  flags: string[]
  reasons: string[]
}

/** The gate for a new resident report. AI only advises; a report about danger always goes through. */
export function reportDecision(x: { rules: SpamRule[]; ai: AiReview | null; photo_required: boolean; has_photo: boolean; risk: RiskLevel }): ReportDecision {
  const soft = x.rules.filter((r) => !BLOCKING_RULES.includes(r))
  const aiFlags = !x.ai ? ['ai_unavailable'] : [...(x.ai.verdict !== 'ok' ? [`ai_${x.ai.verdict}`] : []), ...(x.ai.photo === 'mismatch' ? ['photo_mismatch'] : [])]
  const flags = [...soft, ...aiFlags]
  const reasons = x.ai?.reasons ?? []
  // Imminent danger (gas, something about to fall, sparking wires) is never blocked or delayed; an operator sees the flags.
  if (x.risk === 'imminent') return { outcome: 'pass', code: 'ok', flags: [...x.rules.filter((r) => BLOCKING_RULES.includes(r)), ...flags], reasons }
  const hard = BLOCKING_RULES.find((r) => x.rules.includes(r))
  if (hard) return { outcome: 'block', code: hard as ReportCode, flags, reasons: [] }
  if (x.photo_required && !x.has_photo) return { outcome: 'block', code: 'photo_required', flags, reasons: [] }
  if (x.ai?.verdict === 'spam' && !x.ai.is_city_problem) return { outcome: 'block', code: 'not_a_city_problem', flags, reasons }
  if (x.ai?.photo === 'mismatch') return { outcome: 'confirm', code: 'photo_mismatch', flags, reasons: x.ai.photo_note ? [x.ai.photo_note, ...reasons] : reasons }
  if (x.ai && x.ai.verdict !== 'ok') return { outcome: 'confirm', code: 'suspicious', flags, reasons }
  return { outcome: 'pass', code: 'ok', flags, reasons }
}
