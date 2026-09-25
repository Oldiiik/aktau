'use client'
// News · "Aktau Today". The date is painted like a facade number; underneath,
// three strands that are never blended into one voice:
//   stories   local media — headline + the publisher's own summary, linked out
//   official  city events that passed Aktau's review (the verified pipeline)
//   fixed     what 109 closed this week, and whether residents confirmed it
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { agoShort } from '@aktau/i18n'
import { fmtDate, fmtTime, fmtWeekday, localParts } from '@aktau/normalization/time'
import type { Lang } from '@aktau/types'
import type { CityEventDTO } from '@aktau/types'
import type { FixedDTO, NewsArticleDTO, NewsFront } from '@aktau/server'
import { useApp, useRealtime, type L3 } from './app'
import { Badge, Beacon, Icon, Plaque, type IconName } from './primitives'
import { SERVICE_ICON, duration, incidentName, placeText } from './incident-ui'
import { CATEGORY_ICON, authorityName, headline, statusBadge, windowText } from '@/lib/present'
import { sectionPhoto } from '@/lib/photos'
import { plural } from '@/lib/plural'

// ── Sections ────────────────────────────────────────────────────────────────
const SECTION: Record<string, { label: L3; icon: IconName; tone: string }> = {
  society: { label: { en: 'Society', ru: 'Общество', kk: 'Қоғам' }, icon: 'people', tone: 'var(--blue)' },
  vlast: { label: { en: 'Government', ru: 'Власть', kk: 'Билік' }, icon: 'building', tone: 'var(--blue)' },
  incidents: { label: { en: 'Incidents', ru: 'Происшествия', kk: 'Оқиғалар' }, icon: 'alert', tone: 'var(--red)' },
  communal: { label: { en: 'Utilities', ru: 'ЖКХ', kk: 'Коммуналдық' }, icon: 'water', tone: 'var(--blue)' },
  ecology: { label: { en: 'Ecology', ru: 'Экология', kk: 'Экология' }, icon: 'tree', tone: 'var(--blue)' },
  ekonomika: { label: { en: 'Economy', ru: 'Экономика', kk: 'Экономика' }, icon: 'layers', tone: 'var(--blue)' },
  culture: { label: { en: 'Culture', ru: 'Культура', kk: 'Мәдениет' }, icon: 'lamp', tone: 'var(--blue)' },
  sport: { label: { en: 'Sport', ru: 'Спорт', kk: 'Спорт' }, icon: 'flame', tone: 'var(--blue)' },
  region: { label: { en: 'Region', ru: 'Регион', kk: 'Өңір' }, icon: 'map', tone: 'var(--blue)' },
  kazakhstan: { label: { en: 'Kazakhstan', ru: 'Казахстан', kk: 'Қазақстан' }, icon: 'globe', tone: 'var(--blue)' },
  world: { label: { en: 'World', ru: 'Мир', kk: 'Әлем' }, icon: 'globe', tone: 'var(--blue)' },
}
const sec = (k: string) => SECTION[k] ?? SECTION.region!

const weekday = (lang: Lang, d: Date) => fmtWeekday(d, lang)
const dayKey = (iso: string) => { const p = localParts(new Date(iso)); return `${p.year}-${p.month}-${p.day}` }

/** Lada serves resized copies under /cache/imagine/<size>/uploads/… */
function img(url: string, size: '1200' | '340x180' = '1200') {
  return url.replace(/^https:\/\/www\.lada\.kz\/uploads\//, `https://www.lada.kz/cache/imagine/${size}/uploads/`)
}

// ── Page ────────────────────────────────────────────────────────────────────
export function NewsView({ initial, story = null, section: initialSection = null }: { initial: NewsFront; story?: string | null; section?: string | null }) {
  const { lang, tx } = useApp()
  const [data, setData] = useState(initial)
  const [queued, setQueued] = useState<NewsFront | null>(null)
  const [older, setOlder] = useState<NewsArticleDTO[]>([])
  const [more, setMore] = useState<'idle' | 'loading' | 'done'>('idle')
  const [section, setSection] = useState<string>(initialSection && SECTION[initialSection] ? initialSection : 'all')
  const [scope, setScope] = useState<Scope>(initialSection === 'kazakhstan' || initialSection === 'world' ? initialSection : 'aktau')
  const [open, setOpen] = useState<string | null>(story)
  const top = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      const next = (await (await fetch(`/api/news?lang=${lang}`, { cache: 'no-store' })).json()) as NewsFront
      const known = new Set(data.articles.map((a) => a.id))
      // New stories wait behind a pill so the page never jumps under the reader;
      // official and 109 changes apply at once.
      if (next.articles.some((a) => !known.has(a.id))) { setQueued(next); setData((d) => ({ ...next, articles: d.articles })) } else setData(next)
    } catch { /* offline: keep what we have */ }
  }, [lang, data.articles])
  useRealtime(() => void refresh(), ['news', 'city_events', 'incidents'])

  const base = scope === 'aktau' ? data.articles : scope === 'kazakhstan' ? data.national : data.world
  const all = useMemo(() => [...base, ...older.filter((o) => (scope === 'aktau' ? o.section !== 'kazakhstan' && o.section !== 'world' : o.section === scope) && !base.some((a) => a.id === o.id))], [base, older, scope])
  const everything = useMemo(() => [...data.articles, ...data.national, ...data.world, ...older], [data, older])
  const byId = useMemo(() => new Map(everything.map((a) => [a.id, a])), [everything])
  const filtered = section === 'all' ? all : all.filter((a) => a.section === section)

  // Deep link: /news?story=<id> (shareable), kept in sync without a navigation.
  useEffect(() => {
    const u = new URL(location.href)
    if (open) u.searchParams.set('story', open); else u.searchParams.delete('story')
    const sec = scope !== 'aktau' ? scope : section
    if (sec !== 'all') u.searchParams.set('section', sec); else u.searchParams.delete('section')
    history.replaceState(history.state, '', u)
  }, [open, section, scope])

  const loadMore = async () => {
    const last = all[all.length - 1]
    if (!last) return
    setMore('loading')
    try {
      const r = (await (await fetch(`/api/news?scope=${scope}&before=${encodeURIComponent(last.published_at)}`)).json()) as { articles: NewsArticleDTO[] }
      setOlder((o) => [...o, ...r.articles])
      setMore(r.articles.length ? 'idle' : 'done')
    } catch { setMore('idle') }
  }

  const front = section === 'all' || scope !== 'aktau'
  const lead = front ? all.find((a) => a.image_url) ?? all[0] ?? null : null
  const secondary = front ? all.filter((a) => a !== lead).slice(0, 4) : []
  const rest = front ? all.filter((a) => a !== lead && !secondary.includes(a)) : filtered
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of all) c[a.section] = (c[a.section] ?? 0) + 1
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [all])

  return (
    <div ref={top} className="flex flex-col gap-8 lg:gap-10">
      <Masthead data={data} />
      <ScopeTabs scope={scope} counts={{ aktau: data.articles.length, kazakhstan: data.national.length, world: data.world.length }}
        onChange={(v) => { setScope(v); setSection('all'); setMore('idle') }} />

      {queued ? (
        <button type="button" onClick={() => { setData(queued); setQueued(null); top.current?.scrollIntoView({ behavior: 'smooth' }) }}
          className="sheet-in tap sticky top-[calc(64px+env(safe-area-inset-top))] z-30 lg:top-3 mx-auto -mb-4 inline-flex h-10 items-center gap-2 self-center rounded-full bg-text px-4 text-[13px] font-bold text-bg shadow-[var(--shadow-lg)]">
          <Beacon tone="green" live /> {tx({ en: 'New stories, show', ru: 'Новые материалы — показать', kk: 'Жаңа материалдар — көрсету' })}
        </button>
      ) : null}

      {!all.length ? <EmptyNews /> : null}

      {lead ? (
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-8" aria-label={tx({ en: 'Top stories', ru: 'Главное', kk: 'Басты' })}>
          <LeadStory a={lead} onOpen={setOpen} />
          <div className="rise rise-2 flex flex-col">
            <p className="t-label mb-2 text-faint">{tx({ en: 'More top stories', ru: 'Ещё главное', kk: 'Тағы басты' })}</p>
            <ol className="flex flex-col divide-y divide-[var(--line)]">
              {secondary.map((a) => <li key={a.id}><RowStory a={a} onOpen={setOpen} /></li>)}
            </ol>
          </div>
        </section>
      ) : null}

      {section === 'all' && scope === 'aktau' ? (
        <section className="rise rise-3 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-8">
          <OfficialWord events={data.official} />
          <FixedBy109 fixed={data.fixed} />
        </section>
      ) : null}

      {all.length ? (
        <section className="flex flex-col gap-5">
          {scope === 'aktau' ? <div className="sticky top-[calc(52px+env(safe-area-inset-top))] z-20 -mx-5 bg-bg/85 px-5 py-2.5 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-10 lg:px-10">
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto" role="tablist" aria-label={tx({ en: 'Sections', ru: 'Рубрики', kk: 'Айдарлар' })}>
              <SectionChip active={section === 'all'} onClick={() => setSection('all')} label={tx({ en: 'All stories', ru: 'Все материалы', kk: 'Барлығы' })} n={all.length} />
              {counts.map(([k, n]) => <SectionChip key={k} active={section === k} onClick={() => setSection(k)} label={tx(sec(k).label)} n={n} tone={sec(k).tone} />)}
            </div>
          </div> : null}
          <StoryGrid articles={rest} onOpen={setOpen} />
          {more !== 'done' ? (
            <button type="button" onClick={() => void loadMore()} disabled={more === 'loading'}
              className="tap mx-auto inline-flex h-11 items-center gap-2 rounded-full bg-surface px-5 text-[13px] font-bold text-text card-shadow disabled:opacity-60">
              {more === 'loading' ? tx({ en: 'Loading…', ru: 'Загрузка…', kk: 'Жүктелуде…' }) : tx({ en: 'Earlier stories', ru: 'Более ранние материалы', kk: 'Ертерек материалдар' })}
            </button>
          ) : <p className="text-center t-meta text-faint">{tx({ en: 'That’s everything we have so far.', ru: 'Это всё, что у нас есть.', kk: 'Қазірше бәрі осы.' })}</p>}
        </section>
      ) : null}

      <footer className="flex flex-col gap-1 border-t border-line pt-5 t-meta text-faint">
        <p>{tx({ en: 'Stories come from Lada.kz. Full articles open on the publisher’s own page inside the app; Aktau does not copy their text.', ru: 'Материалы Lada.kz. Полный текст открывается на странице издания внутри приложения, Aktau не копирует статьи.', kk: 'Материалдар Lada.kz-тен. Толық мәтін басылымның өз бетінде ашылады.' })}</p>
        <p>{tx({ en: 'Official word and 109 fixes come from Aktau’s own verified pipeline, open any item to see its sources.', ru: 'Официальные сообщения и работы 109 — из проверенного конвейера Aktau; у каждого есть источники.', kk: 'Ресми хабарламалар мен 109 жұмыстары — Aktau-дың тексерілген деректерінен.' })}</p>
      </footer>

      {open && byId.get(open) ? <Reader a={byId.get(open)!} all={everything} official={data.official} onClose={() => setOpen(null)} onOpen={setOpen} /> : null}
    </div>
  )
}

type Scope = 'aktau' | 'kazakhstan' | 'world'
const SCOPES: Array<{ key: Scope; label: L3 }> = [
  { key: 'aktau', label: { en: 'Aktau', ru: 'Актау', kk: 'Ақтау' } },
  { key: 'kazakhstan', label: { en: 'Kazakhstan', ru: 'Казахстан', kk: 'Қазақстан' } },
  { key: 'world', label: { en: 'World', ru: 'Мир', kk: 'Әлем' } },
]

/** Where the news is from. Typographic tabs, not pills: the scope is the page's first choice. */
function ScopeTabs({ scope, counts, onChange }: { scope: Scope; counts: Record<Scope, number>; onChange: (s: Scope) => void }) {
  const { tx } = useApp()
  return (
    <div className="-mt-2 flex items-end gap-6 border-b border-line" role="tablist" aria-label={tx({ en: 'News from', ru: 'Новости', kk: 'Жаңалықтар' })}>
      {SCOPES.map((s) => (
        <button key={s.key} type="button" role="tab" aria-selected={scope === s.key} onClick={() => onChange(s.key)}
          className={`tap relative -mb-px flex items-baseline gap-1.5 border-b-2 pb-3 font-[family-name:var(--font-display)] text-[19px] font-semibold tracking-[-0.02em] transition-colors sm:text-[22px] ${scope === s.key ? 'border-blue text-text' : 'border-transparent text-faint hover:text-secondary'}`}>
          {tx(s.label)}<span className="font-[family-name:var(--font-sans)] text-[12px] font-[500] tracking-normal text-faint">{counts[s.key]}</span>
        </button>
      ))}
    </div>
  )
}

// ── Masthead: today's date as a facade plaque ───────────────────────────────
function Masthead({ data }: { data: NewsFront }) {
  const { lang, tx } = useApp()
  const now = new Date(data.generated_at)
  const p = localParts(now)
  const f = data.weather.forecast
  const sea = data.weather.marine?.sea_temp_c
  return (
    <header className="rise relative flex flex-col gap-6 overflow-hidden rounded-[32px] bg-surface p-5 card-shadow sm:p-7 lg:p-9 min-[1440px]:flex-row min-[1440px]:items-end min-[1440px]:justify-between">
      <div className="panel-seams absolute inset-0 opacity-60" aria-hidden />
      <div className="relative flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:gap-7">
        <span className="xl:hidden"><Plaque district={String(p.day).padStart(2, '0')} house={String(p.month).padStart(2, '0')} size={84} /></span>
        <span className="hidden xl:block"><Plaque district={String(p.day).padStart(2, '0')} house={String(p.month).padStart(2, '0')} size={128} /></span>
        <div className="flex flex-col gap-1.5 sm:pb-2">
          <p className="t-label text-faint" suppressHydrationWarning>{weekday(lang, now)} · {fmtTime(now)}</p>
          <h1 className="font-[family-name:var(--font-display)] text-[clamp(26px,4.4vw,44px)] font-semibold leading-[0.98] tracking-[-0.04em] text-text">
            {tx({ en: 'Aktau', ru: 'Актау', kk: 'Ақтау' })}<br /><span className="text-secondary">{tx({ en: 'today', ru: 'сегодня', kk: 'бүгін' })}</span>
          </h1>
        </div>
      </div>
      <div className="relative flex max-w-[640px] flex-col gap-3 min-[1440px]:max-w-[400px] min-[1440px]:items-end min-[1440px]:text-right">
        <Brief data={data} />
        <div className="flex flex-wrap gap-1.5 min-[1440px]:justify-end">
          {f?.temperature_c != null ? <Pill icon="sun">{Math.round(f.temperature_c)}°{data.weather.text ? ` · ${data.weather.text.toLowerCase()}` : ''}</Pill> : null}
          {f?.wind_ms != null ? <Pill icon="wind">{Math.round(f.wind_ms)} {tx({ en: 'm/s', ru: 'м/с', kk: 'м/с' })}</Pill> : null}
          {sea != null ? <Pill icon="water">{tx({ en: 'Caspian', ru: 'Каспий', kk: 'Каспий' })} {Math.round(sea)}°</Pill> : null}
          <Pill icon="radar">{data.pulse.open} {tx({ en: 'open at 109', ru: 'открыто в 109', kk: '109-да ашық' })}</Pill>
        </div>
      </div>
      <span className="sr-only">{fmtDate(now, lang)}</span>
    </header>
  )
}

function Pill({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-bg px-3 text-[12px] font-bold text-text hairline"><Icon name={icon} size={14} className="text-secondary" />{children}</span>
}

/** Today in three lines, built from the data (no model involved). */
function Brief({ data }: { data: NewsFront }) {
  const { tx, lang } = useApp()
  const inForce = data.official.filter((e) => e.display_status !== 'RESOLVED' && e.display_status !== 'CANCELLED').length
  const fixed = data.fixed.length
  const confirmed = data.fixed.filter((f) => f.status === 'VERIFIED').length
  const today = data.articles.filter((a) => dayKey(a.published_at) === dayKey(data.generated_at)).length
  const n = (v: number) => <b className="t-num font-semibold text-text">{v}</b>
  const Row = ({ icon, children }: { icon: IconName; children: React.ReactNode }) => (
    <li className="flex items-start gap-2.5"><Icon name={icon} size={16} className="mt-[3px] flex-none text-blue" /><span>{children}</span></li>
  )
  return (
    <ul className="flex flex-col gap-1.5 text-[14.5px] leading-[1.45] text-secondary min-[1440px]:items-end">
      <Row icon="shield">{inForce
        ? <>{n(inForce)} {plural(lang, inForce, { en: ['official notice in force', 'official notices in force'], ru: ['официальное сообщение в силе', 'официальных сообщения в силе', 'официальных сообщений в силе'], kk: 'ресми хабарлама күшінде' })}</>
        : tx({ en: 'No official notices in force', ru: 'Официальных сообщений в силе нет', kk: 'Күшіндегі ресми хабарлама жоқ' })}</Row>
      {fixed ? <Row icon="check">{tx({ en: '109 fixed', ru: '109 решила', kk: '109 шешті:' })} {n(fixed)} {plural(lang, fixed, { en: ['problem this week', 'problems this week'], ru: ['проблему за неделю', 'проблемы за неделю', 'проблем за неделю'], kk: 'мәселе осы аптада' })}{confirmed ? <>, {tx({ en: 'residents confirmed', ru: 'жители подтвердили', kk: 'тұрғындар растады:' })} {n(confirmed)}</> : null}</Row> : null}
      {today ? <Row icon="news">{n(today)} {plural(lang, today, { en: ['local story today', 'local stories today'], ru: ['местный материал сегодня', 'местных материала сегодня', 'местных материалов сегодня'], kk: 'жергілікті материал бүгін' })}</Row> : null}
    </ul>
  )
}

// ── Stories ─────────────────────────────────────────────────────────────────
function Cover({ a, size = '1200', className = '', eager = false }: { a: NewsArticleDTO; size?: '1200' | '340x180'; className?: string; eager?: boolean }) {
  const [broken, setBroken] = useState(false)
  const s = sec(a.section)
  if (!a.image_url || broken) {
    const ph = sectionPhoto(a.section)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={ph.src} alt="" loading="lazy" className={`object-cover saturate-[0.85] ${className}`} data-section={s.icon} />
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- publisher-hosted image, loaded by the reader's browser
    <img src={img(a.image_url, size)} alt="" referrerPolicy="no-referrer" loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setBroken(true)}
      className={`object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.035] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${className}`} />
  )
}

function Kicker({ a, light = false }: { a: NewsArticleDTO; light?: boolean }) {
  const { lang, tx } = useApp()
  const s = sec(a.section)
  return (
    <span className={`flex items-center gap-1.5 text-[12.5px] font-[500] ${light ? 'text-white/75' : 'text-faint'}`}>
      <span className={light ? 'text-white' : 'font-[600]'} style={light ? undefined : { color: s.tone }}>{tx(s.label)}</span>
      <span suppressHydrationWarning>· {agoShort(lang, a.published_at)}</span>
    </span>
  )
}

function LeadStory({ a, onOpen }: { a: NewsArticleDTO; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(a.id)} className="rise rise-1 tap group relative block min-h-[420px] overflow-hidden rounded-[28px] bg-ink text-left card-shadow sm:min-h-[480px] lg:min-h-[540px]">
      <Cover a={a} eager className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(6_20_28/0.05)_0%,rgb(6_20_28/0)_22%,rgb(6_20_28/0.62)_52%,rgb(6_20_28/0.95)_100%)]" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-5 sm:p-7 lg:p-8">
        <Kicker a={a} light />
        <h2 className="max-w-[24ch] font-[family-name:var(--font-display)] text-[clamp(24px,3.2vw,38px)] font-semibold leading-[1.06] tracking-[-0.03em] text-white [text-wrap:balance]">{a.headline}</h2>
        {a.lede ? <p className="line-clamp-2 max-w-[62ch] t-body !text-[15px] text-white/75">{a.lede}</p> : null}
        <p className="t-meta text-white/55">{[...new Set([a.author, a.publisher].filter(Boolean))].join(' · ')}</p>
      </div>
    </button>
  )
}

function RowStory({ a, onOpen }: { a: NewsArticleDTO; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(a.id)} className="tap group flex w-full items-start gap-4 py-4 text-left first:pt-1">
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Kicker a={a} />
        <span className="t-card !text-[15.5px] text-text [text-wrap:pretty] group-hover:text-blue">{a.headline}</span>
      </span>
      <span className="relative h-[76px] w-[104px] flex-none overflow-hidden rounded-[14px]"><Cover a={a} className="h-full w-full" /></span>
    </button>
  )
}

function StoryCard({ a, onOpen, wide = false }: { a: NewsArticleDTO; onOpen: (id: string) => void; wide?: boolean }) {
  return (
    <button type="button" onClick={() => onOpen(a.id)}
      className={`tap group flex h-full flex-col overflow-hidden rounded-[24px] bg-surface text-left card-shadow hover:shadow-[var(--shadow-lg)] ${wide ? 'lg:col-span-2 lg:flex-row' : ''}`}>
      <span className={`relative block flex-none overflow-hidden ${wide ? 'aspect-[16/9] lg:aspect-auto lg:w-[55%]' : 'aspect-[16/9]'}`}><Cover a={a} className="absolute inset-0 h-full w-full" /></span>
      <span className={`flex flex-1 flex-col gap-2.5 p-5 ${wide ? 'lg:justify-center lg:p-7' : ''}`}>
        <Kicker a={a} />
        <span className={`text-text [text-wrap:pretty] group-hover:text-blue ${wide ? 't-headline !text-[21px]' : 't-card !text-[16.5px] !leading-[1.3]'}`}>{a.headline}</span>
        {a.lede ? <span className={`t-sub text-secondary ${wide ? 'line-clamp-4' : 'line-clamp-3'}`}>{a.lede}</span> : null}
        <span className="mt-auto pt-1 t-meta text-faint">{[...new Set([a.author, a.publisher].filter(Boolean))].join(' · ')}</span>
      </span>
    </button>
  )
}

/** Stories grouped by day in Aktau time; every seventh card runs wide for rhythm. */
function StoryGrid({ articles, onOpen }: { articles: NewsArticleDTO[]; onOpen: (id: string) => void }) {
  const { lang, tx } = useApp()
  const days: Array<{ key: string; label: string; items: NewsArticleDTO[] }> = []
  const todayKey = dayKey(new Date().toISOString())
  const yKey = dayKey(new Date(Date.now() - 86400_000).toISOString())
  for (const a of articles) {
    const k = dayKey(a.published_at)
    let d = days.find((x) => x.key === k)
    if (!d) {
      const label = k === todayKey ? tx({ en: 'Today', ru: 'Сегодня', kk: 'Бүгін' }) : k === yKey ? tx({ en: 'Yesterday', ru: 'Вчера', kk: 'Кеше' }) : `${weekday(lang, new Date(a.published_at))}, ${fmtDate(new Date(a.published_at), lang)}`
      d = { key: k, label, items: [] }
      days.push(d)
    }
    d.items.push(a)
  }
  if (!articles.length) return <p className="t-sub text-secondary">{tx({ en: 'No stories in this section yet.', ru: 'В этой рубрике пока нет материалов.', kk: 'Бұл айдарда әзірге материал жоқ.' })}</p>
  return (
    <div className="flex flex-col gap-8">
      {days.map((d) => (
        <section key={d.key} className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <h3 className="font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-[-0.02em] text-text first-letter:uppercase" suppressHydrationWarning>{d.label}</h3>
            <span className="h-px flex-1 bg-line" />
            <span className="t-mono text-[11px] text-faint">{d.items.length}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
            {d.items.map((a, i) => <StoryCard key={a.id} a={a} onOpen={onOpen} wide={i % 7 === 3 && d.items.length > 4} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function SectionChip({ active, onClick, label, n, tone }: { active: boolean; onClick: () => void; label: string; n: number; tone?: string }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={`tap inline-flex h-9 flex-none items-center gap-2 rounded-full px-3.5 text-[12.5px] font-bold ${active ? 'bg-text text-bg' : 'bg-surface text-text card-shadow hover:bg-surface-2'}`}>
      {label}<span className={`t-mono text-[10.5px] ${active ? 'opacity-60' : 'text-faint'}`}>{n}</span>
    </button>
  )
}

function EmptyNews() {
  const { tx } = useApp()
  return (
    <div className="flex flex-col items-start gap-2 rounded-[24px] bg-soft p-6">
      <Icon name="news" size={24} className="text-blue" />
      <p className="t-card text-text">{tx({ en: 'The newsroom is warming up.', ru: 'Лента собирается.', kk: 'Лента жиналуда.' })}</p>
      <p className="t-sub text-secondary">{tx({ en: 'Local stories arrive every 15 minutes from Lada.kz. Official notices and 109 fixes appear here as soon as they are published.', ru: 'Местные новости приходят с Lada.kz каждые 15 минут. Официальные сообщения и работы 109 появятся сразу после публикации.', kk: 'Жергілікті жаңалықтар Lada.kz-тен 15 минут сайын келеді.' })}</p>
    </div>
  )
}

// ── Official word & 109 ─────────────────────────────────────────────────────
function OfficialWord({ events }: { events: CityEventDTO[] }) {
  const { lang, tx } = useApp()
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[26px] bg-surface p-5 card-shadow sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5"><Icon name="shield" size={18} className="text-blue" /><h2 className="t-section text-text">{tx({ en: 'Official word', ru: 'Официально', kk: 'Ресми' })}</h2></div>
        <Badge tone="official">{tx({ en: 'Verified by Aktau', ru: 'Проверено Aktau', kk: 'Aktau тексерген' })}</Badge>
      </div>
      {events.length ? (
        <ul className="flex flex-col divide-y divide-[var(--line)]">
          {events.slice(0, 5).map((e) => {
            const h = headline(lang, e)
            const b = statusBadge(lang, e)
            const w = windowText(lang, e)
            return (
              <li key={e.id}>
                <Link href={`/event/${e.id}`} className="tap group flex items-start gap-3 py-3">
                  <span className="grid size-10 flex-none place-items-center rounded-[13px] bg-soft"><Icon name={CATEGORY_ICON[e.category] ?? 'shield'} size={19} className="text-blue" /></span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="t-row text-text group-hover:text-blue">{h.head}{h.when ? ` · ${h.when}` : ''}</span>
                    <span className="t-meta text-secondary">{[authorityName(e), w, e.location_text].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="flex flex-none flex-col items-end gap-1">
                    <Badge tone={b.tone}>{b.label}</Badge>
                    {e.is_demo ? <Badge tone="demo">DEMO</Badge> : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="t-sub text-secondary">{tx({ en: 'No planned outages or closures announced. When a utility or the akimat posts one, it appears here after review.', ru: 'Плановых отключений и перекрытий не объявлено. Когда служба или акимат их опубликует, они появятся здесь после проверки.', kk: 'Жоспарлы ажыратулар жарияланбаған.' })}</p>
      )}
      {events.length > 5 ? <Link href="/map?layer=official" className="tap self-start t-meta font-bold text-blue">{tx({ en: `All ${events.length} on the map →`, ru: `Все ${events.length} на карте →`, kk: `Барлығы ${events.length} картада →` })}</Link> : null}
    </div>
  )
}

function FixedBy109({ fixed }: { fixed: FixedDTO[] }) {
  const { lang, tx } = useApp()
  const confirmed = fixed.filter((f) => f.status === 'VERIFIED').length
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-[26px] bg-surface p-5 text-text card-shadow sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5"><Icon name="check" size={18} className="text-green" /><h2 className="t-section text-text">{tx({ en: 'Fixed by 109 this week', ru: '109 исправила за неделю', kk: '109 осы аптада түзетті' })}</h2></div>
        <span className="t-num text-[26px] font-semibold leading-none text-green">{fixed.length}</span>
      </div>
      {fixed.length ? (
        <>
          <div className="rail no-scrollbar -mx-5 flex snap-x gap-3 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
            {fixed.slice(0, 10).map((f) => (
              <Link key={f.id} href={`/incident/${f.id}`} className="tap flex w-[210px] flex-none snap-start flex-col gap-3 overflow-hidden rounded-[18px] bg-bg hairline hover:bg-surface-2">
                {f.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.photo} alt="" loading="lazy" className="-mb-1 aspect-[4/3] w-full object-cover" />
                ) : null}
                <span className="flex flex-1 flex-col gap-3 px-4 pb-4 first:pt-4">
                <span className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-[12px] bg-green-soft"><Icon name={SERVICE_ICON[f.service as keyof typeof SERVICE_ICON] ?? 'check'} size={17} className="text-green" /></span>
                  {f.status === 'VERIFIED' ? <span className="inline-flex items-center gap-1 t-meta font-bold text-green"><Icon name="people" size={13} />{tx({ en: 'confirmed', ru: 'подтверждено', kk: 'расталды' })}</span> : <span className="t-meta text-faint">{tx({ en: 'awaiting check', ru: 'ждёт проверки', kk: 'тексеруде' })}</span>}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="t-row text-text">{incidentName(lang, f.service as never)}</span>
                  <span className="t-meta text-secondary">{placeText(lang, { designator: f.designator, house: f.house })}</span>
                </span>
                <span className="flex items-center justify-between t-mono text-[10.5px] text-faint">
                  <span>{f.code}</span>
                  {f.minutes_to_fix ? <span>{tx({ en: 'in', ru: 'за', kk: '' })} {duration(lang, f.minutes_to_fix)}</span> : null}
                </span>
                {f.is_demo ? <Badge tone="demo" className="self-start">DEMO</Badge> : null}
                </span>
              </Link>
            ))}
          </div>
          <p className="t-meta text-secondary">{confirmed
            ? tx({ en: `Residents confirmed ${confirmed} of ${fixed.length} are actually fixed.`, ru: `Жители подтвердили: ${confirmed} из ${fixed.length} действительно исправлены.`, kk: `Тұрғындар ${fixed.length}-тің ${confirmed}-ін растады.` })
            : tx({ en: 'Residents nearby are asked to confirm each fix.', ru: 'Жителей рядом просят подтвердить каждое исправление.', kk: 'Жақын тұрғындардан растау сұралады.' })}</p>
        </>
      ) : (
        <p className="t-sub text-secondary">{tx({ en: 'Nothing closed yet this week. Report a problem and follow it here.', ru: 'На этой неделе пока ничего не закрыто. Сообщите о проблеме — и следите за ней здесь.', kk: 'Осы аптада әзірге ештеңе жабылмаған.' })} <Link href="/report" className="font-bold text-blue">{tx({ en: 'Report', ru: 'Сообщить', kk: 'Хабарлау' })} →</Link></p>
      )}
    </div>
  )
}

// ── Reader ──────────────────────────────────────────────────────────────────
const MKR = /(\d{1,2}[АаБбВвГг]?)\s*(?:-?\s*(?:го|й)?\s*)?(?:мкр|микрорайон|ш\/а|шағын)/g

function Reader({ a, all, official, onClose, onOpen }: { a: NewsArticleDTO; all: NewsArticleDTO[]; official: CityEventDTO[]; onClose: () => void; onOpen: (id: string) => void }) {
  const { lang, tx } = useApp()
  const closeRef = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [full, setFull] = useState(false)
  const [drag, setDrag] = useState(0)
  const dragFrom = useRef<number | null>(null)
  const s = sec(a.section)
  // Phones: pull the sheet down from its top (while scrolled to the top) to close it.
  const onTouchStart = (e: React.TouchEvent) => { dragFrom.current = (panel.current?.scrollTop ?? 0) <= 0 ? e.touches[0]!.clientY : null }
  const onTouchMove = (e: React.TouchEvent) => { if (dragFrom.current != null) setDrag(Math.max(0, e.touches[0]!.clientY - dragFrom.current)) }
  const onTouchEnd = () => { if (drag > 110) onClose(); else setDrag(0); dragFrom.current = null }

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.() }
  }, [onClose])
  useEffect(() => { panel.current?.scrollTo({ top: 0 }); setFull(false) }, [a.id])

  // Official events in a microdistrict the story names ("28А микрорайона" ↔ 28А).
  const text = `${a.headline} ${a.lede ?? ''}`
  const named = new Set([...text.matchAll(MKR)].map((m) => m[1]!.toUpperCase()))
  const related = official.filter((e) => e.areas.some((ar) => ar.designator && named.has(ar.designator.toUpperCase())))
  const same = all.filter((x) => x.section === a.section && x.id !== a.id).slice(0, 3)
  const published = new Date(a.published_at)

  const share = async () => {
    const url = `${location.origin}/news?story=${a.id}`
    try {
      if (navigator.share) await navigator.share({ title: a.headline, url })
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800) }
    } catch { /* dismissed */ }
  }

  if (full) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={a.headline}>
        <div className="flex h-14 flex-none items-center gap-2 border-b border-line bg-surface px-2 pt-[env(safe-area-inset-top)] sm:px-4">
          <button type="button" onClick={() => setFull(false)} className="tap inline-flex h-10 items-center gap-1 rounded-full px-3 text-[14px] font-[600] text-text hover:bg-surface-2">
            <Icon name="back" size={18} />{tx({ en: 'Summary', ru: 'Кратко', kk: 'Қысқаша' })}
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-[13px] text-secondary">{a.publisher} · {a.headline}</span>
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="tap grid size-10 place-items-center rounded-full text-secondary hover:bg-surface-2 hover:text-text" aria-label={tx({ en: 'Open in browser', ru: 'Открыть в браузере', kk: 'Браузерде ашу' })}><Icon name="external" size={17} /></a>
          <button ref={closeRef} type="button" onClick={onClose} className="tap grid size-10 place-items-center rounded-full text-secondary hover:bg-surface-2 hover:text-text" aria-label={tx({ en: 'Close', ru: 'Закрыть', kk: 'Жабу' })}><Icon name="x" size={18} /></button>
        </div>
        {/* The publisher's own page, as they publish it (their text, photos and ads). */}
        <iframe src={a.url} title={a.headline} className="w-full flex-1 border-0 bg-white" referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="reader-title">
      <button type="button" className="fade-in absolute inset-0 bg-[rgb(6_20_28/0.55)] backdrop-blur-[3px]" onClick={onClose} aria-label={tx({ en: 'Close', ru: 'Закрыть', kk: 'Жабу' })} tabIndex={-1} />
      <div ref={panel} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : { transition: 'transform 260ms cubic-bezier(0.2,0.8,0.2,1)' }}
        className="sheet-in no-scrollbar relative flex max-h-[92dvh] w-full max-w-[760px] flex-col overflow-y-auto overscroll-contain rounded-t-[30px] bg-surface pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-lg)] sm:rounded-[30px]">
        <span className="absolute left-1/2 top-2 z-10 h-1.5 w-10 -translate-x-1/2 rounded-full bg-white/70 sm:hidden" aria-hidden />
        <div className="relative aspect-[16/9] w-full flex-none overflow-hidden bg-soft">
          <Cover a={a} eager className="absolute inset-0 h-full w-full" />
          <button ref={closeRef} type="button" onClick={onClose} className="tap glass absolute right-4 top-4 grid size-10 place-items-center rounded-full text-text card-shadow" aria-label={tx({ en: 'Close', ru: 'Закрыть', kk: 'Жабу' })}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <article className="flex flex-col gap-5 p-6 sm:p-9">
          <div className="flex flex-col gap-3">
            <span className="flex items-center gap-2 t-label text-faint"><span className="size-1.5 rounded-full" style={{ background: s.tone }} /><span className="text-secondary">{tx(s.label)}</span><span suppressHydrationWarning>· {fmtDate(published, lang)}, {fmtTime(published)}</span></span>
            <h2 id="reader-title" className="font-[family-name:var(--font-display)] text-[clamp(24px,3.4vw,34px)] font-semibold leading-[1.08] tracking-[-0.03em] text-text [text-wrap:balance]">{a.headline}</h2>
            <p className="t-meta text-secondary">{[...new Set([a.author, a.publisher].filter(Boolean))].join(' · ')}</p>
          </div>
          {a.lede ? <p className="border-l-2 pl-4 text-[17px] font-medium leading-[1.55] text-text [text-wrap:pretty]" style={{ borderColor: s.tone }}>{a.lede}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setFull(true)} className="tap inline-flex h-[50px] items-center gap-2 rounded-[16px] bg-blue px-5 text-[15px] font-bold text-on-blue">
              <Icon name="news" size={17} />{tx({ en: 'Read the full story', ru: 'Читать полностью', kk: 'Толық оқу' })}
            </button>
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="tap inline-flex h-[50px] items-center gap-2 rounded-[16px] px-4 text-[15px] font-bold text-blue-strong hairline">
              {a.publisher}<Icon name="external" size={15} />
            </a>
            <button type="button" onClick={() => void share()} className="tap inline-flex h-[50px] items-center gap-2 rounded-[16px] bg-soft px-5 text-[15px] font-bold text-blue-strong">
              <Icon name={copied ? 'check' : 'send'} size={16} />{copied ? tx({ en: 'Link copied', ru: 'Ссылка скопирована', kk: 'Сілтеме көшірілді' }) : tx({ en: 'Share', ru: 'Поделиться', kk: 'Бөлісу' })}
            </button>
          </div>
          <p className="t-meta text-faint">{tx({ en: `The full story opens on ${a.publisher}'s own page inside Aktau. The article belongs to the publisher.`, ru: `Полный текст открывается на странице ${a.publisher} внутри Aktau. Статья принадлежит изданию.`, kk: `Толық мәтін Aktau ішінде ${a.publisher} бетінде ашылады.` })}</p>

          {related.length ? (
            <section className="flex flex-col gap-2 rounded-[20px] bg-soft p-4">
              <p className="t-label text-blue">{tx({ en: 'In Aktau right now', ru: 'Сейчас в Актау', kk: 'Қазір Ақтауда' })}</p>
              {related.map((e) => (
                <Link key={e.id} href={`/event/${e.id}`} className="tap flex items-center gap-3 rounded-[14px] bg-surface p-3 hairline hover:bg-surface-2">
                  <Icon name={CATEGORY_ICON[e.category] ?? 'shield'} size={18} className="text-blue" />
                  <span className="flex min-w-0 flex-1 flex-col"><span className="t-row text-text">{headline(lang, e).head}</span><span className="t-meta text-secondary">{authorityName(e)} · {tx({ en: 'official', ru: 'официально', kk: 'ресми' })}</span></span>
                  <Icon name="chevron" size={16} className="text-faint" />
                </Link>
              ))}
            </section>
          ) : null}

          {same.length ? (
            <section className="flex flex-col gap-1 border-t border-line pt-5">
              <p className="t-label text-faint">{tx({ en: `More in ${tx(s.label).toLowerCase()}`, ru: `Ещё: ${tx(s.label).toLowerCase()}`, kk: `Тағы: ${tx(s.label).toLowerCase()}` })}</p>
              <ol className="flex flex-col divide-y divide-[var(--line)]">{same.map((x) => <li key={x.id}><RowStory a={x} onOpen={onOpen} /></li>)}</ol>
            </section>
          ) : null}
        </article>
      </div>
    </div>
  )
}

// ── Home rail ───────────────────────────────────────────────────────────────
export function NewsRail({ articles }: { articles: NewsArticleDTO[] }) {
  const { tx } = useApp()
  if (!articles.length) return null
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex h-8 items-end justify-between gap-3">
        <h2 className="t-section text-text">{tx({ en: 'Aktau today', ru: 'Актау сегодня', kk: 'Ақтау бүгін' })}</h2>
        <Link href="/news" className="tap t-meta font-bold text-blue">{tx({ en: 'All news →', ru: 'Все новости →', kk: 'Барлық жаңалықтар →' })}</Link>
      </div>
      <div className="rail no-scrollbar -mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0">
        {articles.slice(0, 6).map((a) => (
          <Link key={a.id} href={`/news?story=${a.id}`} className="tap group flex w-[236px] flex-none snap-start flex-col overflow-hidden rounded-[20px] bg-surface card-shadow">
            <span className="relative block aspect-[16/10] overflow-hidden"><Cover a={a} className="absolute inset-0 h-full w-full" /></span>
            <span className="flex flex-col gap-1.5 p-3.5">
              <Kicker a={a} />
              <span className="t-row line-clamp-3 text-text [text-wrap:pretty] group-hover:text-blue">{a.headline}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
