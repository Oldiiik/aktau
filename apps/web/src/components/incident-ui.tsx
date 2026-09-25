'use client'
// Shared presentation for 109 incidents: the resident-facing vocabulary
// (status, priority and why, affected area, who said what), and the two
// questions residents answer: "does this affect you too?" and "is it fixed?".
import Link from 'next/link'
import { useRef, useState } from 'react'
import { etaWords } from '@aktau/city-core/civic'
import { SERVICE_META, incidentTitle, type IncidentService } from '@aktau/city-core/incidents'
import type { IncidentDTO } from '@aktau/server'
import type { Lang } from '@aktau/types'
import { plural } from '@/lib/plural'
import { preparePhoto, type PhotoUpload } from '@/lib/photo'
import { useApp, type L3 } from './app'
import { Badge, Button, Icon, type BadgeTone, type IconName } from './primitives'

export type IncidentLite = Omit<IncidentDTO, 'evidence' | 'response_text'> & { evidence_count?: number }

export const SERVICE_ICON: Record<IncidentService, IconName> = {
  water: 'water', hot_water: 'water', electricity: 'power', heating: 'flame', gas: 'gas', streetlight: 'lamp', garbage: 'trash', road: 'roads',
  sewer: 'sewer', elevator: 'elevator', building_safety: 'building', yard: 'tree', transport: 'bus', other: 'alert',
}

export const CHANNEL: Record<string, { icon: IconName; label: string }> = {
  PHONE: { icon: 'phone', label: '109 call' }, WHATSAPP: { icon: 'chat', label: 'WhatsApp' }, INSTAGRAM: { icon: 'instagram', label: 'Instagram' },
  KOMEK109: { icon: 'report', label: 'Komek 109' }, APP: { icon: 'lighthouse', label: 'Aktau app' },
}

/** What residents read. Internally the 109 pipeline has more steps; residents see these. */
export const STATUS: Record<string, { label: L3; tone: BadgeTone; step: number }> = {
  NEW: { label: { en: 'Being confirmed', ru: 'Подтверждается', kk: 'Расталуда' }, tone: 'unknown', step: 0 },
  ROUTED: { label: { en: 'Assigned', ru: 'Назначено', kk: 'Тағайындалды' }, tone: 'planned', step: 1 },
  ACCEPTED: { label: { en: 'Accepted by the team', ru: 'Принято исполнителем', kk: 'Орындаушы қабылдады' }, tone: 'planned', step: 2 },
  IN_PROGRESS: { label: { en: 'In progress', ru: 'В работе', kk: 'Жұмыста' }, tone: 'planned', step: 3 },
  EVIDENCE_SUBMITTED: { label: { en: 'Awaiting residents’ check', ru: 'Ожидает проверки', kk: 'Тексеруді күтуде' }, tone: 'official', step: 4 },
  RESOLVED: { label: { en: 'Resolved', ru: 'Решено', kk: 'Шешілді' }, tone: 'resolved', step: 5 },
  VERIFIED: { label: { en: 'Resolved · verified', ru: 'Решено · подтверждено', kk: 'Шешілді · расталды' }, tone: 'resolved', step: 5 },
  DISPUTED: { label: { en: 'Reopened', ru: 'Снова открыто', kk: 'Қайта ашылды' }, tone: 'active', step: 3 },
  REJECTED: { label: { en: 'Closed', ru: 'Закрыто', kk: 'Жабылды' }, tone: 'neutral', step: 0 },
}

export const STEPS: L3[] = [
  { en: 'Reported', ru: 'Сообщено', kk: 'Хабарланды' },
  { en: 'Assigned', ru: 'Назначено', kk: 'Тағайындалды' },
  { en: 'Accepted', ru: 'Принято', kk: 'Қабылданды' },
  { en: 'In progress', ru: 'В работе', kk: 'Жұмыста' },
  { en: 'Check', ru: 'Проверка', kk: 'Тексеру' },
  { en: 'Resolved', ru: 'Решено', kk: 'Шешілді' },
]

export const PRIORITY: Record<string, { label: L3; cls: string }> = {
  CRITICAL: { label: { en: 'Critical', ru: 'Критический', kk: 'Сыни' }, cls: 'bg-red text-bg' },
  HIGH: { label: { en: 'High', ru: 'Высокий', kk: 'Жоғары' }, cls: 'bg-amber-soft text-amber' },
  NORMAL: { label: { en: 'Medium', ru: 'Средний', kk: 'Орташа' }, cls: 'bg-surface-2 text-secondary hairline' },
  LOW: { label: { en: 'Low', ru: 'Низкий', kk: 'Төмен' }, cls: 'bg-surface-2 text-faint hairline' },
}

export const REASON: Record<string, L3> = {
  same_service: { en: 'same service', ru: 'та же служба', kk: 'сол қызмет' },
  related_service: { en: 'related service', ru: 'смежная служба', kk: 'ұқсас қызмет' },
  same_building: { en: 'same building', ru: 'тот же дом', kk: 'сол үй' },
  same_area: { en: 'same area', ru: 'тот же микрорайон', kk: 'сол шағын аудан' },
  adjacent_area: { en: 'next district', ru: 'соседний микрорайон', kk: 'көрші аудан' },
  location_unknown: { en: 'location unclear', ru: 'адрес неясен', kk: 'мекенжай анық емес' },
  overlapping_time: { en: 'overlapping time', ru: 'совпадает время', kk: 'уақыты сәйкес' },
  recent: { en: 'recent', ru: 'недавно', kk: 'жақында' },
  very_close: { en: 'within 150 m', ru: 'в пределах 150 м', kk: '150 м ішінде' },
  far_apart: { en: 'far apart', ru: 'далеко друг от друга', kk: 'алыс' },
  different_problem: { en: 'different kind of problem', ru: 'другой вид проблемы', kk: 'басқа мәселе' },
  similar_wording: { en: 'similar description', ru: 'похожее описание', kk: 'ұқсас сипаттама' },
  same_session: { en: 'same event', ru: 'то же мероприятие', kk: 'сол іс-шара' },
  same_place: { en: 'same place', ru: 'то же место', kk: 'сол орын' },
  adjacent_far: { en: 'next district, far from the outage', ru: 'соседний микрорайон, далеко от отключения', kk: 'көрші аудан, алыс' },
  across_border: { en: 'metres away across a district border', ru: 'рядом, через границу микрорайона', kk: 'аудан шекарасының арғы жағында, жақын' },
  still_open: { en: 'still not fixed', ru: 'ещё не устранено', kk: 'әлі жөнделмеген' },
  unclassified: { en: 'not classified yet', ru: 'ещё не классифицировано', kk: 'әлі жіктелмеген' },
  // risks
  fall_hazard: { en: 'may fall on people', ru: 'может упасть на людей', kk: 'адамдарға құлауы мүмкін' },
  electrical_hazard: { en: 'live wires', ru: 'оголённые провода', kk: 'ашық сымдар' },
  gas_smell: { en: 'smell of gas', ru: 'запах газа', kk: 'газ иісі' },
  open_manhole: { en: 'open manhole', ru: 'открытый люк', kk: 'ашық люк' },
  flooding: { en: 'flooding', ru: 'затопление', kk: 'су басу' },
  children: { en: 'children affected', ru: 'касается детей', kk: 'балаларға қатысты' },
  vulnerable: { en: 'elderly / disabled', ru: 'пожилые / маломобильные', kk: 'қарттар / мүмкіндігі шектеулі' },
  cold: { en: 'cold at home', ru: 'холодно дома', kk: 'үйде суық' },
  long_outage: { en: 'over 12 hours', ru: 'дольше 12 часов', kk: '12 сағаттан ұзақ' },
  // missing
  service: { en: 'what exactly is wrong', ru: 'что именно случилось', kk: 'не болғаны' },
  address: { en: 'address', ru: 'адрес', kk: 'мекенжай' },
  house: { en: 'house number', ru: 'номер дома', kk: 'үй нөмірі' },
  start_time: { en: 'when it started', ru: 'когда началось', kk: 'қашан басталды' },
  neighbours: { en: 'do neighbours have it too?', ru: 'у соседей так же?', kk: 'көршілерде де солай ма?' },
  // sla
  awaiting_operator: { en: 'awaiting operator', ru: 'ждёт оператора', kk: 'операторды күтуде' },
  accept_overdue: { en: 'not accepted in 120 min', ru: 'не принято за 120 мин', kk: '120 минутта қабылданбады' },
  resolve_overdue: { en: 'past resolution target', ru: 'срок решения истёк', kk: 'шешу мерзімі өтті' },
  commitment_overdue: { en: 'team deadline passed', ru: 'срок исполнителя истёк', kk: 'орындаушы мерзімі өтті' },
  deadline_near: { en: 'deadline near', ru: 'срок на исходе', kk: 'мерзім таяу' },
  not_accepted: { en: 'executor silent', ru: 'исполнитель молчит', kk: 'орындаушы үнсіз' },
  returned_before: { en: 'returned before', ru: 'уже возвращалось', kk: 'бұрын қайтарылған' },
  missing_evidence: { en: 'no evidence yet', ru: 'нет доказательств', kk: 'дәлел жоқ' },
  executor_rework_rate: { en: 'executor often reworks', ru: 'частые доработки', kk: 'жиі қайта өңдеу' },
  signals_growing: { en: 'reports growing', ru: 'обращения растут', kk: 'өтініштер көбеюде' },
  disputed_by_residents: { en: 'residents dispute', ru: 'жители оспаривают', kk: 'тұрғындар келіспейді' },
  awaiting_verification: { en: 'residents are checking', ru: 'жители проверяют', kk: 'тұрғындар тексеруде' },
}

export const CHECK: Record<string, L3> = {
  what_done: { en: 'What exactly was done', ru: 'Что конкретно сделано', kk: 'Нақты не істелді' },
  date: { en: 'Date and time', ru: 'Дата и время', kk: 'Күні мен уақыты' },
  result: { en: 'Result', ru: 'Результат', kk: 'Нәтиже' },
  addresses_complaint: { en: 'Answers the original complaint', ru: 'Ответ на исходную жалобу', kk: 'Бастапқы шағымға жауап' },
  cause: { en: 'Cause explained', ru: 'Указана причина', kk: 'Себебі көрсетілген' },
  evidence: { en: 'Supporting evidence', ru: 'Подтверждающие материалы', kk: 'Растайтын материалдар' },
  language: { en: 'Language of the appeal', ru: 'Язык обращения', kk: 'Өтініш тілі' },
  appeal_right: { en: 'Right to appeal explained', ru: 'Разъяснено право обжалования', kk: 'Шағымдану құқығы түсіндірілген' },
  after_present: { en: 'After photo', ru: 'Фото «после»', kk: '«Кейін» фотосы' },
  before_after: { en: 'Before and after', ru: 'До и после', kk: 'Дейін және кейін' },
  geo_match: { en: 'Location matches', ru: 'Геопозиция совпадает', kk: 'Орны сәйкес' },
  after_open: { en: 'Taken after the report', ru: 'Снято после обращения', kk: 'Өтініштен кейін түсірілген' },
  photos_differ: { en: 'Photos actually differ', ru: 'Фото действительно разные', kk: 'Фотолар шынымен әртүрлі' },
  shows_light_on: { en: 'Shows the light working', ru: 'Видно, что свет горит', kk: 'Жарық жанып тұрғаны көрінеді' },
  address_clarified: { en: 'Address clarified', ru: 'Адрес уточнён', kk: 'Мекенжай нақтыланды' },
  category_matches: { en: 'Category matches the call', ru: 'Категория совпадает', kk: 'Санат сәйкес' },
  number_given: { en: 'Request number given', ru: 'Сообщён номер заявки', kk: 'Өтініш нөмірі айтылды' },
  language_matches: { en: 'Answered in caller’s language', ru: 'Ответ на языке звонящего', kk: 'Қоңырау шалушы тілінде' },
  risk_asked: { en: 'Asked about danger', ru: 'Уточнена опасность', kk: 'Қауіп нақтыланды' },
}

/** Where a fact came from. An AI guess is never shown as official. */
export const SOURCE: Record<string, L3> = {
  resident: { en: 'Resident', ru: 'Житель', kk: 'Тұрғын' },
  '109': { en: '109', ru: '109', kk: '109' },
  official: { en: 'Official notice', ru: 'Официально', kk: 'Ресми' },
  operator: { en: '109 operator', ru: 'Оператор 109', kk: '109 операторы' },
  organization: { en: 'Responsible team', ru: 'Исполнитель', kk: 'Орындаушы' },
  automated: { en: 'Automatic', ru: 'Автоматически', kk: 'Автоматты' },
  ai: { en: 'AI suggestion', ru: 'Подсказка ИИ', kk: 'ЖИ ұсынысы' },
}

/** "Жители" for steps that sum up many residents (confirmations, the verification result). */
export function sourceLabel(x: { kind: string; source: string }): L3 {
  if (x.source === 'resident' && ['confirmed', 'verified', 'disputed', 'signals'].includes(x.kind)) return { en: 'Residents', ru: 'Жители', kk: 'Тұрғындар' }
  return SOURCE[x.source] ?? SOURCE.automated!
}

export function serviceName(lang: Lang, s: IncidentService) { return SERVICE_META[s].label[lang] }
export function incidentName(lang: Lang, s: IncidentService) { return SERVICE_META[s].outage[lang] }

/** The title residents read: a staff-written title, else "Течь воды" / "Нет света" from the problem itself. */
export function incidentHeading(lang: Lang, i: { service: IncidentService; public_title?: string | null; problem_kind?: string | null; kind?: string | null; risk_flags?: string[] }) {
  return i.public_title || incidentTitle(i.service, lang, (i.problem_kind ?? i.kind ?? null) as never, i.risk_flags ?? [])
}

export function placeText(lang: Lang, i: { designator: string | null; house?: string | null; houses?: string[] }) {
  if (!i.designator) return lang === 'en' ? 'Aktau' : 'Актау'
  const mkr = /^\d/.test(i.designator) ? `${i.designator} ${lang === 'en' ? 'mkr' : lang === 'ru' ? 'мкр' : 'ш/а'}` : i.designator
  const houses = [...new Set(i.houses?.length ? i.houses : i.house ? [i.house] : [])].sort((a, b) => parseInt(a) - parseInt(b))
  if (!houses.length) return mkr
  const hw = lang === 'en' ? (houses.length > 1 ? 'houses' : 'house') : lang === 'ru' ? (houses.length > 1 ? 'дома' : 'дом') : 'үй'
  return `${mkr} · ${hw} ${houses.length > 4 ? `${houses.slice(0, 4).join(', ')} +${houses.length - 4}` : houses.join(', ')}`
}

/** "Where": the session venue for a live demo, else the address. */
export function whereText(lang: Lang, i: { designator: string | null; house?: string | null; location_text?: string | null; demo_session_id?: string | null }) {
  if (i.demo_session_id) return i.location_text ?? (lang === 'en' ? 'Demo session' : 'Демо-сессия')
  return placeText(lang, { designator: i.designator, house: i.house })
}

export function metresText(lang: Lang, m: number) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} ${lang === 'en' ? 'm' : 'м'}`
  return `${(m / 1000).toFixed(1).replace('.', lang === 'en' ? '.' : ',')} ${lang === 'en' ? 'km' : 'км'}`
}

/** "Затрагивает 4 дома", "в радиусе 150 м", "весь 14 мкр" … */
export function scopeText(lang: Lang, i: Pick<IncidentLite, 'scope_kind' | 'scope_radius_m' | 'scope_houses' | 'scope_areas' | 'scope_buildings'>) {
  const houses = (n: number) => plural(lang, n, { en: ['house', 'houses'], ru: ['дом', 'дома', 'домов'], kk: 'үй' })
  const affects = { en: 'Affects', ru: 'Затрагивает', kk: 'Қамтиды' }[lang]
  switch (i.scope_kind) {
    case 'city': return { en: 'The whole city', ru: 'Весь город', kk: 'Бүкіл қала' }[lang]
    case 'demo_session': return { en: 'Everyone in this demo session', ru: 'Участники этой демо-сессии', kk: 'Осы демо-сессияның қатысушылары' }[lang]
    case 'area': case 'areas': return i.scope_areas.length
      ? `${affects} ${lang === 'en' ? 'mkr' : lang === 'ru' ? 'весь' : ''} ${i.scope_areas.join(', ')}${lang === 'en' ? ' (whole)' : lang === 'ru' ? ' мкр' : ' ш/а толық'}`.replace(/\s+/g, ' ')
      : { en: 'A microdistrict', ru: 'Микрорайон', kk: 'Шағын аудан' }[lang]
    case 'building': case 'buildings': {
      // "Only in my flat", or the house not known yet: nobody else is told until someone else reports.
      if (!i.scope_houses.length && !i.scope_buildings) return { en: 'Only the reporter so far', ru: 'Пока только у заявителя', kk: 'Әзірге тек өтініш берушіде' }[lang]
      const n = i.scope_houses.length || i.scope_buildings
      const list = i.scope_houses.length && i.scope_houses.length <= 6 ? ` (${i.scope_houses.join(', ')})` : ''
      return `${affects} ${n} ${houses(n)}${list}`
    }
    case 'radius': return `${{ en: 'Within', ru: 'В радиусе', kk: 'Радиусы' }[lang]} ${i.scope_radius_m ?? 150} ${lang === 'en' ? 'm' : 'м'}${i.scope_buildings ? ` · ${i.scope_buildings} ${houses(i.scope_buildings)}` : ''}`
    case 'road': case 'polygon': return { en: 'An area on the map', ru: 'Участок на карте', kk: 'Картадағы аумақ' }[lang]
    default: return { en: 'Area being clarified', ru: 'Зона уточняется', kk: 'Аумақ нақтылануда' }[lang]
  }
}

/** "23 жителя подтвердили проблему". Residents = reports (not staff) + confirmations. */
export function residentsText(lang: Lang, n: number, short = false) {
  if (short) return `${n} ${plural(lang, n, { en: ['resident', 'residents'], ru: ['житель', 'жителя', 'жителей'], kk: 'тұрғын' })}`
  return `${n} ${plural(lang, n, { en: ['resident confirmed', 'residents confirmed'], ru: ['житель подтвердил', 'жителя подтвердили', 'жителей подтвердили'], kk: 'тұрғын растады' })}`
}

const ruInstr = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'жителем' : 'жителями')
const ruHours = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'часа' : 'часов')

/** Why this priority, in words a resident can check. */
export function priorityWhy(lang: Lang, r: { key: string; n?: number }): string {
  const n = r.n ?? 0
  const T: Record<string, L3> = {
    danger: { en: 'a danger to people', ru: 'угроза безопасности людей', kk: 'адамдарға қауіпті' },
    gas_smell: { en: 'smell of gas: dangerous', ru: 'запах газа: опасно', kk: 'газ иісі: қауіпті' },
    open_manhole: { en: 'open manhole: people can fall in', ru: 'открытый люк: люди могут упасть', kk: 'ашық люк: адамдар құлауы мүмкін' },
    fall_hazard: { en: 'something may fall on people', ru: 'может упасть на людей', kk: 'адамдарға құлауы мүмкін' },
    electrical_hazard: { en: 'live wires', ru: 'оголённые провода', kk: 'ашық сымдар' },
    service_water: { en: 'affects the water supply', ru: 'затрагивает водоснабжение', kk: 'сумен жабдықтауға қатысты' },
    service_electricity: { en: 'affects the power supply', ru: 'затрагивает электроснабжение', kk: 'электрмен жабдықтауға қатысты' },
    service_heating: { en: 'affects heating', ru: 'затрагивает отопление', kk: 'жылумен жабдықтауға қатысты' },
    service_gas: { en: 'affects the gas supply', ru: 'затрагивает газоснабжение', kk: 'газбен жабдықтауға қатысты' },
    residents: { en: `confirmed by ${n} residents`, ru: `подтверждено ${n} ${ruInstr(n)}`, kk: `${n} тұрғын растады` },
    duration: n >= 24
      ? { en: `going on for over ${Math.floor(n / 24)} day${n >= 48 ? 's' : ''}`, ru: `продолжается более ${Math.floor(n / 24)} суток`, kk: `${Math.floor(n / 24)} тәуліктен астам` }
      : { en: `going on for over ${n} hour${n === 1 ? '' : 's'}`, ru: `продолжается более ${n} ${ruHours(n)}`, kk: `${n} сағаттан астам` },
    buildings: { en: `affects ${n} houses`, ru: `затрагивает ${n} ${plural('ru', n, { en: ['', ''], ru: ['дом', 'дома', 'домов'], kk: '' })}`, kk: `${n} үйді қамтиды` },
    whole_area: { en: 'the whole microdistrict', ru: 'весь микрорайон', kk: 'бүкіл шағын аудан' },
    areas: { en: `${n} microdistricts`, ru: `${n} ${plural('ru', n, { en: ['', ''], ru: ['микрорайон', 'микрорайона', 'микрорайонов'], kk: '' })}`, kk: `${n} шағын аудан` },
    whole_city: { en: 'the whole city', ru: 'весь город', kk: 'бүкіл қала' },
    recurring: { en: 'the problem keeps coming back', ru: 'проблема повторяется', kk: 'мәселе қайталанады' },
    near_school: { en: 'next to a school or kindergarten', ru: 'рядом школа или детский сад', kk: 'жанында мектеп не балабақша' },
    near_hospital: { en: 'next to a hospital', ru: 'рядом больница', kk: 'жанында аурухана' },
    children: { en: 'children are affected', ru: 'касается детей', kk: 'балаларға қатысты' },
    vulnerable: { en: 'elderly or disabled people affected', ru: 'касается пожилых и маломобильных', kk: 'қарттарға қатысты' },
    flooding: { en: 'flooding', ru: 'затопление', kk: 'су басу' },
    cold: { en: 'cold at home', ru: 'холодно дома', kk: 'үйде суық' },
    official_notice: { en: 'announced officially as planned work', ru: 'объявлено официально как плановые работы', kk: 'жоспарлы жұмыс ретінде ресми жарияланған' },
    operator: { en: 'set by a 109 operator', ru: 'установлен оператором 109', kk: '109 операторы белгіледі' },
  }
  const x = T[r.key]
  return x ? x[lang] ?? x.ru : r.key
}

/** The committed finish, for residents. Never our internal SLA target. */
export function etaLine(lang: Lang, iso: string | null, now = new Date()): string | null {
  if (!iso) return null
  const e = etaWords(lang, iso, now)
  if (e.overdue) return `${{ en: 'Expected by', ru: 'Ожидалось к', kk: 'Күтілген уақыт' }[lang]} ${e.when} · ${{ en: 'overdue', ru: 'срок прошёл', kk: 'мерзімі өтті' }[lang]}`
  return `${{ en: 'Expected', ru: 'Ожидаемое решение', kk: 'Күтілетін шешім' }[lang]}: ${e.rel ? `${e.rel} (${e.when.split(', ')[1]})` : e.when}`
}

export function duration(lang: Lang, minutes: number) {
  const m = Math.abs(Math.round(minutes))
  const h = Math.floor(m / 60), d = Math.floor(h / 24)
  const u = lang === 'en' ? { d: 'd', h: 'h', m: 'min' } : lang === 'ru' ? { d: 'д', h: 'ч', m: 'мин' } : { d: 'к', h: 'сағ', m: 'мин' }
  if (d >= 1) return `${d} ${u.d} ${h % 24} ${u.h}`
  if (h >= 1) return `${h} ${u.h} ${m % 60} ${u.m}`
  return `${m} ${u.m}`
}

type TL = { kind: string; message: string; source: string; data: Record<string, unknown> }
/** One resident-facing line per timeline step, in the reader's language (the stored message is the audit copy). */
export function timelineText(lang: Lang, x: TL): string {
  const d = x.data ?? {}
  const s = (k: string) => (d[k] == null ? '' : String(d[k]))
  const when = (iso: string) => (iso ? etaWords(lang, iso).when : '')
  const L = (en: string, ru: string, kk?: string) => (lang === 'en' ? en : lang === 'kk' ? kk ?? ru : ru)
  switch (x.kind) {
    case 'created': return x.source === '109' ? L('First report, through 109', 'Первое обращение, через 109', 'Алғашқы өтініш, 109 арқылы') : L('First report', 'Первое сообщение', 'Алғашқы хабар')
    case 'signal': return L(`One more report (${CHANNEL[s('channel')]?.label ?? s('channel')})`, `Ещё одно обращение (${CHANNEL[s('channel')]?.label ?? s('channel')})`)
    case 'signals': { const n = Number(d.n ?? 0); return lang === 'en' ? `${n} more reports of the same problem` : lang === 'kk' ? `Тағы ${n} өтініш` : `Ещё ${n} ${plural('ru', n, { en: ['', ''], ru: ['обращение', 'обращения', 'обращений'], kk: '' })} о той же проблеме` }
    case 'confirmed': return residentsText(lang, Number(d.n ?? 0))
    case 'official': return L(`Linked to an official notice: ${s('title')}`, `Связано с официальным уведомлением: ${s('title')}`)
    case 'recurrence': return L(`The same problem was fixed here before (${s('previous_code')})`, `Такую же проблему здесь уже устраняли (${s('previous_code')})`)
    case 'scope': return x.source === 'operator' ? L('109 set the affected area', 'Оператор 109 уточнил зону затрагивания') : L('Affected area determined', 'Определена зона затрагивания')
    case 'priority': return L(`Priority: ${PRIORITY[s('from')]?.label.en ?? s('from')} → ${PRIORITY[s('to')]?.label.en ?? s('to')}`, `Приоритет: ${PRIORITY[s('from')]?.label.ru ?? s('from')} → ${PRIORITY[s('to')]?.label.ru ?? s('to')}`)
    case 'routed': return L(`Responsible team assigned: ${s('team') || s('org')}`, `Назначен исполнитель: ${s('team') || s('org')}`, `Орындаушы тағайындалды: ${s('team') || s('org')}`)
    case 'accepted': return L('The team accepted the work', 'Работа принята исполнителем', 'Жұмысты орындаушы қабылдады')
    case 'deadline_set': return L(`Deadline: ${when(s('to'))}`, `Срок: ${when(s('to'))}`, `Мерзім: ${when(s('to'))}`)
    case 'deadline_changed': return L(`Deadline changed: ${when(s('from'))} → ${when(s('to'))}. Reason: ${s('reason')}`, `Срок изменён: ${when(s('from'))} → ${when(s('to'))}. Причина: ${s('reason')}`, `Мерзім өзгерді: ${when(s('from'))} → ${when(s('to'))}. Себебі: ${s('reason')}`)
    case 'returned': return L(`The team declined: “${s('reason')}”; back to 109`, `Исполнитель отказался: «${s('reason')}»; возвращено в 109`)
    case 'dispatched': return L('Work started', 'Работы начались', 'Жұмыс басталды')
    case 'completed': return L(`The team reports it is done: ${x.message}`, `Исполнитель сообщил о завершении: ${x.message}`, `Орындаушы аяқталғанын хабарлады: ${x.message}`)
    case 'evidence': return L('Photos of the work added', 'Добавлены фото работ', 'Жұмыс фотолары қосылды')
    case 'resolved': return s('reason') ? L(`109 closed it: ${s('reason')}`, `109 закрыла заявку: ${s('reason')}`) : L('109 closed the request', '109 закрыла заявку', '109 өтінішті жапты')
    case 'verified': return L(`Residents confirmed it is fixed: ${s('pct')}% (${s('yes')} of ${s('n')})`, `Жители подтвердили устранение: ${s('pct')}% (${s('yes')} из ${s('n')})`, `Тұрғындар растады: ${s('pct')}% (${s('n')}-нан ${s('yes')})`)
    case 'disputed': return L(`Reopened after residents checked: ${s('no')} of ${s('n')} say it is not fixed`, `Проблема повторно открыта после проверки жителей: ${s('no')} из ${s('n')} сообщили, что не устранено`, `Тұрғындар тексергеннен кейін қайта ашылды`)
    case 'reopened': return L(`109 reopened it: ${s('reason')}`, `109 открыла заново: ${s('reason')}`)
    case 'rejected': return L(`Closed: ${x.message}`, `Закрыто: ${x.message}`)
    case 'merged': return L(`${s('from')} merged into this incident`, `${s('from')} объединено с этой проблемой`)
    case 'merged_into': return L(`Merged into ${s('into')}`, `Объединено с ${s('into')}`)
    case 'escalated': return L(`Escalated: ${s('reason')}`, `Эскалация: ${s('reason')}`)
    case 'reroute_hint': return L(`Reports now come from ${s('houses')} houses: this looks like the network (${s('org')}). Re-route?`, `Сообщения уже из ${s('houses')} домов: похоже на сеть (${s('org')}). Переназначить?`, `Хабарлар ${s('houses')} үйден келіп жатыр: желі сияқты (${s('org')}). Қайта тағайындау керек пе?`)
    default: return x.message
  }
}

export function SlaChip({ sla }: { sla: IncidentDTO['sla'] }) {
  const { lang, tx } = useApp()
  if (sla.level === 'done' || sla.minutes_left == null) return null
  const tone = sla.level === 'breached' ? 'bg-red text-bg' : sla.level === 'at_risk' ? 'bg-red-soft text-red' : sla.level === 'watch' ? 'bg-amber-soft text-amber' : 'bg-green-soft text-green'
  const text = sla.minutes_left < 0 ? `${tx({ en: 'Overdue', ru: 'Просрочено', kk: 'Кешікті' })} ${duration(lang, sla.minutes_left)}`
    : `${duration(lang, sla.minutes_left)} ${tx({ en: 'left', ru: 'осталось', kk: 'қалды' })}`
  return (
    <span className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-bold ${tone}`} suppressHydrationWarning>
      <Icon name="timer" size={12} /> <span className="t-mono">{text}</span>
    </span>
  )
}

export function PriorityChip({ level, className = '' }: { level: string; className?: string }) {
  const { tx } = useApp()
  const p = PRIORITY[level] ?? PRIORITY.NORMAL!
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold whitespace-nowrap ${p.cls} ${className}`}>{tx(p.label)}</span>
}

/** Reported → Assigned → Accepted → In progress → Check → Resolved. */
export function Pipeline({ status, compact = false }: { status: string; compact?: boolean }) {
  const { tx } = useApp()
  const cur = STATUS[status]?.step ?? 0
  const disputed = status === 'DISPUTED'
  const done = (i: number) => i < cur || ((status === 'VERIFIED' || status === 'RESOLVED') && i <= cur)
  const label = STATUS[status]?.label ?? STEPS[Math.min(cur, STEPS.length - 1)]!
  return (
    <div className="flex w-full flex-col gap-2">
      <ol className={`flex w-full items-start ${compact ? 'gap-1' : 'gap-1.5'}`} aria-label="Progress">
        {STEPS.map((s, i) => {
          const now = i === cur && !done(i)
          return (
            <li key={i} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={now ? 'step' : undefined}>
              <span className={`h-1.5 rounded-full transition-colors duration-500 ${done(i) ? 'bg-green' : now ? (disputed ? 'bg-red' : 'bg-blue') : 'bg-line'}`} />
              {/* Wide screens name every step; phones name only the current one (below). */}
              {!compact ? <span className={`hidden truncate text-[11px] font-[600] md:block ${now ? 'text-text' : done(i) ? 'text-secondary' : 'text-faint'}`}>{tx(s)}</span> : null}
            </li>
          )
        })}
      </ol>
      {!compact ? (
        <p className="flex items-baseline justify-between gap-3 text-[13px] md:hidden">
          <span className="font-[600] text-text">{tx(label)}</span>
          <span className="t-mono text-faint">{Math.min(cur + 1, STEPS.length)} / {STEPS.length}</span>
        </p>
      ) : null}
    </div>
  )
}

export function ChannelStack({ channels, max = 4 }: { channels: Record<string, number>; max?: number }) {
  const list = Object.entries(channels).sort((a, b) => b[1] - a[1]).slice(0, max)
  return (
    <span className="flex -space-x-1.5">
      {list.map(([c]) => (
        <span key={c} title={CHANNEL[c]?.label} className="grid size-6 place-items-center rounded-full bg-surface ring-2 ring-surface hairline">
          <Icon name={CHANNEL[c]?.icon ?? 'report'} size={12} className="text-secondary" />
        </span>
      ))}
    </span>
  )
}

type ConfirmReply = { confirm_count: number; state: string }

async function postConfirm(id: string, body: Record<string, unknown>): Promise<{ ok: true; r: ConfirmReply } | { ok: false; code: string; message: string }> {
  try {
    const res = await fetch(`/api/incidents/${id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, code: d.error?.code ?? 'error', message: d.error?.message ?? 'Failed' }
    return { ok: true, r: d as ConfirmReply }
  } catch {
    return { ok: false, code: 'offline', message: 'offline' }
  }
}

/**
 * "Does this affect you too?" One confirmation per person (not a like): the
 * server records who, when and where; "No" is remembered so we do not ask again.
 */
export function ConfirmButtons({ id, onDone, size = 'md', yes, no, note, photo }: {
  id: string; onDone?: (state: 'confirmed' | 'not_affected', r?: ConfirmReply) => void; size?: 'md' | 'sm'
  yes?: L3; no?: L3; note?: string | null; photo?: PhotoUpload | null
}) {
  const { tx } = useApp()
  const [state, setState] = useState<'idle' | 'busy' | 'confirmed' | 'not_affected'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const send = async (s: 'confirmed' | 'not_affected') => {
    setState('busy'); setErr(null)
    const r = await postConfirm(id, { state: s, note: note ?? null, photo: photo ?? null })
    if (r.ok) { setState(s); onDone?.(s, r.r); return }
    if (r.code === 'already_reported') { setState('confirmed'); onDone?.('confirmed'); return }
    setState('idle')
    setErr(r.code === 'resolved' ? tx({ en: 'It is marked as fixed. If it is back, report that it returned.', ru: 'Отмечено как решённое. Если проблема вернулась, сообщите об этом.', kk: 'Шешілді деп белгіленген.' }) : tx({ en: 'Could not send. Try again.', ru: 'Не удалось отправить. Попробуйте ещё раз.', kk: 'Жіберу мүмкін болмады.' }))
  }
  if (state === 'confirmed') return <p className="fade-in flex items-center gap-2 t-row text-green"><Icon name="check" size={17} />{tx({ en: 'Confirmed. You will get every update.', ru: 'Вы подтвердили. Все обновления придут вам.', kk: 'Растадыңыз. Барлық жаңалық келеді.' })}</p>
  if (state === 'not_affected') return <p className="fade-in t-sub text-secondary">{tx({ en: 'Noted: it does not affect you.', ru: 'Учтено: вас это не затрагивает.', kk: 'Ескерілді: сізге қатысты емес.' })}</p>
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button size={size} disabled={state === 'busy'} onClick={() => send('confirmed')}><Icon name="people" size={size === 'sm' ? 16 : 18} />{tx(yes ?? { en: 'Yes, me too', ru: 'Да, я тоже столкнулся', kk: 'Иә, менде де' })}</Button>
        <Button size={size} full={false} style="outline" disabled={state === 'busy'} onClick={() => send('not_affected')}>{tx(no ?? { en: 'No', ru: 'Нет', kk: 'Жоқ' })}</Button>
      </div>
      {err ? <p className="t-meta text-red">{err}</p> : null}
    </div>
  )
}

/** "Me too" (map sheet, lists): the same confirmation, one button. */
export function MeTooButton({ incident, onDone, size = 'md' }: { incident: Pick<IncidentLite, 'id'>; homeHouse?: string | null; onDone?: () => void; size?: 'md' | 'sm' }) {
  const { tx } = useApp()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  return (
    <Button size={size} style={state === 'done' ? 'secondary' : 'primary'} disabled={state === 'busy' || state === 'done'} onClick={async () => {
      setState('busy')
      const r = await postConfirm(incident.id, { state: 'confirmed' })
      const ok = r.ok || r.code === 'already_reported'
      setState(ok ? 'done' : 'error')
      if (ok) onDone?.()
    }}>
      {state === 'done' ? <><Icon name="check" size={18} /> {tx({ en: 'Confirmed', ru: 'Подтверждено', kk: 'Расталды' })}</>
        : state === 'error' ? tx({ en: 'Try again', ru: 'Повторить', kk: 'Қайталау' })
        : <><Icon name="people" size={18} /> {tx({ en: 'Me too', ru: 'У меня тоже', kk: 'Менде де' })}</>}
    </Button>
  )
}

/** A 1–5 rating as a radio group (a stable component, so focus survives re-renders). */
function Stars({ v, set, label }: { v: number | null; set: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="t-sub text-secondary">{label}</span>
      <span className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={v === n} aria-label={`${n}`} onClick={() => set(n)}
            className={`tap grid size-9 place-items-center rounded-[11px] text-[13px] font-bold ${v != null && n <= v ? 'bg-blue text-on-blue' : 'bg-surface-2 text-secondary hairline'}`}>{n}</button>
        ))}
      </span>
    </div>
  )
}

type Answer = 'yes' | 'partial' | 'no'
const ANSWER: Record<Answer, { label: L3; style: 'primary' | 'outline' | 'danger' }> = {
  yes: { label: { en: 'Yes, fully', ru: 'Да, полностью', kk: 'Иә, толық' }, style: 'primary' },
  partial: { label: { en: 'Partly', ru: 'Частично', kk: 'Ішінара' }, style: 'outline' },
  no: { label: { en: 'No', ru: 'Нет', kk: 'Жоқ' }, style: 'outline' },
}

/**
 * "Is it really fixed?" Asked only of people who reported or confirmed it.
 * The answer counts at once; ratings, a comment and a photo are optional.
 */
export function VerifyButtons({ id, mine, onDone, size = 'md' }: { id: string; mine?: string | null; onDone?: (r: { outcome: string }) => void; size?: 'md' | 'sm' }) {
  const { tx } = useApp()
  const [answer, setAnswer] = useState<Answer | null>((mine as Answer) ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [quality, setQuality] = useState<number | null>(null)
  const [speed, setSpeed] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [photo, setPhoto] = useState<{ image: PhotoUpload; thumb: string } | null>(null)
  const [sent, setSent] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const send = async (a: Answer, extra: Record<string, unknown> = {}) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/incidents/${id}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: a, ...extra }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.error?.message ?? 'Failed'); return }
      setAnswer(a)
      onDone?.(d)
    } catch { setErr(tx({ en: 'Could not send. Try again.', ru: 'Не удалось отправить. Попробуйте ещё раз.', kk: 'Жіберу мүмкін болмады.' })) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
        {(['yes', 'partial', 'no'] as const).map((a) => (
          <Button key={a} size={size} style={answer === a ? (a === 'no' ? 'danger' : a === 'yes' ? 'primary' : 'secondary') : answer ? 'outline' : ANSWER[a].style}
            className={a === 'yes' ? 'col-span-2 sm:col-span-1' : ''} disabled={busy} onClick={() => void send(a)}>{a === 'yes' ? <Icon name="check" size={16} /> : null}{tx(ANSWER[a].label)}</Button>
        ))}
      </div>
      {answer ? (
        sent ? <p className="fade-in t-sub text-secondary">{tx({ en: 'Thank you. Your answer and rating are counted.', ru: 'Спасибо. Ваш ответ и оценка учтены.', kk: 'Рақмет. Жауабыңыз есептелді.' })}</p>
        : !more ? (
          <div className="fade-in flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 t-sub text-text"><Icon name="check" size={15} className="text-green" />{tx({ en: 'Your answer is counted.', ru: 'Ваш ответ учтён.', kk: 'Жауабыңыз есептелді.' })}</p>
            <button type="button" onClick={() => setMore(true)} className="tap t-meta font-bold text-blue">{tx({ en: 'Rate the work (optional)', ru: 'Оценить работу (необязательно)', kk: 'Жұмысты бағалау' })}</button>
          </div>
        ) : (
          <div className="fade-in flex flex-col gap-2.5 rounded-[16px] bg-surface-2 p-3 hairline">
            <Stars v={quality} set={setQuality} label={tx({ en: 'Quality', ru: 'Качество', kk: 'Сапасы' })} />
            <Stars v={speed} set={setSpeed} label={tx({ en: 'Speed', ru: 'Скорость', kk: 'Жылдамдығы' })} />
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} placeholder={tx({ en: 'Comment (optional)', ru: 'Комментарий (необязательно)', kk: 'Пікір (міндетті емес)' })}
              className="w-full resize-none rounded-[12px] bg-surface p-3 t-body text-text outline-none hairline placeholder:text-faint" />
            <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) try { setPhoto(await preparePhoto(f)) } catch { /* unreadable */ } }} />
            <div className="flex items-center gap-2">
              {photo ? <img src={photo.thumb} alt="" className="size-10 rounded-[10px] object-cover" /> : null}
              <button type="button" onClick={() => file.current?.click()} className="tap inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3 text-[12.5px] font-bold text-text hairline"><Icon name="camera" size={14} />{photo ? tx({ en: 'Change photo', ru: 'Другое фото', kk: 'Басқа фото' }) : tx({ en: 'Add a photo', ru: 'Добавить фото', kk: 'Фото қосу' })}</button>
              <span className="flex-1" />
              <Button size="sm" full={false} disabled={busy} onClick={async () => { await send(answer, { quality, speed, comment: comment.trim() || null, photo: photo?.image ?? null }); setSent(true) }}>{tx({ en: 'Send', ru: 'Отправить', kk: 'Жіберу' })}</Button>
            </div>
          </div>
        )
      ) : null}
      {err ? <p className="t-meta text-red">{err}</p> : null}
    </div>
  )
}

/** Compact incident card for Home, lists and the map sheet. */
export function IncidentCard({ i, href = true, children }: { i: IncidentLite; href?: boolean; children?: React.ReactNode }) {
  const { lang, tx } = useApp()
  const st = STATUS[i.status] ?? STATUS.NEW!
  const eta = ['ROUTED', 'ACCEPTED', 'IN_PROGRESS'].includes(i.status) ? etaLine(lang, i.commit_finish_at) : null
  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className={`grid size-11 flex-none place-items-center rounded-[14px] ${i.priority === 'CRITICAL' ? 'bg-red text-bg' : 'bg-surface-2 text-text hairline'}`}>
          <Icon name={SERVICE_ICON[i.service]} size={22} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="t-mono text-[11px] font-semibold text-faint">{i.code}</span>
            {i.is_demo ? <Badge tone="demo" className="!h-[18px] !px-1.5 !text-[9.5px]">DEMO</Badge> : null}
          </div>
          <p className="t-card text-text">{incidentHeading(lang, i)}</p>
          <p className="t-meta text-secondary">{whereText(lang, i)}</p>
        </div>
        <div className="flex flex-col items-end">
          <span className="t-num text-[22px] font-semibold leading-none text-text">{i.residents}</span>
          <span className="t-meta text-faint">{plural(lang, i.residents, { en: ['resident', 'residents'], ru: ['житель', 'жителя', 'жителей'], kk: 'тұрғын' })}</span>
        </div>
      </div>
      <Pipeline status={i.status} compact />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone} dot>{tx(st.label)}</Badge>
        {i.priority === 'CRITICAL' || i.priority === 'HIGH' ? <PriorityChip level={i.priority} /> : null}
        {eta ? <span className="t-meta text-secondary" suppressHydrationWarning>{eta}</span> : null}
        <span className="ml-auto"><ChannelStack channels={i.channels} /></span>
      </div>
      {children}
    </div>
  )
  return href ? <Link href={`/incident/${i.code}`} className="tap block rounded-[22px] bg-surface p-4 card-shadow hover:bg-surface-2">{body}</Link> : <div className="rounded-[22px] bg-surface p-4 card-shadow">{body}</div>
}
