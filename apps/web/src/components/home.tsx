'use client'
// Home. One glance: your building as a facade plaque, the city's state for
// it, services, weather and the Caspian, and what 109 is handling nearby.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ago, agoShort, greetingKey } from '@aktau/i18n'
import { fmtDate, fmtTime } from '@aktau/normalization/time'
import type { AktauNowDTO, CityEventDTO, CityEventDetailDTO, ServiceStatusDTO } from '@aktau/types'
import { useApp, useRealtime } from './app'
import { Badge, Beacon, Button, Card, Eyebrow, Icon, InfoRow, LinkButton, Plaque, SectionHead, type IconName } from './primitives'
import { EventHistory } from './event'
import { NewsRail } from './news'
import type { NearbyItem, NewsArticleDTO } from '@aktau/server'
import { ConfirmButtons, IncidentCard, MeTooButton, PriorityChip, SERVICE_ICON, STATUS, VerifyButtons, incidentHeading, metresText, residentsText, whereText, type IncidentLite } from './incident-ui'
import { plural } from '@/lib/plural'
import { PHOTOS } from '@/lib/photos'
import { CATEGORY_ICON, areasText, authorityName, etaText, headline, isOngoing, kmOrM, sourceLine, statusBadge, windowText } from '@/lib/present'

export type NowPayload = AktauNowDTO & { weather_text: string | null; around: CityEventDTO[] }
export type OpenPlaces = { count: number; radius_m: number } | null

const CACHE_KEY = 'aktau_now_cache_v1'

export type NearbyPayload = { has_home: boolean; sessions: string[]; items: NearbyItem[]; generated_at: string }
const EMPTY_NEARBY: NearbyPayload = { has_home: false, sessions: [], items: [], generated_at: '' }
const isOpenStatus = (s: string) => !['RESOLVED', 'VERIFIED', 'REJECTED'].includes(s)

/** Tonight in Aktau, for the Home card (from the afisha). */
export type GoOut = { films: number; next_film: { title: string; cinema: string; at: string } | null; next_show: { title: string; at: string; venue: string | null } | null }

export function HomeView({ initial, openPlaces, savedId = null, incidents: initialIncidents = [], news = [], nearby: initialNearby = EMPTY_NEARBY, goOut = null }: { initial: NowPayload; openPlaces: OpenPlaces; savedId?: string | null; incidents?: IncidentLite[]; news?: NewsArticleDTO[]; nearby?: NearbyPayload; goOut?: GoOut | null }) {
  const { lang, tx } = useApp()
  const [data, setData] = useState<NowPayload>(initial)
  const [incidents, setIncidents] = useState(initialIncidents)
  const [nearby, setNearby] = useState(initialNearby)
  // Incidents that appeared while this screen was open slide in; the rest are just there.
  const known = useRef(new Set(initialNearby.items.map((i) => i.id)))
  const [arrived, setArrived] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [lastOk, setLastOk] = useState<string>(initial.generated_at)
  const [pulse, setPulse] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (signal = false) => {
    setBusy(true)
    try {
      const r = await fetch(`/api/now?lang=${lang}${savedId ? `&saved_location_id=${savedId}` : ''}`, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const next = (await r.json()) as NowPayload
      setData(next)
      setOffline(false)
      setLastOk(next.generated_at)
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
      if (signal) { setPulse(true); setTimeout(() => setPulse(false), 900) }
    } catch {
      setOffline(true)
      try {
        const cached = localStorage.getItem(CACHE_KEY)
        if (cached) { const c = JSON.parse(cached) as NowPayload; setData(c); setLastOk(c.generated_at) }
      } catch { /* nothing cached */ }
    } finally { setBusy(false) }
  }, [lang, savedId])

  const refreshIncidents = useCallback(async () => {
    try {
      const d = (await (await fetch('/api/incidents', { cache: 'no-store' })).json()) as { incidents: IncidentLite[] }
      setIncidents(nearFirst(d.incidents, data.location.area?.id ?? null))
    } catch { /* keep */ }
  }, [data.location.area?.id])

  useEffect(() => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(initial)) } catch { /* ignore */ }
    const on = () => void refresh()
    const off = () => setOffline(true)
    const vis = () => document.visibilityState === 'visible' && void refresh()
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    document.addEventListener('visibilitychange', vis)
    const tick = setInterval(() => void refresh(), 120_000)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', vis); clearInterval(tick) }
  }, [initial, refresh])
  useRealtime(() => void refresh(true))
  useRealtime(() => void refreshIncidents(), ['incidents'])

  // The server decides who is affected; a realtime hint only says "ask again".
  const refreshNearby = useCallback(async () => {
    try {
      const r = await fetch(`/api/me/nearby?lang=${lang}`, { cache: 'no-store' })
      if (!r.ok) return
      const d = (await r.json()) as NearbyPayload
      const fresh = d.items.find((i) => !known.current.has(i.id) && (i.ask === 'confirm' || i.priority === 'CRITICAL'))
      d.items.forEach((i) => known.current.add(i.id))
      if (fresh) setArrived(fresh.id)
      setNearby(d)
    } catch { /* offline: keep */ }
  }, [lang])
  const areaId = data.location.area?.id ?? null
  useRealtime(() => void refreshNearby(), ['incidents'], {
    filter: (e) => e.kind === 'created' || known.current.has(e.id ?? '') || e.scope === 'city' || (!!areaId && Array.isArray(e.areas) && (e.areas as string[]).includes(areaId)),
  })

  if (offline) return <OfflineState lastOk={lastOk} onRetry={() => void refresh()} busy={busy} services={data.services} />

  const p = data.priority_event
  const active = p && p.relevance === 'DIRECT' && isOngoing(p) ? p : null
  const resolved = !data.affecting.length && data.recently_resolved ? data.recently_resolved : null
  const upcoming = !active ? data.affecting[0] ?? null : null
  // 109 problems inside the scope of this home count too, calmly: amber, red only when critical.
  const direct = nearby.items.filter((i) => i.relevance === 'DIRECT' && isOpenStatus(i.status) && i.relation !== 'not_affected')
  const incidentMood: Mood | null = direct.some((i) => i.priority === 'CRITICAL') ? 'red' : direct.length ? 'amber' : null
  const mood: Mood = active ? 'red' : resolved ? 'green' : upcoming ? 'amber' : incidentMood ?? (data.overall === 'UNKNOWN' ? 'unknown' : 'calm')
  const headline = !active && !upcoming && direct.length
    ? `${direct.length} ${plural(lang, direct.length, { en: ['problem near you', 'problems near you'], ru: ['проблема рядом с вами', 'проблемы рядом с вами', 'проблем рядом с вами'], kk: 'мәселе жақын маңда' })}`
    : data.headline

  return (
    <div className="flex flex-col gap-4">
      <Greeting data={data} />
      <HomeHero data={data} pulse={pulse} mood={mood} headline={headline} />
      <NearbyNow nearby={nearby} arrived={arrived} onChange={() => void refreshNearby()} />
      {active ? <ActiveCard event={active} /> : null}
      {resolved ? <ResolvedCard event={resolved} /> : null}
      {upcoming ? <UpcomingCard e={upcoming} /> : null}
      <div className="rise rise-2"><ServiceGrid services={data.services} /></div>
      <UnknownServices services={data.services} />
      <div className="grid gap-4 lg:grid-cols-2">
        <WeatherCard data={data} />
        <NearIncidents incidents={incidents} house={data.location.building?.house_number ?? null} areaId={data.location.area?.id ?? null} />
      </div>
      <NewsRail articles={news} />
      <AroundCard events={[...(upcoming ? data.affecting.slice(1) : data.affecting.filter((e) => e.id !== active?.id)), ...data.nearby_events]} data={data} openPlaces={openPlaces} />
      {goOut && (goOut.films || goOut.next_show) ? <GoOutCard g={goOut} /> : null}
      <AskBar />
    </div>
  )
}

type Mood = 'calm' | 'amber' | 'red' | 'green' | 'unknown'

function nearFirst(list: IncidentLite[], areaId: string | null) {
  return [...list].filter((i) => i.status !== 'REJECTED').sort((a, b) => Number(b.area_id === areaId) - Number(a.area_id === areaId))
}

function Greeting({ data }: { data: NowPayload }) {
  const { t, lang } = useApp()
  const now = new Date()
  // The name from the entrance lives only in this browser's cookie.
  const [name, setName] = useState<string | null>(null)
  useEffect(() => { const m = document.cookie.match(/(?:^|; )aktau_name=([^;]+)/); if (m) setName(decodeURIComponent(m[1]!)) }, [])
  return (
    <div className="rise flex flex-col gap-1.5 pt-1">
      <Eyebrow><span suppressHydrationWarning>{fmtDate(now, lang)} · {fmtTime(now)} · {data.location.area?.designator ? `${data.location.area.designator} ${lang === 'en' ? 'mkr' : 'мкр'}` : 'Aktau'}</span></Eyebrow>
      <h1 className="t-title text-text" suppressHydrationWarning>{name ? t(`${greetingKey(now)}.name`, { name }) : t(greetingKey(now))}</h1>
    </div>
  )
}

/** The home plaque: your building number, painted large, with Aktau Now for it. */
function HomeHero({ data, pulse, mood, headline }: { data: NowPayload; pulse: boolean; mood: Mood; headline: string }) {
  const { lang, t, tx } = useApp()
  const d = data.location.area?.designator
  const h = data.location.building?.house_number
  const numeric = !!d && /^\d/.test(d)
  const bg = { calm: 'bg-surface', amber: 'bg-amber-soft', red: 'bg-red-soft', green: 'bg-green-soft', unknown: 'bg-soft' }[mood]
  const beacon = { calm: 'green', amber: 'amber', red: 'red', green: 'green', unknown: 'secondary' }[mood] as 'green'
  const stateWord = {
    calm: tx({ en: 'All clear', ru: 'Всё спокойно', kk: 'Бәрі тыныш' }), amber: tx({ en: 'Heads up', ru: 'Внимание', kk: 'Назар аударыңыз' }),
    red: tx({ en: 'Disruption', ru: 'Отключение', kk: 'Ақау' }), green: tx({ en: 'Back to normal', ru: 'Снова в норме', kk: 'Қалпына келді' }), unknown: tx({ en: 'Not confirmed', ru: 'Не подтверждено', kk: 'Расталмаған' }),
  }[mood]
  return (
    <Link href={data.priority_event ? `/event/${data.priority_event.id}` : '/map'} className={`rise rise-1 tap relative block overflow-hidden rounded-[28px] ${bg} card-shadow`}>
      <div className="panel-seams absolute inset-0 opacity-70" aria-hidden />
      <div className="relative flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><Beacon tone={beacon} pulse={pulse} live={mood === 'red'} /><span className="t-label text-secondary">{t('now.label')}</span></span>
          <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${mood === 'red' ? 'bg-red text-bg' : mood === 'amber' ? 'bg-amber text-bg' : mood === 'green' ? 'bg-green text-bg' : 'bg-surface-2 text-secondary hairline'}`}>{stateWord}</span>
        </div>
        <div className="flex items-end">
          {numeric ? <Plaque district={d!} house={h} size={h ? (Math.max(d!.length, h.length) > 2 ? 60 : 76) : 88} /> : (
            <span className="plaque text-[40px] text-text">{d ? data.location.label : tx({ en: 'Aktau', ru: 'Актау', kk: 'Ақтау' })}</span>
          )}
        </div>
        {numeric ? <p className="t-label -mt-3 text-faint">{lang === 'en' ? `microdistrict${h ? ' / house' : ''}` : lang === 'ru' ? `микрорайон${h ? ' / дом' : ''}` : `шағын аудан${h ? ' / үй' : ''}`}</p> : null}
        <div className="flex flex-col gap-1">
          <p className="t-now max-w-[30ch] text-text [text-wrap:pretty]">{headline}</p>
          <p className="t-mono text-[11px] text-faint" suppressHydrationWarning>{t('updated.short', { ago: agoShort(lang, data.generated_at) })} · {data.location.label}</p>
        </div>
        {!data.location.area ? (
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-blue px-3.5 py-2 text-[13px] font-bold text-on-blue"><Icon name="pin" size={15} />{t('you.setHome')}</span>
        ) : null}
      </div>
    </Link>
  )
}

const TILE_ICON: Record<string, IconName> = { water: 'water', electricity: 'power', heating: 'flame', roads: 'roads', transport: 'bus' }

export function ServiceTile({ s }: { s: ServiceStatusDTO }) {
  const { t } = useApp()
  const notice = s.state === 'PLANNED_ISSUE' || s.state === 'DEGRADED' || s.state === 'DISRUPTED'
  const unknown = s.state === 'UNKNOWN'
  const tone = s.state === 'DISRUPTED' ? 'text-red' : notice ? 'text-amber' : unknown ? 'text-faint' : 'text-secondary'
  const href = s.event_ids[0] ? `/event/${s.event_ids[0]}` : `/map?filter=${s.key}`
  return (
    <Link href={href} className="tap group flex min-w-0 items-center gap-3 px-4 py-3.5 hover:bg-surface-2 sm:flex-col sm:items-start sm:gap-2.5 sm:py-4">
      <Icon name={TILE_ICON[s.key] ?? 'shield'} size={20} className={notice || s.state === 'DISRUPTED' ? tone : 'text-text'} />
      <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2 sm:flex-col sm:items-start sm:gap-0">
        <span className="text-[14.5px] font-[600] text-text">{t(`service.${s.key}`)}</span>
        <span className={`truncate text-[13px] font-[500] ${tone}`}>{s.label}</span>
      </span>
    </Link>
  )
}

function ServiceGrid({ services }: { services: ServiceStatusDTO[] }) {
  const by = Object.fromEntries(services.map((s) => [s.key, s])) as Record<string, ServiceStatusDTO>
  const heatingIssue = by.heating && !['NORMAL', 'UNKNOWN'].includes(by.heating.state)
  const shown = [by.water, by.electricity, by.roads, heatingIssue ? by.heating : by.transport].filter(Boolean) as ServiceStatusDTO[]
  return (
    <div className="grid overflow-hidden rounded-[22px] bg-surface card-shadow max-sm:divide-y max-sm:divide-[var(--line)] sm:grid-cols-4 sm:divide-x sm:divide-[var(--line)]">
      {shown.map((s) => <ServiceTile key={s.key} s={s} />)}
    </div>
  )
}

/** Never label stale data as normal. */
function UnknownServices({ services }: { services: ServiceStatusDTO[] }) {
  const { t } = useApp()
  const unknown = services.filter((s) => s.state === 'UNKNOWN' && (s.key === 'water' || s.key === 'electricity'))
  if (!unknown.length) return null
  return (
    <Card tone="soft" padding={16} className="gap-2">
      <div className="flex items-center gap-2"><Icon name="eye" size={18} className="text-secondary" /><p className="t-row text-text">{t('unknown.title', { service: unknown.map((s) => t(`service.${s.key}`)).join(' · ') })}</p></div>
      <p className="t-sub text-secondary">{t('unknown.body')}</p>
    </Card>
  )
}

function WeatherCard({ data }: { data: NowPayload }) {
  const { t, tx } = useApp()
  const f = data.weather.forecast
  const obs = data.weather.observation
  const m = data.weather.marine
  const air = data.weather.air
  return (
    <Link href="/weather" className="rise rise-3 tap relative flex min-h-[208px] flex-col overflow-hidden rounded-[24px] text-white card-shadow">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={PHOTOS.shore.src} alt={PHOTOS.shore.alt} className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(8_18_22/0.25)_0%,rgb(8_18_22/0.35)_45%,rgb(8_18_22/0.85)_100%)]" />
      <div className="relative flex flex-1 flex-col justify-between p-5">
        <div className="flex items-center justify-between">
          <span className="t-label text-white/70">{tx({ en: 'Caspian coast', ru: 'Побережье Каспия', kk: 'Каспий жағалауы' })}</span>
          <span className="t-label text-white/60">{t('badge.modelled')}</span>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="t-num text-[56px] font-semibold leading-none">{f?.temperature_c != null ? `${Math.round(f.temperature_c)}°` : ''}</span>
            <span className="t-sub mt-1 text-white/80">{data.weather_text ?? ''}</span>
          </div>
          <div className="flex flex-col items-end gap-1.5 text-right">
            <span className="flex items-center gap-1.5 t-row"><Icon name="wind" size={16} />{f?.wind_ms != null ? t('weather.wind', { v: Math.round(f.wind_ms) }) : ''}</span>
            {m?.sea_temp_c != null ? <span className="flex items-center gap-1.5 t-meta text-white/80"><Icon name="water" size={14} />{tx({ en: 'Sea', ru: 'Море', kk: 'Теңіз' })} {Math.round(m.sea_temp_c)}°</span> : null}
            {air?.us_aqi != null ? <span className="t-meta text-white/80">AQI {Math.round(air.us_aqi)}</span> : null}
          </div>
        </div>
        {obs?.temperature_c != null ? <p className="t-mono mt-3 text-[10.5px] text-white/60" suppressHydrationWarning>{t('weather.observed', { t: Math.round(obs.temperature_c), time: fmtTime(new Date(obs.observed_at)) })}</p> : null}
      </div>
    </Link>
  )
}

/**
 * Under Aktau Now: what 109 knows about this home, asked in one calm card.
 * One prominent question at a time (is it fixed? → a danger here → does this
 * affect you?), then a short list. Nothing near you → nothing here.
 */
function NearbyNow({ nearby, arrived, onChange }: { nearby: NearbyPayload; arrived: string | null; onChange: () => void }) {
  const { lang, tx } = useApp()
  // An answered card stays until the resident is done with it (a rating is optional), then the list catches up.
  const [pin, setPin] = useState<{ item: NearbyItem; mode: 'verify' | 'confirm' } | null>(null)
  const open = nearby.items.filter((i) => isOpenStatus(i.status) && i.relation !== 'not_affected')
  const verify = nearby.items.find((i) => i.ask === 'verify')
  const critical = open.find((i) => i.priority === 'CRITICAL' && i.relevance === 'DIRECT')
  const confirm = nearby.items.find((i) => i.ask === 'confirm')
  const lead = pin?.item ?? verify ?? critical ?? confirm ?? null
  const mode = pin?.mode ?? (lead && lead === verify ? 'verify' : lead && lead === critical ? 'critical' : lead ? 'confirm' : null)
  const release = () => { setPin(null); onChange() }
  const rest = open.filter((i) => i.id !== lead?.id).slice(0, 3)
  if (!lead && !rest.length) return null
  const where = (i: NearbyItem) => [whereText(lang, i), i.distance_m != null && i.relevance !== 'FOLLOWING' ? metresText(lang, i.distance_m) : null].filter(Boolean).join(' · ')
  return (
    <section className="flex flex-col gap-3" aria-live="polite">
      {lead ? (
        <div key={lead.id + (mode ?? '')} className={`${lead.id === arrived ? 'sheet-in' : 'rise rise-2'} flex flex-col gap-3 rounded-[24px] p-5 card-shadow ${mode === 'critical' ? 'bg-red-soft' : mode === 'verify' ? 'bg-green-soft' : 'bg-surface'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className={`t-label ${mode === 'critical' ? 'text-red' : mode === 'verify' ? 'text-green' : 'text-blue'}`}>
              {mode === 'verify' ? tx({ en: 'Your check is needed', ru: 'Нужна ваша проверка', kk: 'Сіздің тексеруіңіз керек' })
                : mode === 'critical' ? tx({ en: 'Important warning', ru: 'Важное предупреждение', kk: 'Маңызды ескерту' })
                : tx({ en: 'New problem near you', ru: 'Новая проблема рядом', kk: 'Жақын маңда жаңа мәселе' })}
            </span>
            <span className="flex items-center gap-1.5">{lead.is_demo ? <Badge tone="demo" className="!h-5 !px-1.5 !text-[9.5px]">DEMO</Badge> : null}<PriorityChip level={lead.priority} /></span>
          </div>
          <Link href={`/incident/${lead.code}`} className="tap flex items-start gap-3">
            <span className={`grid size-11 flex-none place-items-center rounded-[14px] ${lead.priority === 'CRITICAL' ? 'bg-red text-bg' : 'bg-surface-2 text-text hairline'}`}><Icon name={SERVICE_ICON[lead.service]} size={21} /></span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="t-headline text-text">{mode === 'verify' ? tx({ en: 'The team reports it is fixed', ru: 'Исполнитель сообщил, что проблема устранена', kk: 'Орындаушы мәселе шешілді деді' }) : incidentHeading(lang, lead)}</span>
              <span className="t-sub text-secondary">{mode === 'verify' ? `${incidentHeading(lang, lead)} · ${where(lead)}` : where(lead)}</span>
              <span className="t-meta text-faint" suppressHydrationWarning>
                {mode === 'verify' ? tx({ en: 'You experienced this problem.', ru: 'Вы сталкивались с этой проблемой.', kk: 'Сіз бұл мәселеге тап болдыңыз.' })
                  : `${tx({ en: 'Reported', ru: 'Сообщили', kk: 'Хабарланды' })} ${ago(lang, lead.first_signal_at)} · ${residentsText(lang, lead.residents)}`}
              </span>
              {mode === 'critical' ? (
                <span className={`t-meta font-bold ${lead.status === 'NEW' ? 'text-amber' : 'text-secondary'}`}>
                  {lead.status === 'NEW' ? tx({ en: 'Reported by residents · not yet confirmed by 109', ru: 'Со слов жителей · 109 ещё не подтвердила', kk: 'Тұрғындардың айтуы бойынша · 109 әлі растамады' }) : tx({ en: 'Confirmed by 109', ru: 'Подтверждено 109', kk: '109 растады' })}
                </span>
              ) : null}
            </span>
          </Link>
          {mode === 'verify' ? (
            <>
              <p className="t-card text-text">{tx({ en: 'Is it really fixed?', ru: 'Она действительно решена?', kk: 'Шынымен шешілді ме?' })}</p>
              <VerifyButtons id={lead.id} mine={lead.my_answer} onDone={() => setPin({ item: lead, mode: 'verify' })} size="sm" />
              {pin ? <button type="button" onClick={release} className="tap self-end t-meta font-bold text-secondary">{tx({ en: 'Done', ru: 'Готово', kk: 'Дайын' })}</button> : null}
            </>
          ) : lead.ask === 'confirm' || pin?.mode === 'confirm' ? (
            <>
              <p className="t-card text-text">{tx({ en: 'Does this affect you?', ru: 'Это затрагивает вас?', kk: 'Бұл сізге қатысты ма?' })}</p>
              <ConfirmButtons id={lead.id} size="sm" onDone={() => { setPin({ item: lead, mode: 'confirm' }); setTimeout(release, 2500) }} />
            </>
          ) : (
            <LinkButton href={`/incident/${lead.code}`} style="secondary" size="sm">{tx({ en: 'What is being done', ru: 'Что делается', kk: 'Не істелуде' })}</LinkButton>
          )}
        </div>
      ) : null}
      {rest.length ? (
        <div className="rise rise-3 flex flex-col gap-1 rounded-[22px] bg-surface p-3 card-shadow">
          <p className="t-label px-2 pb-1 pt-1 text-secondary">{rest.length} {plural(lang, rest.length, { en: ['problem nearby', 'problems nearby'], ru: ['проблема рядом', 'проблемы рядом', 'проблем рядом'], kk: 'мәселе жақын маңда' })}</p>
          {rest.map((i) => (
            <Link key={i.id} href={`/incident/${i.code}`} className="tap flex items-center gap-3 rounded-[14px] px-2 py-2 hover:bg-surface-2">
              <span className="grid size-9 flex-none place-items-center rounded-[12px] bg-surface-2 hairline"><Icon name={SERVICE_ICON[i.service]} size={17} className={i.priority === 'CRITICAL' ? 'text-red' : 'text-text'} /></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="t-row truncate text-text">{incidentHeading(lang, i)}</span>
                <span className="t-meta truncate text-secondary">{[i.distance_m != null && i.relevance !== 'FOLLOWING' ? metresText(lang, i.distance_m) : whereText(lang, i), residentsText(lang, i.residents), tx(STATUS[i.status]?.label ?? STATUS.NEW!.label)].join(' · ')}</span>
              </span>
              <Icon name="chevron" size={15} className="text-faint" />
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/** 109 near you — the consumer side of the incident engine. */
function NearIncidents({ incidents, house, areaId }: { incidents: IncidentLite[]; house: string | null; areaId: string | null }) {
  const { tx } = useApp()
  const open = incidents.filter((i) => !['VERIFIED', 'REJECTED'].includes(i.status))
  const mine = open.find((i) => i.area_id === areaId)
  const first = mine ?? open[0]
  return (
    <section className="rise rise-4 flex flex-col gap-3 rounded-[24px] bg-surface p-4 card-shadow">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Icon name="radar" size={18} className="text-beam" /><h2 className="t-row text-text">{mine ? tx({ en: '109 is handling near you', ru: '109 уже занимается рядом', kk: '109 жақын маңда айналысуда' }) : tx({ en: '109 across Aktau', ru: '109 по городу', kk: '109 қала бойынша' })}</h2></div>
        <Link href="/map?layer=109" className="tap t-meta font-bold text-blue">{open.length} →</Link>
      </div>
      {first ? (
        <IncidentCard i={first} href={false}>
          <div className={`grid gap-2 ${mine && first.status !== 'RESOLVED' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {mine && first.status !== 'RESOLVED' ? <MeTooButton incident={first} homeHouse={house} size="sm" /> : null}
            <LinkButton href={`/incident/${first.code}`} style="secondary" size="sm">{tx({ en: 'Follow', ru: 'Следить', kk: 'Бақылау' })}</LinkButton>
          </div>
        </IncidentCard>
      ) : (
        <p className="t-sub text-secondary">{tx({ en: 'No open requests right now.', ru: 'Открытых обращений сейчас нет.', kk: 'Қазір ашық өтініш жоқ.' })}</p>
      )}
      <LinkButton href="/report" style="outline" size="sm"><Icon name="report" size={16} />{tx({ en: 'Report something else', ru: 'Сообщить о другой проблеме', kk: 'Басқа мәселе туралы хабарлау' })}</LinkButton>
    </section>
  )
}

function UpcomingCard({ e }: { e: CityEventDTO }) {
  const { lang, t } = useApp()
  const h = headline(lang, e)
  const b = statusBadge(lang, e)
  const ongoing = isOngoing(e)
  return (
    <Card tone={ongoing ? 'red' : 'amber'} className="rise rise-2 gap-3">
      <div className="flex items-center justify-between">
        <span className={`grid size-10 place-items-center rounded-[13px] ${ongoing ? 'bg-red text-bg' : 'bg-amber text-bg'}`}><Icon name={CATEGORY_ICON[e.category]} size={20} /></span>
        <div className="flex gap-1.5">{e.is_demo ? <Badge tone="demo">{t('badge.demo')}</Badge> : null}<Badge tone={b.tone}>{b.label}</Badge></div>
      </div>
      <h2 className="t-headline text-text">{h.head}{h.when ? <> · {h.when}</> : null}</h2>
      <YourHome e={e} />
      <p className="t-sub text-secondary" suppressHydrationWarning>{[ongoing ? etaText(lang, e) : windowText(lang, e), areasText(lang, e)].filter(Boolean).join(' · ')}</p>
      {e.reason ? <p className="t-sub text-secondary">{t('event.reason')}: {e.reason}</p> : null}
      <p className="flex items-center gap-1.5 t-meta text-secondary" suppressHydrationWarning><Icon name="shield" size={14} />{sourceLine(lang, e)}</p>
      <LinkButton href={`/event/${e.id}`} style="ink">{t('action.viewInterruption')}<Icon name="arrow" size={16} /></LinkButton>
    </Card>
  )
}

/** Address-based delivery: say plainly that this home is inside (or only near) the affected area. */
function YourHome({ e }: { e: CityEventDTO }) {
  const { tx } = useApp()
  if (e.relevance !== 'DIRECT') return null
  const outage = ['WATER', 'HOT_WATER', 'ELECTRICITY', 'HEATING', 'GAS'].includes(e.category)
  return (
    <p className="flex items-center gap-1.5 t-row text-text">
      <Icon name="home" size={15} className="text-blue" />
      {outage ? tx({ en: 'Your home is inside the outage area', ru: 'Ваш дом входит в зону отключения', kk: 'Үйіңіз ажырату аймағында' }) : tx({ en: 'This affects your home', ru: 'Это касается вашего дома', kk: 'Бұл үйіңізге қатысты' })}
    </p>
  )
}

function ActiveCard({ event }: { event: CityEventDTO }) {
  const { lang, t } = useApp()
  const [detail, setDetail] = useState<CityEventDetailDTO | null>(null)
  const load = useCallback(() => { fetch(`/api/events/${event.id}`).then((r) => r.json()).then(setDetail).catch(() => {}) }, [event.id])
  useEffect(load, [load, event.updated_at])
  const b = statusBadge(lang, event)
  return (
    <>
      <Card tone="red" className="rise rise-2 gap-3">
        <div className="flex items-center justify-between">
          <span className="grid size-10 place-items-center rounded-[13px] bg-red text-bg"><Icon name={CATEGORY_ICON[event.category]} size={20} /></span>
          <div className="flex gap-1.5">{event.is_demo ? <Badge tone="demo">{t('badge.demo')}</Badge> : null}<Badge tone={b.tone} dot>{b.label}</Badge></div>
        </div>
        <h2 className="t-headline text-text">{headline(lang, event).head}</h2>
        <YourHome e={event} />
        <p className="t-card text-text" suppressHydrationWarning>{etaText(lang, event)}</p>
        {event.reason ? <p className="t-sub text-secondary">{t('event.reason')}: {event.reason}</p> : null}
        <p className="flex items-center gap-1.5 t-meta text-secondary" suppressHydrationWarning><Icon name="shield" size={14} />{sourceLine(lang, event)}</p>
        <div className="grid grid-cols-2 gap-2.5">
          <LinkButton href={`/event/${event.id}`} style="ink">{t('action.details')}</LinkButton>
          <NotifyButton eventId={event.id} />
        </div>
      </Card>
      {detail ? <EventHistory detail={detail} /> : null}
    </>
  )
}

function ResolvedCard({ event }: { event: CityEventDTO }) {
  const { lang, t } = useApp()
  return (
    <Card tone="green" className="rise rise-2 gap-3">
      <span className="grid size-10 place-items-center rounded-[13px] bg-green text-bg"><Icon name="check" size={20} /></span>
      <h2 className="t-headline text-text">{headline(lang, { ...event, display_status: 'RESOLVED' }).head}</h2>
      <p className="t-sub text-secondary">{t('resolved.body')}</p>
      <p className="t-meta text-secondary" suppressHydrationWarning>{t('resolved.confirmed', { ago: agoShort(lang, event.resolved_at ?? event.updated_at), source: authorityName(event) })}</p>
      <LinkButton href={`/event/${event.id}`} style="outline">{t('action.viewHistory')}</LinkButton>
    </Card>
  )
}

function AroundCard({ events, data, openPlaces }: { events: CityEventDTO[]; data: NowPayload; openPlaces: OpenPlaces }) {
  const { lang, t } = useApp()
  const wind = data.weather.advisories[0]
  return (
    <section className="flex flex-col gap-2 rounded-[24px] bg-surface p-4 card-shadow">
      <SectionHead title={t('around.title')} action={t('nav.map')} href="/map" />
      {events.slice(0, 4).map((e) => {
        const d = kmOrM(e.distance_m)
        return (
          <InfoRow key={e.id} href={`/event/${e.id}`} icon={CATEGORY_ICON[e.category]} iconClass={isOngoing(e) ? 'text-red' : 'text-amber'}
            title={[headline(lang, e).head, d && e.relevance === 'NEARBY' ? t('around.away', { d }) : e.relevance === 'AREA' ? t('relevance.AREA') : null].filter(Boolean).join(' · ')}
            sub={[windowText(lang, e), areasText(lang, e)].filter(Boolean).join(' · ')} />
        )
      })}
      {wind && !events.some((e) => e.id === wind.event_id) ? (
        <InfoRow href={`/event/${wind.event_id}`} icon="wind" title={t('event.WEATHER.wind_advisory')} sub={`${wind.text} · ${wind.origin === 'APP_ADVISORY' ? t('badge.appAdvisory') : 'Kazhydromet'}`} />
      ) : null}
      <InfoRow href="/map?layer=places" icon="food" title={openPlaces && openPlaces.count ? t('around.placesOpen', { n: openPlaces.count }) : t('around.placesMap')} sub="OpenStreetMap" />
      {!events.length && !wind ? <p className="px-1 t-meta text-secondary">{t('now.calm.city')}</p> : null}
    </section>
  )
}

function GoOutCard({ g }: { g: GoOut }) {
  const { lang, tx } = useApp()
  const at = (iso: string) => {
    const l = new Date(new Date(iso).getTime() + 5 * 3600_000), today = new Date(Date.now() + 5 * 3600_000)
    const t = l.toISOString().slice(11, 16)
    return l.toISOString().slice(0, 10) === today.toISOString().slice(0, 10) ? `${tx({ en: 'today', ru: 'сегодня', kk: 'бүгін' })}${t === '00:00' ? '' : ` ${t}`}`
      : fmtDate(new Date(iso), lang) + (t === '00:00' ? '' : `, ${t}`)
  }
  return (
    <section className="flex flex-col gap-2 rounded-[24px] bg-surface p-4 card-shadow">
      <SectionHead title={tx({ en: 'Where to go', ru: 'Куда сходить', kk: 'Қайда бару' })} action={tx({ en: 'Afisha', ru: 'Афиша', kk: 'Афиша' })} href="/afisha" />
      {g.films ? (
        <InfoRow href="/afisha" icon="film" title={tx({ en: `${g.films} films in cinemas today`, ru: `Сегодня в кино: ${g.films} фильмов`, kk: `Бүгін кинода ${g.films} фильм` })}
          sub={g.next_film ? <span suppressHydrationWarning>{tx({ en: 'Next', ru: 'Ближайший', kk: 'Келесі' })}: {g.next_film.title} · {g.next_film.cinema} · {at(g.next_film.at)}</span> : 'Kinoafisha'} />
      ) : null}
      {g.next_show ? (
        <InfoRow href="/afisha" icon="ticket" title={g.next_show.title.replace(/\s+в Актау$/i, '')} sub={<span suppressHydrationWarning>{at(g.next_show.at)}{g.next_show.venue ? ` · ${g.next_show.venue}` : ''}</span>} />
      ) : null}
    </section>
  )
}

function AskBar() {
  const { t, tx } = useApp()
  const router = useRouter()
  const [q, setQ] = useState('')
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/ask?q=${encodeURIComponent(q.trim())}`) }}
      className="flex flex-col gap-3 rounded-[24px] bg-soft p-5 text-text card-shadow">
      <div className="flex items-center justify-between"><span className="t-label text-secondary">{t('ask.title')}</span><Icon name="sparkle" size={16} className="text-beam" /></div>
      <p className="t-hero !text-[20px] text-text">{tx({ en: 'Ask anything about your city.', ru: 'Спросите о городе что угодно.', kk: 'Қала туралы кез келген сұрақ қойыңыз.' })}</p>
      <label className="flex h-12 items-center gap-2 rounded-[15px] bg-surface px-4 hairline">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ask.q.water')} className="h-full flex-1 bg-transparent t-body text-text outline-none placeholder:text-faint" aria-label={t('ask.placeholder')} />
        <button type="submit" className="tap grid size-8 place-items-center rounded-full beam-fill" aria-label="Ask"><Icon name="arrow" size={16} className="text-on-blue" /></button>
      </label>
    </form>
  )
}

function OfflineState({ lastOk, onRetry, busy, services }: { lastOk: string; onRetry: () => void; busy: boolean; services: ServiceStatusDTO[] }) {
  const { t } = useApp()
  const shown = services.filter((s) => s.key === 'water' || s.key === 'electricity')
  return (
    <div className="flex flex-col gap-4 fade-in">
      <h1 className="t-title text-text">{t('offline.title')}</h1>
      <Card tone="soft" className="gap-3">
        <Icon name="clock" size={28} className="text-blue" />
        <p className="t-hero text-text" suppressHydrationWarning>{t('offline.last', { time: fmtTime(new Date(lastOk)) })}</p>
        <p className="t-body text-secondary">{t('offline.body')}</p>
        <Button style="secondary" onClick={onRetry} disabled={busy}>{t('action.tryAgain')}</Button>
      </Card>
      {shown.map((s) => (
        <Card key={s.key} className="gap-2">
          <p className="t-row text-text">{t('unknown.title', { service: t(`service.${s.key}`) })}</p>
          <p className="t-sub text-secondary">{t('unknown.body')}</p>
          <Badge tone="unknown" className="self-start">{t('badge.notConfirmed')}</Badge>
        </Card>
      ))}
      <p className="t-sub text-secondary">{t('offline.saved')}</p>
    </div>
  )
}

/** Subscribes this installation to updates for one event (in-app inbox + push when available). */
export function NotifyButton({ eventId, label, style = 'secondary' }: { eventId: string; label?: string; style?: 'primary' | 'secondary' }) {
  const { t } = useApp()
  const [done, setDone] = useState(false)
  return (
    <Button style={style} disabled={done} onClick={async () => {
      const r = await fetch('/api/me/preferences', { cache: 'no-store' })
      const prefs = await r.json()
      await fetch('/api/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prefs) })
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
      setDone(true)
      void eventId
    }}>{done ? <><Icon name="check" size={18} /> {t('action.notifyMe')}</> : label ?? t('action.notify')}</Button>
  )
}
