// A pilot week in Aktau with a known answer. The generator decides what really
// happened (which problems, where, for how long, who is affected) and then
// writes what residents would send about it: 10 000 messages in Russian,
// Kazakh, English and a mix, by app, phone, WhatsApp, Instagram and Komek 109,
// with typos, missing words, GPS instead of an address, repeats and spam.
// The engine never sees the ground truth; the metrics compare against it.
//
// Everything is seeded: the same seed gives the same week.
import { ORGS, type IncidentService, type Intake } from '@aktau/city-core'
import { metresBetween } from '@aktau/city-core'
import type { PilotBuilding, PilotCity } from './pilot-city.ts'

// ── Seeded randomness ────────────────────────────────────────────────────────
export function rngFrom(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const r = {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    real: (lo: number, hi: number) => lo + next() * (hi - lo),
    chance: (p: number) => next() < p,
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    weighted: <T>(xs: ReadonlyArray<readonly [T, number]>): T => {
      const total = xs.reduce((s, [, w]) => s + w, 0)
      let x = next() * total
      for (const [v, w] of xs) { x -= w; if (x <= 0) return v }
      return xs[xs.length - 1]![0]
    },
    exp: (mean: number) => -Math.log(1 - next()) * mean,
    poisson: (l: number) => { let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= next() } while (p > L); return k - 1 },
    shuffle: <T>(xs: T[]): T[] => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [xs[i], xs[j]] = [xs[j]!, xs[i]!] } return xs },
  }
  return r
}
export type Rng = ReturnType<typeof rngFrom>

// ── What can happen ──────────────────────────────────────────────────────────
export const PROBLEM_KEYS = [
  'water_net', 'power_net', 'hotwater_net', 'heating_net', 'water_flat', 'power_flat', 'leak', 'streetlight', 'garbage', 'road',
  'elevator', 'sewer', 'yard', 'transport', 'manhole', 'gas', 'facade', 'wires',
] as const
export type ProblemKey = (typeof PROBLEM_KEYS)[number]
type Where = 'home' | 'street'

type Spec = {
  service: IncidentService; kind: Intake['kind']; where: Where; danger: boolean; org: string
  /** Problems in a week at the 10 000-report scale. */
  count: number
  /** Hours from start to the real fix. */
  hours: [number, number]
  /** Radius (m) of who is affected, for problems at a point. Mirrors the notification policy the city chose. */
  radius?: number
}
const SPECS: Record<ProblemKey, Spec> = {
  water_net: { service: 'water', kind: 'outage', where: 'home', danger: false, org: ORGS.KZHSA, count: 13, hours: [3, 26] },
  power_net: { service: 'electricity', kind: 'outage', where: 'home', danger: false, org: ORGS.AUES, count: 11, hours: [1.5, 12] },
  hotwater_net: { service: 'hot_water', kind: 'outage', where: 'home', danger: false, org: ORGS.KZHSA, count: 6, hours: [6, 48] },
  heating_net: { service: 'heating', kind: 'outage', where: 'home', danger: false, org: ORGS.KZHSA, count: 2, hours: [12, 40] },
  water_flat: { service: 'water', kind: 'outage', where: 'home', danger: false, org: ORGS.OSI, count: 16, hours: [3, 24] },
  power_flat: { service: 'electricity', kind: 'outage', where: 'home', danger: false, org: ORGS.OSI, count: 14, hours: [2, 16] },
  leak: { service: 'water', kind: 'damage', where: 'street', danger: false, org: ORGS.KZHSA, count: 14, hours: [4, 30], radius: 150 },
  streetlight: { service: 'streetlight', kind: 'outage', where: 'street', danger: false, org: ORGS.LIGHTING, count: 55, hours: [24, 120], radius: 150 },
  garbage: { service: 'garbage', kind: 'complaint', where: 'street', danger: false, org: ORGS.WASTE, count: 45, hours: [12, 72], radius: 150 },
  road: { service: 'road', kind: 'damage', where: 'street', danger: false, org: ORGS.ROADS, count: 35, hours: [48, 240], radius: 300 },
  elevator: { service: 'elevator', kind: 'outage', where: 'home', danger: false, org: ORGS.ELEVATOR, count: 30, hours: [6, 48] },
  sewer: { service: 'sewer', kind: 'outage', where: 'home', danger: false, org: ORGS.OSI, count: 22, hours: [4, 36] },
  yard: { service: 'yard', kind: 'complaint', where: 'street', danger: false, org: ORGS.PARKS, count: 18, hours: [24, 168], radius: 150 },
  transport: { service: 'transport', kind: 'complaint', where: 'street', danger: false, org: ORGS.ROADS, count: 8, hours: [2, 12], radius: 400 },
  manhole: { service: 'sewer', kind: 'hazard', where: 'street', danger: true, org: ORGS.KZHSA, count: 6, hours: [2, 24], radius: 200 },
  gas: { service: 'gas', kind: 'hazard', where: 'home', danger: true, org: ORGS.GAS, count: 6, hours: [0.5, 4], radius: 250 },
  facade: { service: 'building_safety', kind: 'hazard', where: 'street', danger: true, org: ORGS.OSI, count: 5, hours: [3, 24], radius: 200 },
  wires: { service: 'electricity', kind: 'hazard', where: 'street', danger: true, org: ORGS.AUES, count: 5, hours: [1, 6], radius: 200 },
}
export const specOf = (k: ProblemKey) => SPECS[k]

export type TruthZone =
  | { kind: 'buildings'; buildings: number[] }
  | { kind: 'areas'; areas: string[] }
  | { kind: 'radius'; lat: number; lon: number; radius: number }
  | { kind: 'household'; building: number; residents: number[] }

export type Problem = {
  id: number; key: ProblemKey; service: IncidentService; kind: Intake['kind']; danger: boolean; org: string
  zone: TruthZone
  /** The building people name when they describe it. */
  anchor: number
  lat: number; lon: number
  start: number; end: number
  recurrenceOf: number | null
  /** A different problem at the same place and time (e.g. a leak outside a house with no water). */
  twinOf: number | null
}

export type Lang = 'ru' | 'kk' | 'en'
export type Channel = 'APP' | 'PHONE' | 'WHATSAPP' | 'INSTAGRAM' | 'KOMEK109'
export type SpamKind = 'advert' | 'gibberish' | 'resend' | 'chatter' | 'troll'

export type Report = {
  id: number; at: number
  /** Ground truth: the problem this message is about (null for spam). */
  problem: number | null
  spam: SpamKind | null
  channel: Channel
  lang: Lang | 'mixed'
  text: string
  /** The app user who sent it (APP only); their device is the installation. */
  resident: number | null
  /** Shared location, when the message has no address. */
  lat: number | null; lon: number | null
  photo: boolean
  /** The building the message names (or the phone stood next to): the address a perfect reading would find. */
  building: number
  /** How the text was written, for the "why" of any mistake. */
  style: string
}

export type Resident = { i: number; building: number; hasHome: boolean; lang: Lang }
export type Scenario = { seed: number; start: number; end: number; problems: Problem[]; reports: Report[]; residents: Resident[]; residentsIn: Map<number, number[]> }

export type ScenarioOptions = { reports: number; days: number; seed: number; now: number; spamShare?: number }

// ── Words ────────────────────────────────────────────────────────────────────
type Phr = Record<Lang, string[]>
const WHAT: Record<ProblemKey, Phr> = {
  water_net: {
    ru: ['нет воды', 'нет холодной воды', 'отключили воду', 'воды нет', 'пропала вода', 'нету воды', 'вода не идёт', 'в кране нет воды', 'опять нет воды', 'без воды сидим'],
    kk: ['су жоқ', 'суық су жоқ', 'су берілмей тұр', 'крандан су ақпайды', 'су өшірілді'],
    en: ['no water', 'no cold water', 'water is off'],
  },
  power_net: {
    ru: ['нет света', 'отключили свет', 'света нет', 'пропал свет', 'нет электричества', 'электричество отключили', 'свет вырубили', 'нет электроэнергии', 'опять без света'],
    kk: ['жарық жоқ', 'жарық сөнді', 'электр жоқ', 'жарықты өшірді', 'үйде жарық жоқ'],
    en: ['no power', 'power outage', 'no electricity'],
  },
  hotwater_net: {
    ru: ['нет горячей воды', 'отключили горячую воду', 'горячей воды нет', 'не идёт горячая вода', 'нет ГВС'],
    kk: ['ыстық су жоқ', 'ыстық су берілмейді'],
    en: ['no hot water'],
  },
  heating_net: {
    ru: ['нет отопления', 'батареи холодные', 'не греют батареи', 'отопление не работает'],
    kk: ['жылу жоқ', 'батареялар суық', 'үй суық, жылу берілмейді'],
    en: ['no heating', 'radiators are cold'],
  },
  water_flat: {
    ru: ['нет воды в квартире', 'в квартире нет воды', 'нет воды только у нас', 'в кране нет воды'],
    kk: ['пәтерде су жоқ', 'бізде су жоқ'],
    en: ['no water in my flat'],
  },
  power_flat: {
    ru: ['нет света в квартире', 'в квартире пропал свет', 'выбило свет в квартире', 'нет электричества только у нас'],
    kk: ['пәтерде жарық жоқ', 'бізде ғана жарық жоқ'],
    en: ['no power in my flat'],
  },
  leak: {
    ru: ['прорвало трубу', 'течёт вода из-под асфальта', 'течь воды на улице', 'вода хлещет из-под земли', 'прорыв водопровода', 'труба лопнула, течёт вода', 'затапливает дорогу водой'],
    kk: ['құбыр жарылып, су ағып жатыр', 'көшеде су ағып жатыр', 'су құбыры жарылды'],
    en: ['water leak on the street', 'burst pipe, water everywhere'],
  },
  streetlight: {
    ru: ['не горят фонари', 'фонарь не горит', 'темно во дворе, освещение не работает', 'уличное освещение не работает', 'не работает освещение', 'темно, ни один фонарь не горит'],
    kk: ['шамдар жанбайды', 'көше жарығы жанбайды', 'аулада қараңғы, шам жанбайды', 'көше шамы істемейді'],
    en: ['street lights are out', 'the street light is not working'],
  },
  garbage: {
    ru: ['мусор не вывозят', 'контейнеры переполнены', 'свалка у контейнеров', 'мусор не вывезли третий день', 'мусорка переполнена, всё вокруг в мусоре', 'не вывозят мусор, запах'],
    kk: ['қоқыс шығарылмаған', 'қоқыс жәшіктері толып кетті', 'қоқыс үш күннен бері шығарылмайды'],
    en: ['garbage not collected', 'bins are overflowing'],
  },
  road: {
    ru: ['большая яма на дороге', 'выбоина на дороге', 'разбит асфальт', 'провал асфальта', 'яма посреди дороги, машины бьют колёса', 'дорога вся в ямах'],
    kk: ['жолда үлкен шұңқыр бар', 'жол бұзылған', 'асфальт бұзылған'],
    en: ['big pothole on the road', 'road damage'],
  },
  elevator: {
    ru: ['лифт не работает', 'лифт стоит', 'не работает лифт второй день', 'лифт сломался', 'лифт опять не работает'],
    kk: ['лифт істемейді', 'лифт тоқтап тұр'],
    en: ['the elevator is not working', 'lift is broken'],
  },
  sewer: {
    ru: ['засор канализации', 'затопило подвал', 'канализация течёт в подвал', 'воняет канализацией', 'засорилась канализация'],
    kk: ['кәріз бітелген', 'жертөлені су басты', 'кәріз ағып жатыр'],
    en: ['sewer blocked', 'the basement is flooded with sewage'],
  },
  yard: {
    ru: ['сломана детская площадка', 'упало дерево во дворе', 'сломаны качели на площадке', 'во дворе упало дерево, перегородило проход'],
    kk: ['балалар алаңы сынған', 'аулада ағаш құлады'],
    en: ['playground is broken', 'a tree fell in the yard'],
  },
  transport: {
    ru: ['автобус не ходит уже час', 'на остановке сломан навес', 'автобус не приходит', 'остановку разбили'],
    kk: ['автобус жүрмейді', 'аялдама бұзылған'],
    en: ['the bus is not coming', 'the bus stop is broken'],
  },
  manhole: {
    ru: ['открытый люк', 'люк без крышки', 'нет крышки на люке', 'открыт канализационный люк', 'открытый колодец, можно упасть'],
    kk: ['ашық люк', 'люктің қақпағы жоқ'],
    en: ['open manhole', 'missing manhole cover'],
  },
  gas: {
    ru: ['запах газа', 'пахнет газом в подъезде', 'сильный запах газа', 'утечка газа', 'чувствуется запах газа'],
    kk: ['газ иісі шығып тұр', 'подъезде газ иісі бар', 'газ иісі шығады'],
    en: ['smell of gas in the stairwell', 'gas leak'],
  },
  facade: {
    ru: ['висит блок кондиционера, может упасть', 'с балкона падают куски бетона', 'отваливается облицовка фасада', 'кондиционер держится на одном болте', 'с крыши падают куски'],
    kk: ['кондиционер құлағалы тұр', 'балконнан бетон құлап жатыр'],
    en: ['an air conditioner unit is hanging and may fall', 'pieces of the balcony are falling'],
  },
  wires: {
    ru: ['искрит провод', 'оборванный провод лежит на земле', 'провод висит низко, искрит', 'искрят провода на столбе', 'оголённые провода'],
    kk: ['сым үзіліп жерде жатыр', 'сымдар ұшқындап тұр'],
    en: ['sparking wire on the pole', 'a live wire is on the ground'],
  },
}
const OBJ: Partial<Record<ProblemKey, string>> = { water_net: 'воды', power_net: 'света', hotwater_net: 'горячей воды', heating_net: 'отопления' }

const GREET: Phr = { ru: ['Здравствуйте! ', 'Добрый день. ', 'Алло, ', 'Добрый вечер, ', '', '', '', ''], kk: ['Сәлеметсіз бе! ', '', '', ''], en: ['Hello, ', '', ''] }
const EXTRA: Phr = {
  ru: [' Дети дома!', ' В доме пожилые люди.', ' Сколько можно?!', ' Примите меры.', ' Когда исправят?', ' Помогите, пожалуйста.', ' Уже звонили, толку нет.', '', '', '', '', '', ''],
  kk: [' Балалар үйде.', ' Қашан жөндейді?', ' Көмектесіңіздер.', '', '', ''],
  en: [' Please help.', ' When will it be fixed?', '', ''],
}
const NEIGH: Phr = {
  ru: [' У соседей тоже.', ' Во всём доме.', ' У всех соседей так же.', ' Весь подъезд так.'],
  kk: [' Көршілерде де жоқ.', ' Бүкіл үйде.'],
  en: [' Neighbours too.', ' The whole building.'],
}
const WHOLE_AREA: Phr = { ru: [' Во всём микрорайоне.', ' По всему микрорайону так.'], kk: [' Бүкіл шағын ауданда.'], en: [' The whole district.'] }

function designatorText(d: string, lang: Lang, r: Rng): string {
  const m = /^(САМАЛ|ТОЛКЫН|ШЫГЫС)(?:-(\d))?$/.exec(d)
  if (m) {
    const name = { САМАЛ: ['Самал', 'самал'], ТОЛКЫН: ['Толкын', 'Толқын'], ШЫГЫС: ['Шыгыс', 'Шығыс'] }[m[1] as 'САМАЛ']!
    return `${lang === 'kk' ? name[1] : name[0]}${m[2] ? r.pick(['-', ' ']) + m[2] : ''}`
  }
  return r.chance(0.5) ? d.toLowerCase() : d
}
const isNamed = (d: string) => /^(САМАЛ|ТОЛКЫН|ШЫГЫС)/.test(d)

/** "14 мкр, дом 21" in one of the ways people write it. */
function homeAddress(d: string, h: string, lang: Lang, r: Rng): string {
  const dt = designatorText(d, lang, r)
  if (isNamed(d)) {
    return lang === 'kk' ? r.pick([`${dt}, ${h} үй`, `${dt} ${h} үйде`]) : lang === 'en' ? `${dt}, house ${h}` : r.pick([`${dt}, дом ${h}`, `мкр ${dt}, д. ${h}`, `${dt}, ${h}`])
  }
  if (lang === 'kk') return r.weighted([[`${dt} ш/а, ${h} үй`, 3], [`${dt} шағын аудан, ${h} үйде`, 2], [`${dt} ш/а ${h} үйде`, 2], [`${dt}-ші шағын аудан, ${h} үй`, 1]] as const)
  if (lang === 'en') return r.weighted([[`${dt} mkr, house ${h}`, 3], [`mkr ${dt}, house ${h}`, 1], [`microdistrict ${dt}, house ${h}`, 1]] as const)
  return r.weighted([
    [`${dt} мкр, дом ${h}`, 5], [`${dt} мкр ${h} дом`, 3], [`${dt} микрорайон, дом ${h}`, 2], [`${dt}-й мкр, д. ${h}`, 1], [`мкр ${dt}, дом ${h}`, 1],
    [`${dt} мкр, ${h}`, 2], [`в ${dt} микрорайоне, дом ${h}`, 1], [`${dt} мкр. д.${h}`, 1],
  ] as const)
}

/** "возле дома 21 в 15 мкр". */
function nearAddress(d: string, h: string, lang: Lang, r: Rng): string {
  const dt = designatorText(d, lang, r)
  if (isNamed(d)) return lang === 'kk' ? `${dt}, ${h} үйдің жанында` : lang === 'en' ? `near house ${h}, ${dt}` : r.pick([`${dt}, возле дома ${h}`, `возле дома ${h}, ${dt}`])
  if (lang === 'kk') return r.pick([`${dt} ш/а ${h} үйдің жанында`, `${dt} шағын аудан, ${h} үй жанында`, `${dt} ш/а, ${h} үй`])
  if (lang === 'en') return r.pick([`near house ${h}, ${dt} mkr`, `${dt} mkr, near house ${h}`])
  return r.weighted([
    [`в ${dt} мкр возле дома ${h}`, 4], [`${dt} мкр, возле дома ${h}`, 3], [`у дома ${h}, ${dt} мкр`, 2], [`${dt} мкр около дома ${h}`, 2],
    [`напротив дома ${h}, ${dt} микрорайон`, 1], [`во дворе ${dt} мкр, дом ${h}`, 2],
  ] as const)
}

function since(lang: Lang, hours: number, r: Rng, local: Date): string {
  if (r.chance(0.35)) return ''
  const hh = local.getUTCHours()
  if (lang === 'kk') return hours > 14 ? ' кешеден бері' : hours >= 2 ? ` ${Math.max(2, Math.round(hours))} сағат бойы` : hh < 12 ? ' таңертеңнен' : ''
  if (lang === 'en') return hours > 14 ? ' since yesterday' : hours >= 2 ? ` for ${Math.round(hours)} hours` : hh < 12 ? ' since morning' : ''
  if (hours > 20) return r.pick([' со вчера', ' со вчерашнего дня', ' второй день'])
  if (hours > 10) return r.pick([' со вчерашнего вечера', ' с ночи', ' с утра'])
  if (hours >= 2) return r.pick([` уже ${Math.round(hours)} часа`, ' с утра', ` уже ${Math.round(hours)} ч`])
  return r.pick([' только что', ' с полчаса', ''])
}

const TRANSLIT: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }

/** Typing noise: lower case, no punctuation, a swapped pair of letters, an emoji, Latin letters. */
function noisy(text: string, r: Rng, typed: boolean): { text: string; style: string[] } {
  const style: string[] = []
  let t = text
  if (typed && r.chance(0.3)) { t = t.toLowerCase(); style.push('lowercase') }
  if (typed && r.chance(0.2)) { t = t.replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim(); style.push('no_punctuation') }
  if (typed && r.chance(0.035)) {
    const words = t.split(' ')
    const idx = words.map((w, i) => (w.length >= 6 && /^[а-яёәғқңөұүһіa-z]+$/i.test(w) ? i : -1)).filter((i) => i >= 0)
    if (idx.length) {
      const i = r.pick(idx), w = words[i]!, k = r.int(1, w.length - 3)
      words[i] = w.slice(0, k) + w[k + 1] + w[k] + w.slice(k + 2)
      t = words.join(' ')
      style.push('typo')
    }
  }
  if (typed && !/[әғқңөұүһі]/i.test(t) && r.chance(0.01)) { t = t.toLowerCase().replace(/[а-яё]/g, (c) => TRANSLIT[c] ?? c); style.push('latin_letters') }
  if (typed && r.chance(0.05)) { t += r.pick([' 😡', ' 🙏', ' !!!', ' ((']); style.push('emoji') }
  return { text: t, style }
}

// ── The week ─────────────────────────────────────────────────────────────────
export function generateScenario(city: PilotCity, o: ScenarioOptions): Scenario {
  const r = rngFrom(o.seed)
  const end = o.now
  const start = end - o.days * 86400_000
  const H = 3600_000
  const scale = o.reports / 10_000

  // Residents with the app: blocks of flats in numbered microdistricts, few
  // in the private-house districts (Shygys, Samal, Tolkyn).
  const residents: Resident[] = []
  const residentsIn = new Map<number, number[]>()
  for (const b of city.buildings) {
    const a = b.area_id ? city.areaById.get(b.area_id) : null
    if (!a) continue
    const n = r.poisson(isNamed(a.designator) ? 0.7 : 12)
    for (let k = 0; k < n; k++) {
      const res: Resident = { i: residents.length, building: b.i, hasHome: r.chance(0.85), lang: r.weighted([['ru', 62], ['kk', 33], ['en', 5]] as const) }
      residents.push(res)
      if (!residentsIn.has(b.i)) residentsIn.set(b.i, [])
      residentsIn.get(b.i)!.push(res.i)
    }
  }
  const usersIn = (bs: number[]) => bs.flatMap((b) => residentsIn.get(b) ?? [])
  const housed = city.buildings.filter((b) => inCity(city, b.i) && (residentsIn.get(b.i)?.length ?? 0) > 0)
  const located = city.buildings.filter((b) => inCity(city, b.i))
  const anyBuilding = () => (r.chance(0.8) ? r.pick(housed) : r.pick(located))

  // ── Problems ───────────────────────────────────────────────────────────────
  const problems: Problem[] = []
  const offset = (b: PilotBuilding, lo: number, hi: number) => {
    const d = r.real(lo, hi), th = r.real(0, 2 * Math.PI)
    return { lat: b.lat + (d * Math.cos(th)) / 110_574, lon: b.lon + (d * Math.sin(th)) / (111_320 * Math.cos((b.lat * Math.PI) / 180)) }
  }
  const add = (p: Omit<Problem, 'id'>) => { problems.push({ ...p, id: problems.length }); return problems[problems.length - 1]! }
  // Two problems nobody could tell apart from the messages (the same kind of outage in the same
  // or the next microdistrict at the same hours; the same street problem a few doors away at the
  // same time) are one problem as far as 109 can know. The week does not contain such pairs.
  const net = (k: ProblemKey) => k.endsWith('_net')
  const areaOf = (b: number) => city.buildings[b]!.area_id!
  const touches = (a: string, b: string) => a === b || !!city.adjacency.get(a)?.has(b)
  const clash = (key: ProblemKey, anchor: PilotBuilding, lat: number, lon: number, t0: number, t1: number) => problems.some((q) => {
    const sq = SPECS[q.key], sk = SPECS[key]
    if (sq.service !== sk.service || q.start > t1 + 12 * H || q.end < t0 - 12 * H) return false
    if ((net(key) || key.endsWith('_flat')) && (net(q.key) || q.key.endsWith('_flat'))) return (net(key) || net(q.key)) ? touches(areaOf(q.anchor), anchor.area_id!) : q.anchor === anchor.i
    if (sk.where === 'home' && sq.where === 'home' && !net(key) && !net(q.key)) return q.anchor === anchor.i
    if (sk.where === 'street' && sq.where === 'street' && sk.kind === sq.kind) return metresBetween({ lat, lon }, { lat: q.lat, lon: q.lon }) < 450
    return false
  })
  for (const key of PROBLEM_KEYS) {
    const s = SPECS[key]
    const n = Math.max(1, Math.round(s.count * Math.min(1.5, Math.max(0.35, scale))))
    for (let k = 0; k < n; k++) {
      let anchor = s.where === 'home' || key === 'facade' ? r.pick(housed) : anyBuilding()
      let t0 = r.real(start - 6 * H, end - 1.5 * H)
      const dur = r.real(s.hours[0], s.hours[1]) * H
      for (let tries = 0; tries < 40 && clash(key, anchor, anchor.lat, anchor.lon, t0, t0 + dur); tries++) {
        anchor = s.where === 'home' || key === 'facade' ? r.pick(housed) : anyBuilding()
        t0 = r.real(start - 6 * H, end - 1.5 * H)
      }
      let zone: TruthZone
      let lat = anchor.lat, lon = anchor.lon
      if (key === 'water_net' || key === 'power_net' || key === 'hotwater_net' || key === 'heating_net') {
        const roll = r.next()
        if (roll < 0.1 && anchor.area_id) {
          // A trunk failure: the whole microdistrict, sometimes the neighbour too.
          const areas = [anchor.area_id]
          const next = [...(city.adjacency.get(anchor.area_id) ?? [])].filter((x) => (city.buildingsIn.get(x)?.length ?? 0) > 10)
          if (roll < 0.03 && next.length) areas.push(r.pick(next))
          zone = { kind: 'areas', areas }
        } else {
          const named = isNamed(city.areaById.get(anchor.area_id!)!.designator)
          const k = named ? r.int(6, 40) : r.int(3, 22)
          const pool = city.grid.nearest(anchor.lat, anchor.lon, 120, 700).filter((i) => inCity(city, i) && (r.chance(0.1) || city.buildings[i]!.area_id === anchor.area_id))
          zone = { kind: 'buildings', buildings: [anchor.i, ...pool.filter((i) => i !== anchor.i).slice(0, k - 1)] }
        }
      } else if (key === 'water_flat' || key === 'power_flat') {
        const home = residentsIn.get(anchor.i)!
        zone = { kind: 'household', building: anchor.i, residents: r.shuffle([...home]).slice(0, Math.min(home.length, r.int(1, 2))) }
      } else if (key === 'elevator' || key === 'sewer') {
        zone = { kind: 'buildings', buildings: [anchor.i] }
      } else {
        const p = key === 'gas' ? offset(anchor, 0, 8) : key === 'facade' ? offset(anchor, 3, 12) : offset(anchor, 15, 70)
        lat = p.lat; lon = p.lon
        zone = { kind: 'radius', lat, lon, radius: s.radius! }
      }
      add({ key, service: s.service, kind: s.kind, danger: s.danger, org: s.org, zone, anchor: anchor.i, lat, lon, start: t0, end: t0 + dur, recurrenceOf: null, twinOf: null })
    }
  }
  // Hard cases the engine must keep apart: a leak outside a house that has no water (a different problem, same place, same time).
  const outages = problems.filter((p) => p.key === 'water_net' && p.zone.kind === 'buildings')
  for (const o2 of outages.slice(0, Math.max(1, Math.round(5 * scale)))) {
    const b = city.buildings[(o2.zone as { buildings: number[] }).buildings.find((i) => i !== o2.anchor && inCity(city, i)) ?? o2.anchor]!
    const pt = offset(b, 20, 50)
    const t0 = r.real(o2.start, Math.min(o2.end, end - 2 * H))
    if (clash('leak', b, pt.lat, pt.lon, t0, t0 + 20 * H)) continue
    add({ key: 'leak', service: 'water', kind: 'damage', danger: false, org: ORGS.KZHSA, zone: { kind: 'radius', lat: pt.lat, lon: pt.lon, radius: 150 }, anchor: b.i, lat: pt.lat, lon: pt.lon, start: t0, end: t0 + r.real(4, 20) * H, recurrenceOf: null, twinOf: o2.id })
  }
  // The same thing breaks again at the same place after it was fixed.
  const fixedEarly = problems.filter((p) => ['streetlight', 'garbage', 'elevator', 'sewer'].includes(p.key) && p.end < end - 36 * H && p.start > start)
  for (const p of r.shuffle([...fixedEarly]).slice(0, Math.max(1, Math.round(10 * scale)))) {
    const t0 = p.end + r.real(12, 30) * H
    if (t0 > end - 3 * H) continue
    add({ ...p, start: t0, end: t0 + r.real(SPECS[p.key].hours[0], SPECS[p.key].hours[1]) * H, recurrenceOf: p.id, twinOf: null })
  }

  // ── How many messages each problem gets ────────────────────────────────────
  const spamShare = o.spamShare ?? 0.04
  const spamN = Math.round(o.reports * spamShare)
  const genuineN = o.reports - spamN
  const affectedUsers = (p: Problem) => zoneUsers(city, residentsIn, p.zone).length
  const fixed = new Map<number, number>()
  const weight = new Map<number, number>()
  for (const p of problems) {
    const u = affectedUsers(p)
    if (p.zone.kind === 'household') fixed.set(p.id, r.int(1, 3))
    else if (p.danger) fixed.set(p.id, r.int(1, 9))
    else if (p.key.endsWith('_net')) weight.set(p.id, u * r.real(0.45, 0.9) + 3)
    else if (p.key === 'elevator' || p.key === 'sewer') weight.set(p.id, Math.min(14, 1 + u * r.real(0.1, 0.5)))
    else weight.set(p.id, { leak: r.real(4, 28), streetlight: r.real(2, 12), garbage: r.real(2, 14), road: r.real(1, 8), yard: r.real(1, 4), transport: r.real(1, 6) }[p.key as 'leak'] ?? 2)
  }
  const fixedSum = [...fixed.values()].reduce((a, b) => a + b, 0)
  const wSum = [...weight.values()].reduce((a, b) => a + b, 0)
  const budget = Math.max(weight.size, genuineN - fixedSum)
  const planned = new Map<number, number>(fixed)
  for (const [id, w] of weight) planned.set(id, Math.max(1, Math.round((w / wSum) * budget)))
  // Exactly genuineN: adjust the biggest outages (their size is the least exact thing we know).
  let diff = genuineN - [...planned.values()].reduce((a, b) => a + b, 0)
  const biggest = [...weight.keys()].sort((a, b) => planned.get(b)! - planned.get(a)!)
  for (let k = 0; diff !== 0 && k < 100_000; k++) {
    const id = biggest[k % Math.min(biggest.length, 12)]!
    const step = diff > 0 ? 1 : -1
    if (planned.get(id)! + step >= 1) { planned.set(id, planned.get(id)! + step); diff -= step }
  }

  // ── The messages ───────────────────────────────────────────────────────────
  const reports: Report[] = []
  const nearby = (lat: number, lon: number, m: number) => usersIn(city.grid.within(lat, lon, m))
  for (const p of problems) {
    const n = planned.get(p.id) ?? 0
    const s = SPECS[p.key]
    const zoneB = zoneBuildings(city, p.zone)
    const affected = shuffleCopy(r, zoneUsers(city, residentsIn, p.zone))
    const passers = s.where === 'street' || p.danger ? shuffleCopy(r, nearby(p.lat, p.lon, 450)) : []
    const used = new Set<number>()
    const last = Math.min(p.end, end) - p.start
    for (let k = 0; k < n; k++) {
      // When: outages and dangers are reported at once; things in the street over days.
      let delay = s.where === 'home' || p.danger ? Math.min(r.exp(Math.min(1.6 * H, (p.end - p.start) / 3)), last) : r.real(0.05, 1) * last
      let at = p.start + Math.max(60_000, delay)
      const local = new Date(at + 5 * H)
      // At night people wait for the morning, unless the problem is over by then.
      const morning = at + (7 - local.getUTCHours() + r.real(0, 2)) * H
      if (local.getUTCHours() >= 1 && local.getUTCHours() < 6 && r.chance(0.85) && !p.danger && morning < p.end) at = morning
      if (at >= end) at = end - r.real(1, 30) * 60_000
      if (at < start) at = start + r.real(1, 60) * 60_000
      // Who and how.
      let channel: Channel = p.danger ? r.weighted([['PHONE', 45], ['APP', 35], ['WHATSAPP', 10], ['KOMEK109', 10]] as const)
        : r.weighted([['APP', 45], ['PHONE', 25], ['WHATSAPP', 14], ['KOMEK109', 10], ['INSTAGRAM', 6]] as const)
      let resident: number | null = null
      if (channel === 'APP') {
        const pool = p.zone.kind === 'household' ? p.zone.residents : s.where === 'street' || p.danger ? [...passers, ...affected] : affected
        const who = pool.find((x) => !used.has(x))
        if (who == null) channel = r.pick(['PHONE', 'WHATSAPP', 'KOMEK109'] as const)
        else { resident = who; used.add(who) }
      }
      const res = resident != null ? residents[resident]! : null
      const lang: Lang | 'mixed' = res ? (r.chance(0.04) ? 'mixed' : res.lang) : r.weighted([['ru', 60], ['kk', 30], ['en', 3], ['mixed', 7]] as const)
      // The building they name: their own for problems at home, a house nearby for the street.
      // A smell of gas is described where it is (the anchor house, or its neighbour), not at the reporter's own home.
      const homeB = p.key === 'gas' ? city.buildings[r.chance(0.8) ? p.anchor : (city.grid.nearest(p.lat, p.lon, 2).filter((i) => inCity(city, i))[1] ?? p.anchor)]!
        : res && s.where === 'home' && !p.danger && zoneB.includes(res.building) ? city.buildings[res.building]!
        : s.where === 'home' ? city.buildings[r.pick(zoneB.length ? zoneB : [p.anchor])]!
        : city.buildings[r.chance(0.7) ? p.anchor : (city.grid.nearest(p.lat, p.lon, 3).filter((i) => inCity(city, i))[r.int(0, 2)] ?? p.anchor)]!
      const w = writeReport(city, r, p, homeB, lang, channel, res, at)
      reports.push({ id: reports.length, at, problem: p.id, spam: null, channel, lang, text: w.text, resident, lat: w.lat, lon: w.lon, photo: channel === 'APP', building: homeB.i, style: w.style })
    }
  }

  // ── Spam, repeats and pranks (app only: the other channels pass through a 109 operator) ──
  const appSenders = residents.filter((x) => x.hasHome)
  const genuineApp = reports.filter((x) => x.channel === 'APP')
  const phone = () => `+7 7${r.int(0, 7)}${r.int(0, 9)} ${r.int(100, 999)} ${r.int(10, 99)} ${r.int(10, 99)}`
  const ADS = [
    () => `Продам квартиру в ${r.int(1, 30)} мкр, недорого, звоните ${phone()}`,
    () => `Кредит без справок за 1 день! Пишите в WhatsApp wa.me/7707${r.int(1000000, 9999999)}`,
    () => `Скидки 50% на ремонт квартир, подписывайтесь @remont_aktau_${r.int(10, 99)}`,
    () => `Займ онлайн без отказа, заработок от 20 000 в день ${phone()}`,
    () => `Сатамын: жаңа телефон, арзан, хабарласыңыз ${phone()}`,
    () => `Букмекер: ставки на спорт, бонус 100% t.me/bet_kz_${r.int(100, 999)}`,
  ]
  const GIBBERISH = ['ааааааааааааа', 'фывапролдж', 'ыыыыы', 'asdasdasd', '....', '123456', 'тест', 'проверка', 'jjjjjjjjjj', 'хз', '?????', 'апрол', 'qwerty']
  const CHATTER = ['Привет, как у вас дела?', 'Спасибо вам за работу!', 'Кто знает, во сколько открывается ЦОН?', 'Подскажите номер такси, пожалуйста', 'Сәлем, қалың қалай?', 'Хочу работать у вас, куда отправить резюме?', 'Когда будет концерт на набережной?']
  const kinds: Array<[SpamKind, number]> = [['advert', 0.3], ['gibberish', 0.26], ['resend', 0.22], ['chatter', 0.14], ['troll', 0.08]]
  for (const [kind, share] of kinds) {
    const count = Math.round(spamN * share)
    if (kind === 'troll') {
      // One phone sends six made-up reports within an hour.
      for (let made = 0; made < count && reports.length < o.reports;) {
        const who = r.pick(appSenders)
        let t = r.real(start, end - H)
        for (let j = 0; j < 6 && made < count && reports.length < o.reports; j++, made++) {
          const fake = problems[r.int(0, problems.length - 1)]!
          const b = anyBuilding()
          t += r.real(3, 9) * 60_000
          const w = writeReport(city, r, { ...fake, anchor: b.i, lat: b.lat, lon: b.lon }, b, who.lang, 'APP', null, t)
          reports.push({ id: reports.length, at: t, problem: null, spam: 'troll', channel: 'APP', lang: who.lang, text: w.text, resident: who.i, lat: null, lon: null, photo: true, building: b.i, style: 'troll' })
        }
      }
      continue
    }
    for (let k = 0; k < count && reports.length < o.reports; k++) {
      if (kind === 'resend' && genuineApp.length) {
        // The same person sends the same words again a few minutes later.
        const orig = r.pick(genuineApp)
        reports.push({ ...orig, id: reports.length, at: Math.min(end - 30_000, orig.at + r.real(2, 50) * 60_000), spam: 'resend', style: 'resend' })
        continue
      }
      const who = r.pick(appSenders)
      const home = city.buildings[who.building]!
      const text = kind === 'advert' ? r.pick(ADS)() : kind === 'gibberish' ? r.pick(GIBBERISH) : r.pick(CHATTER)
      const gps = kind === 'chatter' && r.chance(0.5)
      reports.push({ id: reports.length, at: r.real(start, end), problem: null, spam: kind, channel: 'APP', lang: who.lang, text, resident: who.i, lat: gps ? home.lat : null, lon: gps ? home.lon : null, photo: false, building: home.i, style: kind })
    }
  }
  while (reports.length < o.reports) {
    // Rounding: top up with ordinary resends.
    const orig = r.pick(genuineApp)
    reports.push({ ...orig, id: reports.length, at: Math.min(end - 30_000, orig.at + r.real(2, 50) * 60_000), spam: 'resend', style: 'resend' })
  }
  reports.sort((a, b) => a.at - b.at)
  reports.forEach((x, i) => { x.id = i })
  return { seed: o.seed, start, end, problems, reports, residents, residentsIn }
}

function shuffleCopy<T>(r: Rng, xs: T[]) { return r.shuffle([...xs]) }
const inCity = (city: PilotCity, i: number) => { const a = city.buildings[i]!.area_id; return !!a && city.areaById.has(a) }

/** One message about a problem, as a resident (or a 109 operator taking a call) writes it. */
function writeReport(city: PilotCity, r: Rng, p: Problem, b: PilotBuilding, lang: Lang | 'mixed', channel: Channel, res: Resident | null, at: number): { text: string; lat: number | null; lon: number | null; style: string } {
  const s = SPECS[p.key]
  const L: Lang = lang === 'mixed' ? r.pick(['ru', 'kk'] as const) : lang
  const d = city.areaById.get(b.area_id!)!.designator
  const hours = Math.max(0, (at - p.start) / 3600_000)
  const local = new Date(at + 5 * 3600_000)
  const what = r.pick(WHAT[p.key][L])
  const styles: string[] = [lang]
  const home = s.where === 'home' && p.key !== 'gas'
  const neigh = home && (p.zone.kind === 'buildings' || p.zone.kind === 'areas') && r.chance(0.35)
    ? r.pick((p.zone.kind === 'areas' && r.chance(0.6) ? WHOLE_AREA : NEIGH)[L]) : ''
  const extra = r.pick(EXTRA[L])
  // Mixed: Russian address, Kazakh words (or the other way round).
  const placeLang: Lang = lang === 'mixed' ? (L === 'kk' ? 'ru' : 'kk') : L
  let lat: number | null = null, lon: number | null = null
  let core: string
  if (channel === 'APP' && res && r.chance(0.12)) {
    // No address typed: the phone shares its location.
    const at2 = home && res.building === b.i ? { lat: b.lat, lon: b.lon } : { lat: p.lat, lon: p.lon }
    const j = r.real(5, 35), th = r.real(0, 2 * Math.PI)
    lat = at2.lat + (j * Math.cos(th)) / 110_574
    lon = at2.lon + (j * Math.sin(th)) / 80_500
    core = `${cap(what)}${since(L, hours, r, local)}.${neigh}${extra}`
    styles.push('gps_only')
  } else if (channel === 'APP' && res && home && res.building === b.i && r.chance(0.2)) {
    // "At my home" button: the saved address is appended in the app's format.
    const w = /^\d/.test(d) ? ` ${placeLang === 'kk' ? 'ш/а' : placeLang === 'en' ? 'mkr' : 'мкр'}` : ''
    const btn = placeLang === 'kk' ? `${d}${w}, ${b.house} үй` : placeLang === 'en' ? `${d}${w}, house ${b.house}` : `${d}${w}, дом ${b.house}`
    core = `${cap(what)}${since(L, hours, r, local)}${neigh ? `.${neigh}` : ''}, ${btn}`
    styles.push('home_button')
  } else if (home) {
    const addr = homeAddress(d, b.house, placeLang, r)
    core = r.weighted([
      [`${r.pick(GREET[L])}${addr}, ${what}${since(L, hours, r, local)}.${neigh}${extra}`, 5],
      [`${cap(what)} ${addr}${since(L, hours, r, local)}.${neigh}${extra}`, 3],
      [`${addr} ${what}`, 2],
      [L === 'ru' && OBJ[p.key] ? `Когда дадут ${OBJ[p.key] === 'воды' ? 'воду' : OBJ[p.key] === 'света' ? 'свет' : OBJ[p.key]}? ${addr}` : `${addr}, ${what}`, 1],
    ] as const)
  } else {
    const addr = nearAddress(d, b.house, placeLang, r)
    const duration = p.key === 'streetlight' || p.key === 'garbage' || p.key === 'road' ? (hours > 48 ? r.pick([' уже неделю', ' который день', ' третий день', '']) : '') : ''
    core = r.weighted([
      [`${r.pick(GREET[L])}${cap(addr)} ${what}${L === 'ru' ? duration : ''}.${extra}`, 5],
      [`${cap(what)}, ${addr}.${extra}`, 3],
      [`${cap(addr)}: ${what}`, 1],
    ] as const)
  }
  let text = core.replace(/\.\./g, '.').replace(/\s+/g, ' ').trim()
  if (channel === 'PHONE' && r.chance(0.4)) {
    text = L === 'kk'
      ? `Оператор: 109, тыңдаймын.\nТұрғын: ${text}\nОператор: Өтініш қабылданды.`
      : `Оператор: 109, слушаю.\nЖитель: ${text}\nОператор: ${r.pick(['Заявку приняли, номер сообщу по SMS.', 'Спасибо, зарегистрировано.', 'Передаём ответственной службе.'])}`
    styles.push('call_transcript')
  }
  const n = noisy(text, r, channel !== 'PHONE' && channel !== 'KOMEK109')
  return { text: n.text, lat, lon, style: [...styles, ...n.style].join(' ') }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Buildings inside a problem's real zone. */
export function zoneBuildings(city: PilotCity, z: TruthZone): number[] {
  switch (z.kind) {
    case 'buildings': return z.buildings
    case 'household': return [z.building]
    case 'areas': return z.areas.flatMap((a) => city.buildingsIn.get(a) ?? [])
    case 'radius': return city.grid.within(z.lat, z.lon, z.radius)
  }
}

/** App users the problem really affects. */
export function zoneUsers(city: PilotCity, residentsIn: Map<number, number[]>, z: TruthZone): number[] {
  if (z.kind === 'household') return z.residents
  return zoneBuildings(city, z).flatMap((b) => residentsIn.get(b) ?? [])
}

export { metresBetween }
