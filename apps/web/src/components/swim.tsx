'use client'
// Caspian Safety on the map. Three facts, never merged into one colour:
//   LEGAL   official swimming area / swimming prohibited / not on the official list
//   STATUS  a temporary status, only when an authority has published one
//   NOW     wind and waves from a model, described on Beaufort / Douglas scales
// The app never says "safe to swim".
import type { CaspianState, CoastZoneDTO, SwimCheckDTO } from '@aktau/server'
import { agoShort } from '@aktau/i18n'
import type { Map as MlMap } from 'maplibre-gl'
import { useApp } from './app'
import { Badge, Button, Icon } from './primitives'

type L3 = { en: string; ru: string; kk: string }
export type { CaspianState, CoastZoneDTO, SwimCheckDTO }

export const SWIM_TONE = { official: '#2fb67c', prohibited: '#e5534b', restricted: '#e0a030', shore: '#8a9ba1' } as const

export function zoneTone(z: { legal: string; operational: string }) {
  if (z.legal === 'PROHIBITED') return SWIM_TONE.prohibited
  return z.operational === 'CLOSED' || z.operational === 'RESTRICTED' ? SWIM_TONE.restricted : SWIM_TONE.official
}

const DCHS_NOTE_URL = 'https://www.gov.kz/memleket/entities/emer/press/news/details/1024313?lang=ru'
const directions = (z: { location: { lat: number | null; lon: number | null } }) =>
  z.location.lat != null ? `https://2gis.kz/aktau/directions/points/%7C${z.location.lon}%2C${z.location.lat}` : null
const dist = (m: number, lang: string) => (m < 1000 ? `${Math.round(m / 10) * 10} ${lang === 'en' ? 'm' : 'м'}` : `${(m / 1000).toFixed(1)} ${lang === 'en' ? 'km' : 'км'}`)

const T = {
  official: { en: 'Official swimming area', ru: 'Официальное место для купания', kk: 'Ресми шомылу орны' },
  prohibited: { en: 'Swimming prohibited', ru: 'Купание запрещено', kk: 'Шомылуға тыйым салынған' },
  unlisted: { en: 'Not an official swimming area', ru: 'Не официальное место для купания', kk: 'Ресми шомылу орны емес' },
  legalOfficial: { en: 'Listed by the akimat as a place for swimming and recreation on water.', ru: 'Входит в официальный перечень мест для купания и отдыха на воде.', kk: 'Әкімдіктің судағы демалыс орындарының ресми тізімінде бар.' },
  legalProhibited: { en: 'Officially listed as a place where swimming is prohibited.', ru: 'Официально входит в список мест, где купание запрещено.', kk: 'Шомылуға тыйым салынған орындардың ресми тізімінде бар.' },
  noStatus: { en: 'not published', ru: 'не опубликован', kk: 'жарияланбаған' },
  OPEN: { en: 'Open', ru: 'Открыт', kk: 'Ашық' },
  RESTRICTED: { en: 'Restricted', ru: 'Ограничен', kk: 'Шектелген' },
  CLOSED: { en: 'Closed', ru: 'Закрыт', kk: 'Жабық' },
  canI: { en: 'Can I swim here?', ru: 'Можно ли здесь купаться?', kk: 'Мұнда шомылуға бола ма?' },
  tapHint: { en: 'Or tap any point on the coast.', ru: 'Или нажмите на любую точку побережья.', kk: 'Немесе жағалаудың кез келген нүктесін басыңыз.' },
  nearest: { en: 'Nearest official swimming area', ru: 'Ближайшее официальное место для купания', kk: 'Ең жақын ресми шомылу орны' },
  model: { en: 'Model near Aktau · not a swimming safety rating', ru: 'Модель у Актау · не оценка безопасности купания', kk: 'Ақтау маңындағы модель · шомылу қауіпсіздігінің бағасы емес' },
  source: { en: 'Source', ru: 'Источник', kk: 'Дереккөз' },
  verified: { en: 'verified', ru: 'сверено', kk: 'тексерілді' },
} satisfies Record<string, L3>

const WIND: Record<string, L3> = {
  calm: { en: 'calm', ru: 'штиль', kk: 'тымық' }, light: { en: 'light wind', ru: 'слабый ветер', kk: 'әлсіз жел' },
  moderate: { en: 'moderate wind', ru: 'умеренный ветер', kk: 'қалыпты жел' }, strong: { en: 'strong wind', ru: 'сильный ветер', kk: 'күшті жел' },
  gale: { en: 'gale', ru: 'шторм', kk: 'дауыл' },
}
const SEA: Record<string, L3> = {
  calm: { en: 'calm sea', ru: 'море спокойно', kk: 'теңіз тынық' }, slight: { en: 'small waves', ru: 'слабое волнение', kk: 'әлсіз толқын' },
  moderate: { en: 'moderate waves', ru: 'умеренное волнение', kk: 'қалыпты толқын' }, rough: { en: 'rough sea', ru: 'сильное волнение', kk: 'күшті толқын' },
  very_rough: { en: 'very rough sea', ru: 'очень сильное волнение', kk: 'өте күшті толқын' },
}

/** Short map label: the beach's own name without «Пляж» / "beach" / "жағажайы". */
export const pinLabel = (name: string) => name.replace(/^Пляж (гостиницы )?/, '').replace(/ (beach|жағажайы)$/, '').replace(/ қонақүйінің$/, '')

/** Map label: a pill with a check (official) or a bar (prohibited), drawn on demand. id = `swim:<legal>:<operational>:<name>` */
export function drawSwimPin(map: MlMap, id: string) {
  const [, legal, operational, ...rest] = id.split(':')
  const text = rest.join(':')
  const ratio = 2, fs = 12 * ratio, pad = 8 * ratio, dot = 18 * ratio, h = 28 * ratio
  const c = document.createElement('canvas')
  const g0 = c.getContext('2d')!
  g0.font = `600 ${fs}px Geist, "Geist Variable", system-ui, sans-serif`
  const w = Math.ceil(g0.measureText(text).width) + pad * 2 + dot + 6 * ratio
  c.width = w + 4; c.height = h + 4
  const g = c.getContext('2d')!
  const color = zoneTone({ legal: legal!, operational: operational! })
  g.fillStyle = '#ffffff'; g.strokeStyle = color; g.lineWidth = 2 * ratio
  g.beginPath(); g.roundRect(2, 2, w, h, h / 2); g.fill(); g.stroke()
  const cx = 2 + 5 * ratio + dot / 2, cy = 2 + h / 2
  g.fillStyle = color; g.beginPath(); g.arc(cx, cy, dot / 2, 0, Math.PI * 2); g.fill()
  g.strokeStyle = '#ffffff'; g.lineWidth = 2.2 * ratio; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath()
  if (legal === 'PROHIBITED') { g.moveTo(cx - 4.5 * ratio, cy); g.lineTo(cx + 4.5 * ratio, cy) }
  else { g.moveTo(cx - 4 * ratio, cy); g.lineTo(cx - 1 * ratio, cy + 3 * ratio); g.lineTo(cx + 4.5 * ratio, cy - 3.5 * ratio) }
  g.stroke()
  g.fillStyle = '#0d1b22'; g.font = `600 ${fs}px Geist, "Geist Variable", system-ui, sans-serif`; g.textBaseline = 'middle'
  g.fillText(text, cx + dot / 2 + 5 * ratio, cy + ratio)
  map.addImage(id, g.getImageData(0, 0, c.width, c.height), { pixelRatio: ratio })
}

function Frame({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="sheet-in relative mx-auto flex max-h-[62dvh] max-w-[520px] flex-col gap-3 overflow-y-auto rounded-[28px] bg-surface px-5 pb-4 pt-3 card-shadow lg:max-h-[calc(100dvh-40px)] lg:max-w-none">
      <div className="mx-auto h-1 w-9 flex-none rounded-full bg-border lg:hidden" />
      {onClose ? <button type="button" onClick={onClose} aria-label="Close" className="tap absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-surface-2 text-secondary hairline"><Icon name="x" size={15} /></button> : null}
      {children}
    </div>
  )
}

function LegendRow({ color, dashed, children }: { color: string; dashed?: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 t-meta text-text">
      <span className="h-1 w-6 flex-none rounded-full" style={dashed ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 9px)` } : { background: color }} />
      {children}
    </p>
  )
}

export function SwimLegend({ compact }: { compact?: boolean }) {
  const { tx } = useApp()
  if (compact) return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1">
      <LegendRow color={SWIM_TONE.official}>{tx({ en: 'Official', ru: 'Официальное', kk: 'Ресми' })}</LegendRow>
      <LegendRow color={SWIM_TONE.prohibited}>{tx({ en: 'Prohibited', ru: 'Запрещено', kk: 'Тыйым' })}</LegendRow>
      <LegendRow color={SWIM_TONE.shore} dashed>{tx({ en: 'Not listed', ru: 'Нет в перечне', kk: 'Тізімде жоқ' })}</LegendRow>
    </div>
  )
  return (
    <div className="flex flex-col gap-1.5">
      <LegendRow color={SWIM_TONE.official}>{tx(T.official)}</LegendRow>
      <LegendRow color={SWIM_TONE.prohibited}>{tx(T.prohibited)}</LegendRow>
      <LegendRow color={SWIM_TONE.shore} dashed>{tx(T.unlisted)}</LegendRow>
    </div>
  )
}

/** Live conditions as facts, with the words of the standard scales. */
export function Conditions({ c, compact }: { c: CaspianState['conditions']; compact?: boolean }) {
  const { lang, tx } = useApp()
  const words = [c.wind ? tx(WIND[c.wind]!) : null, c.sea ? tx(SEA[c.sea]!) : null].filter(Boolean).join(' · ')
  const u = lang === 'en' ? 'm/s' : 'м/с'
  const cells: Array<[string, string | null]> = [
    [tx({ en: 'Wind', ru: 'Ветер', kk: 'Жел' }), c.wind_ms != null ? `${Math.round(c.wind_ms)} ${u}` : null],
    [tx({ en: 'Gusts', ru: 'Порывы', kk: 'Екпін' }), c.gust_ms != null ? `${Math.round(c.gust_ms)} ${u}` : null],
    [tx({ en: 'Waves', ru: 'Волны', kk: 'Толқын' }), c.wave_m != null ? `${c.wave_m.toFixed(1)} ${lang === 'en' ? 'm' : 'м'}` : null],
    [tx({ en: 'Water', ru: 'Вода', kk: 'Су' }), c.sea_temp_c != null ? `${Math.round(c.sea_temp_c)}°` : null],
  ]
  const shown = cells.filter(([, v]) => v != null)
  if (!shown.length) return <p className="t-meta text-secondary">{tx({ en: 'Sea conditions are not available right now.', ru: 'Данные о состоянии моря сейчас недоступны.', kk: 'Теңіз жағдайы туралы деректер қазір жоқ.' })}</p>
  if (compact) return (
    <div className="flex flex-col gap-0.5">
      <p className={`t-sub ${c.attention ? 'font-semibold text-amber' : 'text-text'}`}>{shown.map(([l, v]) => `${l} ${v}`).join(' · ')}</p>
      <p className="t-meta text-[11px] text-faint" suppressHydrationWarning>{words ? `${words} · ` : ''}{tx(T.model)}</p>
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      <span className="t-label text-faint">{tx({ en: 'Conditions now', ru: 'Условия сейчас', kk: 'Қазіргі жағдай' })}</span>
      <div className={`grid gap-1.5 ${shown.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {shown.map(([l, v]) => (
          <div key={l} className="flex flex-col gap-0.5 rounded-[12px] bg-surface-2 px-2 py-2 hairline">
            <span className="t-num text-[17px] font-semibold leading-none text-text">{v ?? '—'}</span>
            <span className="t-meta text-[11px] text-secondary">{l}</span>
          </div>
        ))}
      </div>
      {words ? <p className={`t-sub ${c.attention ? 'font-semibold text-amber' : 'text-text'}`}>{words}</p> : null}
      <p className="t-meta text-[11px] text-faint" suppressHydrationWarning>{tx(T.model)}{c.fetched_at ? ` · ${agoShort(lang, c.fetched_at)}` : ''}</p>
    </div>
  )
}

function RescuerNote() {
  const { tx } = useApp()
  return (
    <a href={DCHS_NOTE_URL} target="_blank" rel="noreferrer" className="tap flex gap-2.5 rounded-[14px] bg-surface-2 p-3 hairline">
      <Icon name="shield" size={16} className="mt-0.5 flex-none text-blue" />
      <span className="t-meta text-secondary">
        {tx({
          en: 'Rescuers (ДЧС) on the Aktau coast: sharp depth changes near the shore, undercurrents, danger in stormy weather. No swimming near breakwaters.',
          ru: 'ДЧС о побережье Актау: резкие перепады глубин у берега, подводные течения, опасность в штормовую погоду. У волнорезов купаться запрещено.',
          kk: 'ТЖД Ақтау жағалауы туралы: жағаға жақын тереңдік күрт өзгереді, су асты ағыстары, дауылды ауа райында қауіпті. Толқынқайтарғыштар маңында шомылуға болмайды.',
        })}
      </span>
    </a>
  )
}

function SourceLine({ z }: { z: CoastZoneDTO }) {
  const { tx } = useApp()
  return (
    <a href={z.source.url} target="_blank" rel="noreferrer" className="tap flex items-start gap-1.5 t-meta text-secondary">
      <Icon name="external" size={13} className="mt-0.5 flex-none" />
      <span>{tx(T.source)}: {z.source.authority} · {z.source.title}{z.source.ref ? `, ${z.source.ref}` : ''} · {tx(T.verified)} {z.source.verified_at}</span>
    </a>
  )
}

function StatusRow({ z }: { z: CoastZoneDTO }) {
  const { lang, tx } = useApp()
  const o = z.operational
  if (o.status === 'UNKNOWN') return <p className="t-meta text-secondary">{tx({ en: 'Official status', ru: 'Официальный статус', kk: 'Ресми мәртебе' })}: {tx(T.noStatus)}</p>
  const tone = o.status === 'OPEN' ? 'resolved' : o.status === 'CLOSED' ? 'active' : 'planned'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5"><Badge tone={tone} dot>{tx(T[o.status])}</Badge>{o.source ? <span className="t-meta text-secondary">{o.source}</span> : null}</div>
      {o.note ? <p className="t-sub text-text">{o.note}</p> : null}
      {o.updated_at ? <p className="t-meta text-faint" suppressHydrationWarning>{agoShort(lang, o.updated_at)}</p> : null}
    </div>
  )
}

function LocationNote({ z }: { z: CoastZoneDTO }) {
  const { tx } = useApp()
  if (z.legal_status === 'PROHIBITED') return null
  return (
    <p className="t-meta text-faint">
      {z.location.confidence === 'approximate' ? `${tx({ en: 'Approximate location', ru: 'Местоположение приблизительное', kk: 'Орны шамамен' })}. ` : ''}
      {tx({ en: 'The shore within ~150 m of the beach is highlighted. On site, swim only inside the buoys.', ru: 'Выделен берег в ~150 м от пляжа. На месте купайтесь только в пределах буйков.', kk: 'Жағажайдан ~150 м жағалау белгіленген. Тек буйлар ішінде шомылыңыз.' })}
      {z.location.source ? ` (${z.location.source})` : ''}
    </p>
  )
}

export function ZoneSheet({ z, c, onClose }: { z: CoastZoneDTO; c: CaspianState['conditions']; onClose: () => void }) {
  const { t, tx } = useApp()
  const official = z.legal_status === 'OFFICIAL'
  const to = directions(z)
  return (
    <Frame key={z.id} onClose={onClose}>
      <div className="pr-9"><Badge tone={official ? 'resolved' : 'active'} dot>{tx(official ? T.official : T.prohibited)}</Badge></div>
      <h2 className="t-headline text-text">{z.name}</h2>
      <p className="t-sub text-secondary">{tx(official ? T.legalOfficial : T.legalProhibited)} <span className="text-faint">«{z.official_text}»</span></p>
      {official ? <StatusRow z={z} /> : null}
      {official && z.rescue_post != null ? <p className="t-meta text-text">{tx({ en: 'Rescue post', ru: 'Спасательный пост', kk: 'Құтқару бекеті' })}: {z.rescue_post ? tx({ en: 'yes', ru: 'есть', kk: 'бар' }) : tx({ en: 'no', ru: 'нет', kk: 'жоқ' })}</p> : null}
      <Conditions c={c} />
      <RescuerNote />
      <LocationNote z={z} />
      <SourceLine z={z} />
      {official && to ? <a href={to} target="_blank" rel="noreferrer" className="tap inline-flex h-[50px] items-center justify-center gap-2 rounded-[16px] bg-blue text-[15px] font-bold text-on-blue"><Icon name="route" size={18} />{t('action.directions')}</a> : null}
    </Frame>
  )
}

export function SwimSummarySheet({ state, onCheck, checking, error, onPick }: { state: CaspianState | null; onCheck: () => void; checking: boolean; error: string | null; onPick: (id: string) => void }) {
  const { tx } = useApp()
  return (
    <Frame>
      <span className="t-label text-faint">{tx({ en: 'Swimming on the Caspian', ru: 'Купание на Каспии', kk: 'Каспийде шомылу' })}</span>
      <SwimLegend compact />
      {state ? <Conditions c={state.conditions} compact /> : null}
      <Button onClick={onCheck} disabled={checking}><Icon name="pin" size={18} />{checking ? tx({ en: 'Finding you…', ru: 'Определяем место…', kk: 'Орныңыз анықталуда…' }) : tx(T.canI)}</Button>
      {error ? <p className="t-meta text-red">{error}</p> : <p className="t-meta text-center text-secondary">{tx(T.tapHint)}</p>}
      {state ? (
        <details className="-mx-2 lg:hidden">
          <summary className="tap cursor-pointer list-none rounded-[12px] px-2 py-1.5 t-row text-blue">{tx({ en: 'All listed places', ru: 'Все места из перечня', kk: 'Тізімдегі барлық орындар' })} · {state.zones.length}</summary>
          <SwimPanel state={state} selected={null} onPick={onPick} />
        </details>
      ) : null}
    </Frame>
  )
}

export function CheckSheet({ r, c, where, onClose, onPick }: { r: SwimCheckDTO; c: CaspianState['conditions']; where: 'gps' | 'map'; onClose: () => void; onPick: (id: string) => void }) {
  const { lang, t, tx } = useApp()
  const v = r.verdict
  const head = v.kind === 'prohibited'
    ? { tone: SWIM_TONE.prohibited, icon: 'x' as const, text: tx({ en: 'No. Swimming is prohibited here.', ru: 'Нет. Здесь купание запрещено.', kk: 'Жоқ. Мұнда шомылуға тыйым салынған.' }) }
    : v.kind === 'official'
      ? v.operational === 'CLOSED' || v.operational === 'RESTRICTED'
        ? { tone: SWIM_TONE.restricted, icon: 'alert' as const, text: tx(v.operational === 'CLOSED'
          ? { en: 'Official beach, closed right now', ru: 'Официальный пляж, сейчас закрыт', kk: 'Ресми жағажай, қазір жабық' }
          : { en: 'Official beach, restricted right now', ru: 'Официальный пляж, сейчас ограничен', kk: 'Ресми жағажай, қазір шектелген' }) }
        : { tone: SWIM_TONE.official, icon: 'check' as const, text: tx(T.official) }
      : v.kind === 'unlisted'
        ? { tone: SWIM_TONE.shore, icon: 'alert' as const, text: tx(T.unlisted) }
        : { tone: SWIM_TONE.shore, icon: 'pin' as const, text: tx({ en: 'This point is not on the coast', ru: 'Эта точка не на побережье', kk: 'Бұл нүкте жағалауда емес' }) }
  const n = r.nearest_official
  const to = n ? directions(n) : null
  return (
    <Frame onClose={onClose}>
      <span className="t-label text-faint pr-9">{where === 'gps' ? tx({ en: 'At your location', ru: 'В вашем местоположении', kk: 'Сіздің орныңызда' }) : tx({ en: 'At the point you tapped', ru: 'В выбранной точке', kk: 'Таңдалған нүктеде' })}</span>
      <div className="flex items-start gap-3">
        <span className="grid size-11 flex-none place-items-center rounded-full text-white" style={{ background: head.tone }}><Icon name={head.icon} size={22} /></span>
        <h2 className="t-headline text-text">{head.text}</h2>
      </div>
      {v.kind === 'prohibited' && r.zone ? <p className="t-sub text-secondary">{tx({ en: 'You are in an officially restricted stretch of the coast', ru: 'Вы на официально запрещённом участке побережья', kk: 'Сіз жағалаудың ресми тыйым салынған бөлігіндесіз' })}: <span className="text-text">{r.zone.name}</span>.</p> : null}
      {v.kind === 'official' && r.zone ? (<><p className="t-card text-text">{r.zone.name}</p><StatusRow z={r.zone} /></>) : null}
      {v.kind === 'unlisted' ? <p className="t-sub text-secondary">{tx({ en: 'This stretch of shore is not on the official list. Rescuers advise swimming only at official, equipped beaches.', ru: 'Этого участка нет в официальном перечне. Спасатели рекомендуют купаться только на официальных оборудованных пляжах.', kk: 'Бұл жағалау ресми тізімде жоқ. Құтқарушылар тек ресми жабдықталған жағажайларда шомылуға кеңес береді.' })}</p> : null}
      {v.kind === 'official' ? <Conditions c={c} /> : null}
      {n ? (
        <div className="flex flex-col gap-2 rounded-[16px] bg-green-soft p-3 hairline">
          <span className="t-label text-faint">{tx(T.nearest)}</span>
          <button type="button" onClick={() => onPick(n.id)} className="tap flex items-center justify-between gap-3 text-left">
            <span className="t-card text-text">{n.name}</span>
            <span className="t-num text-[15px] font-semibold text-green">{dist(n.distance_m, lang)}</span>
          </button>
          {to ? <a href={to} target="_blank" rel="noreferrer" className="tap inline-flex h-10 items-center justify-center gap-2 rounded-[13px] bg-blue text-[13px] font-bold text-on-blue"><Icon name="route" size={16} />{t('action.directions')}</a> : null}
        </div>
      ) : null}
      {r.zone ? <SourceLine z={r.zone} /> : null}
      <p className="t-meta text-[11px] text-faint">{tx({ en: 'Your position is used for this answer only and is not stored.', ru: 'Местоположение используется только для этого ответа и не сохраняется.', kk: 'Орныңыз тек осы жауап үшін қолданылады және сақталмайды.' })}</p>
    </Frame>
  )
}

/** Desktop side panel: the whole registry, including entries not on the map yet. */
export function SwimPanel({ state, selected, onPick }: { state: CaspianState | null; selected: string | null; onPick: (id: string) => void }) {
  const { tx } = useApp()
  if (!state) return <p className="p-4 t-sub text-secondary">…</p>
  const drawn = state.zones.filter((z) => z.location.confidence !== 'unmapped')
  const unmapped = state.zones.filter((z) => z.location.confidence === 'unmapped')
  const group = (title: L3, list: CoastZoneDTO[]) => list.length ? (
    <div className="flex flex-col gap-1">
      <span className="px-3 pt-3 t-label text-faint">{tx(title)} · {list.length}</span>
      {list.map((z) => (
        <button key={z.id} type="button" onClick={() => onPick(z.id)}
          className={`tap flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-left ${selected === z.id ? 'bg-surface-2 hairline' : 'hover:bg-surface-2'}`}>
          <span className="size-2.5 flex-none rounded-full" style={{ background: zoneTone({ legal: z.legal_status, operational: z.operational.status }) }} />
          <span className="flex min-w-0 flex-col">
            <span className="t-row truncate text-text">{z.name}</span>
            {z.location.confidence === 'approximate' ? <span className="t-meta text-faint">{tx({ en: 'approximate location', ru: 'место приблизительное', kk: 'орны шамамен' })}</span> : null}
          </span>
        </button>
      ))}
    </div>
  ) : null
  return (
    <>
      {group(T.official, drawn.filter((z) => z.legal_status === 'OFFICIAL'))}
      {group(T.prohibited, drawn.filter((z) => z.legal_status === 'PROHIBITED'))}
      {unmapped.length ? (
        <div className="flex flex-col gap-1 px-3 pb-3 pt-4">
          <span className="t-label text-faint">{tx({ en: 'Listed, not yet on the map', ru: 'В перечне, но ещё не на карте', kk: 'Тізімде бар, картада әлі жоқ' })} · {unmapped.length}</span>
          {unmapped.map((z) => (
            <p key={z.id} className="flex items-start gap-2.5 py-1 t-meta text-secondary">
              <span className="mt-1 size-2 flex-none rounded-full" style={{ background: z.legal_status === 'PROHIBITED' ? SWIM_TONE.prohibited : SWIM_TONE.official }} />
              <span><span className="text-text">{z.name}</span> · {z.official_text}</span>
            </p>
          ))}
        </div>
      ) : null}
    </>
  )
}
