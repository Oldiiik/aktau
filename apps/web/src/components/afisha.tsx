'use client'
// Afisha · where to go in Aktau. Films with today's and tomorrow's sessions in
// every cinema; concerts, stand-up, theatre and festivals from the city's
// listings (one show on two sites is one card with both links); and places
// worth going to any day. Facts and the publisher's own words only, always
// linked to the publisher and its ticket page: tickets are sold there.
import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { FilmDTO, ShowDTO, SpotDTO, WhatsOn } from '@aktau/server'
import type { Lang } from '@aktau/types'
import { fmtDate, fmtWeekday } from '@aktau/normalization/time'
import { useApp, type L3 } from './app'
import { Badge, Chip, Icon, PageTitle, type IconName } from './primitives'

type Kind = 'all' | 'cinema' | 'concert' | 'standup' | 'theatre' | 'festival' | 'kids' | 'spots'
type When = 'today' | 'tomorrow' | 'weekend' | 'soon'

const KIND: Array<{ key: Kind; label: L3; icon: IconName }> = [
  { key: 'all', label: { en: 'Everything', ru: 'Всё', kk: 'Барлығы' }, icon: 'sparkle' },
  { key: 'cinema', label: { en: 'Cinema', ru: 'Кино', kk: 'Кино' }, icon: 'film' },
  { key: 'concert', label: { en: 'Concerts', ru: 'Концерты', kk: 'Концерттер' }, icon: 'ticket' },
  { key: 'standup', label: { en: 'Stand-up', ru: 'Стендап', kk: 'Стендап' }, icon: 'ticket' },
  { key: 'theatre', label: { en: 'Theatre', ru: 'Театр', kk: 'Театр' }, icon: 'ticket' },
  { key: 'festival', label: { en: 'Festivals', ru: 'Фестивали', kk: 'Фестивальдер' }, icon: 'ticket' },
  { key: 'kids', label: { en: 'Kids', ru: 'Детям', kk: 'Балаларға' }, icon: 'ticket' },
  { key: 'spots', label: { en: 'Any day', ru: 'Места', kk: 'Орындар' }, icon: 'pin' },
]
const CATEGORY: Record<string, L3> = {
  concert: { en: 'Concert', ru: 'Концерт', kk: 'Концерт' }, standup: { en: 'Stand-up', ru: 'Стендап', kk: 'Стендап' }, theatre: { en: 'Theatre', ru: 'Театр', kk: 'Театр' },
  festival: { en: 'Festival', ru: 'Фестиваль', kk: 'Фестиваль' }, kids: { en: 'For kids', ru: 'Детям', kk: 'Балаларға' }, sport: { en: 'Sport', ru: 'Спорт', kk: 'Спорт' },
  exhibition: { en: 'Exhibition', ru: 'Выставка', kk: 'Көрме' }, party: { en: 'Party', ru: 'Вечеринка', kk: 'Кеш' }, other: { en: 'Event', ru: 'Событие', kk: 'Іс-шара' },
}
const SPOT: Record<string, { label: L3; icon: IconName }> = {
  attraction: { label: { en: 'Sights', ru: 'Достопримечательность', kk: 'Көрікті жер' }, icon: 'lighthouse' },
  park: { label: { en: 'Park', ru: 'Парк', kk: 'Саябақ' }, icon: 'tree' },
  culture: { label: { en: 'Culture', ru: 'Культура', kk: 'Мәдениет' }, icon: 'ticket' },
}

/** Aktau calendar day of a moment, as "YYYY-MM-DD". */
const day = (d: Date | string) => new Date(new Date(d).getTime() + 5 * 3600_000).toISOString().slice(0, 10)
const time = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(11, 16)
const money = (n: number) => `${n.toLocaleString('ru-RU').replace(/,/g, ' ')} ₸`
const noCity = (t: string) => t.replace(/\s+(?:в Актау|в городе Актау|Ақтауда|Ақтау қаласында|in Aktau)$/i, '').trim()

function inWindow(iso: string, when: When, now: Date) {
  const d = day(iso), today = day(now), tomorrow = day(new Date(now.getTime() + 86400_000))
  if (when === 'today') return d === today
  if (when === 'tomorrow') return d === tomorrow
  if (when === 'weekend') {
    const wd = new Date(new Date(iso).getTime() + 5 * 3600_000).getUTCDay()
    return (wd === 0 || wd === 6 || (wd === 5 && Number(time(iso).slice(0, 2)) >= 17)) && new Date(iso).getTime() - now.getTime() < 7 * 86400_000
  }
  return true
}

export function AfishaView({ initial }: { initial: WhatsOn }) {
  const { lang, tx } = useApp()
  const [kind, setKind] = useState<Kind>('all')
  const [when, setWhen] = useState<When>('today')
  const now = useMemo(() => new Date(), [])
  const d = initial

  const films = useMemo(() => d.films
    .map((f) => ({ ...f, cinemas: f.cinemas.map((c) => ({ ...c, sessions: c.sessions.filter((s) => (when === 'soon' || when === 'weekend' ? true : inWindow(s.starts_at, when, now))) })).filter((c) => c.sessions.length) }))
    .filter((f) => f.cinemas.length), [d.films, when, now])
  const shows = useMemo(() => d.shows.filter((s) => s.sessions.some((x) => new Date(x).getTime() > now.getTime() - 3 * 3600_000 && inWindow(x, when, now))), [d.shows, when, now])
  const showKinds = kind === 'all' ? shows : shows.filter((s) => s.category === kind || (kind === 'concert' && s.category === 'other'))
  const showFilms = kind === 'all' || kind === 'cinema'
  const showShows = kind !== 'cinema' && kind !== 'spots'
  const empty = !d.films.length && !d.shows.length

  return (
    <div className="flex flex-col gap-6">
      <div className="rise">
        <PageTitle eyebrow={tx({ en: 'Afisha · Aktau', ru: 'Афиша · Актау', kk: 'Афиша · Ақтау' })}
          sub={tx({ en: 'Films, concerts, stand-up and theatre in Aktau, from Kinoafisha, Sxodim, inaktau.kz and Topbilet. Tickets are sold by the organisers: every card links to them.', ru: 'Кино, концерты, стендап и спектакли в Актау — по данным Киноафиши, Sxodim, inaktau.kz и Topbilet. Билеты продают организаторы: ссылка в каждой карточке.', kk: 'Ақтаудағы кино, концерттер, стендап және спектакльдер — Киноафиша, Sxodim, inaktau.kz және Topbilet деректері бойынша. Билеттерді ұйымдастырушылар сатады.' })}>
          {tx({ en: 'Where to go', ru: 'Куда сходить', kk: 'Қайда баруға болады' })}
        </PageTitle>
      </div>

      <div className="rise rise-1 flex flex-col gap-2.5">
        <div className="no-scrollbar rail -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          {KIND.map((k) => <Chip key={k.key} icon={k.icon} active={kind === k.key} onClick={() => setKind(k.key)}>{tx(k.label)}</Chip>)}
        </div>
        {kind !== 'spots' ? (
          <div className="flex w-fit rounded-[14px] bg-surface p-1 card-shadow" role="radiogroup" aria-label={tx({ en: 'When', ru: 'Когда', kk: 'Қашан' })}>
            {([['today', { en: 'Today', ru: 'Сегодня', kk: 'Бүгін' }], ['tomorrow', { en: 'Tomorrow', ru: 'Завтра', kk: 'Ертең' }], ['weekend', { en: 'Weekend', ru: 'Выходные', kk: 'Демалыс' }], ['soon', { en: 'All', ru: 'Все', kk: 'Барлығы' }]] as Array<[When, L3]>).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={when === k} onClick={() => setWhen(k)}
                className={`tap h-9 rounded-[11px] px-3.5 text-[13px] font-bold ${when === k ? 'bg-text text-bg' : 'text-secondary hover:text-text'}`}>{tx(l)}</button>
            ))}
          </div>
        ) : null}
      </div>

      {empty && kind !== 'spots' ? (
        <div className="flex flex-col gap-1 rounded-[22px] bg-soft p-5">
          <p className="t-row text-text">{tx({ en: 'The listings are being updated', ru: 'Афиша обновляется', kk: 'Афиша жаңартылуда' })}</p>
          <p className="t-sub text-secondary">{tx({ en: 'Sessions and shows are read every 3 hours. Meanwhile, places to go any day are below.', ru: 'Сеансы и события обновляются каждые 3 часа. А пока — места, куда можно пойти в любой день.', kk: 'Сеанстар әр 3 сағат сайын жаңартылады.' })}</p>
        </div>
      ) : null}

      {showShows && showKinds.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="t-section text-text">{tx({ en: 'Concerts, stand-up, theatre', ru: 'Концерты, стендап, театр', kk: 'Концерттер, стендап, театр' })}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{showKinds.map((s) => <ShowCard key={s.id} s={s} lang={lang} now={now} />)}</div>
        </section>
      ) : showShows && kind !== 'all' && !empty ? (
        <p className="t-sub text-secondary">{tx({ en: 'Nothing of this kind for these dates. Try “All”.', ru: 'На эти даты такого нет. Попробуйте «Все даты».', kk: 'Бұл күндері жоқ.' })}</p>
      ) : null}

      {showFilms && films.length ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="t-section text-text">{when === 'tomorrow' ? tx({ en: 'Cinema tomorrow', ru: 'Кино завтра', kk: 'Ертең кино' }) : when === 'today' ? tx({ en: 'Cinema today', ru: 'Кино сегодня', kk: 'Бүгін кино' }) : tx({ en: 'Cinema today and tomorrow', ru: 'Кино сегодня и завтра', kk: 'Бүгін және ертең кино' })}</h2>
            <span className="t-meta text-secondary">{films.length} {tx({ en: 'films', ru: 'фильмов', kk: 'фильм' })}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{films.map((f) => <FilmCard key={f.film_id + f.title} f={f} now={now} />)}</div>
        </section>
      ) : null}

      {kind === 'all' || kind === 'spots' ? <Spots spots={d.spots} /> : null}

      <footer className="flex flex-col gap-1 border-t border-line pt-4">
        <p className="t-meta text-secondary">{tx({ en: 'Sources', ru: 'Источники', kk: 'Дереккөздер' })}: {d.sources.map((s, i) => (
          <span key={s.slug}>{i ? ' · ' : ''}{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue">{s.name.split(' · ')[0]}</a> : s.name}</span>
        ))}. {tx({ en: 'Places: OpenStreetMap.', ru: 'Места: OpenStreetMap.', kk: 'Орындар: OpenStreetMap.' })}</p>
        <p className="t-meta text-faint">{tx({ en: 'Aktau shows what the listings publish and links to them; times and prices can change, check before you go.', ru: 'Aktau показывает то, что публикуют афиши, со ссылкой на них; время и цены могут меняться — проверяйте перед выходом.', kk: 'Уақыт пен баға өзгеруі мүмкін — шығар алдында тексеріңіз.' })}</p>
      </footer>
    </div>
  )
}

function whenText(lang: Lang, iso: string, now: Date) {
  const d = day(iso), today = day(now), tomorrow = day(new Date(now.getTime() + 86400_000))
  const t = time(iso)
  const rel = d === today ? { en: 'Today', ru: 'Сегодня', kk: 'Бүгін' }[lang] : d === tomorrow ? { en: 'Tomorrow', ru: 'Завтра', kk: 'Ертең' }[lang]
    : `${fmtWeekday(new Date(iso), lang, 'short')}, ${fmtDate(new Date(iso), lang)}`
  return t === '00:00' ? rel : `${rel}, ${t}`
}

function ShowCard({ s, lang, now }: { s: ShowDTO; lang: Lang; now: Date }) {
  const { tx } = useApp()
  const next = s.sessions.find((x) => new Date(x).getTime() > now.getTime() - 3 * 3600_000) ?? s.sessions[0]!
  const more = s.sessions.filter((x) => new Date(x) > new Date(next)).length
  const link = s.ticket_url ?? s.sources[0]?.url
  return (
    <article className="flex flex-col overflow-hidden rounded-[22px] bg-surface card-shadow">
      <div className="relative aspect-[16/9] w-full bg-surface-2">
        {s.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />
        ) : <span className="absolute inset-0 grid place-items-center text-faint"><Icon name="ticket" size={34} /></span>}
        <span className="absolute left-3 top-3"><Badge tone="neutral" className="!bg-surface/90 backdrop-blur">{tx(CATEGORY[s.category] ?? CATEGORY.other!)}</Badge></span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="t-card text-text [text-wrap:balance]">{noCity(s.title)}</h3>
        <p className="t-row text-blue" suppressHydrationWarning>{whenText(lang, next, now)}{more ? <span className="t-meta font-semibold text-secondary"> · {tx({ en: `+${more} more`, ru: `ещё ${more}`, kk: `тағы ${more}` })}</span> : null}</p>
        {s.venue ? <p className="t-sub text-secondary">{s.venue}</p> : null}
        {s.summary ? <p className="t-meta line-clamp-3 text-secondary">{s.summary}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <span className="t-row text-text">{s.price_from ? `${tx({ en: 'from', ru: 'от', kk: 'бастап' })} ${money(s.price_from)}` : ''}</span>
          {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="tap inline-flex h-10 items-center gap-1.5 rounded-[13px] bg-blue px-3.5 text-[13px] font-bold text-on-blue"><Icon name="ticket" size={16} />{s.ticket_url ? tx({ en: 'Tickets', ru: 'Билеты', kk: 'Билеттер' }) : tx({ en: 'Details', ru: 'Подробнее', kk: 'Толығырақ' })}</a> : null}
        </div>
        <p className="t-meta text-faint">{s.sources.map((x, i) => <span key={x.url}>{i ? ' · ' : ''}<a href={x.url} target="_blank" rel="noopener noreferrer" className="hover:text-text">{x.name}</a></span>)}</p>
      </div>
    </article>
  )
}

function FilmCard({ f, now }: { f: FilmDTO; now: Date }) {
  const { tx } = useApp()
  return (
    <article className="flex gap-3.5 rounded-[22px] bg-surface p-3.5 card-shadow">
      <div className="relative h-[108px] w-[72px] flex-none overflow-hidden rounded-[12px] bg-surface-2 hairline">
        {f.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : <span className="grid size-full place-items-center text-faint"><Icon name="film" size={24} /></span>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-col">
          {f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="t-card text-text hover:text-blue">{f.title}</a> : <span className="t-card text-text">{f.title}</span>}
          <span className="t-meta text-secondary">{[f.genres, f.details].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {f.languages.map((l) => <span key={l} className="rounded-full bg-soft px-2 py-0.5 text-[11px] font-bold text-blue">{l === 'KK' ? 'Қазақша' : l === 'RU' ? 'Русский' : l}</span>)}
          {f.price_from ? <span className="t-meta text-secondary">{tx({ en: 'from', ru: 'от', kk: 'бастап' })} {money(f.price_from)}</span> : null}
        </div>
        <div className="flex flex-col gap-1.5 pt-0.5">
          {f.cinemas.map((c) => (
            <div key={c.cinema_id} className="flex flex-col gap-1">
              <span className="t-meta font-semibold text-text">{c.name}</span>
              <div className="flex flex-wrap gap-1.5">
                {c.sessions.map((s) => {
                  const past = new Date(s.starts_at) < now
                  return (
                    <a key={s.starts_at + (s.format ?? '')} href={`https://kz.kinoafisha.info/aktau/cinema/${c.cinema_id}/schedule/`} target="_blank" rel="noopener noreferrer"
                      title={[s.format, s.price_from ? money(s.price_from) : null].filter(Boolean).join(' · ')}
                      className={`tap inline-flex h-8 items-center gap-1 rounded-[10px] px-2.5 text-[13px] font-bold ${past ? 'bg-surface-2 text-faint line-through decoration-1' : 'bg-surface-2 text-text hairline hover:bg-soft hover:text-blue'}`} suppressHydrationWarning>
                      {time(s.starts_at)}{s.format?.includes('3D') ? <span className="text-[10px] font-bold text-secondary">3D</span> : null}
                    </a>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function Spots({ spots }: { spots: SpotDTO[] }) {
  const { tx } = useApp()
  if (!spots.length) return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="t-section text-text">{tx({ en: 'Any day', ru: 'Куда пойти в любой день', kk: 'Кез келген күні' })}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {spots.map((p) => {
          const k = SPOT[p.category] ?? SPOT.culture!
          return (
            <Link key={p.id} href={`/place/${p.id}`} className="tap flex min-w-0 items-center gap-3 rounded-[18px] bg-surface p-3 card-shadow hover:bg-surface-2">
              <span className="grid size-10 flex-none place-items-center rounded-[12px] bg-soft text-blue"><Icon name={k.icon} size={18} /></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="t-row truncate text-text">{p.name}</span>
                <span className="t-meta truncate text-secondary">{tx(k.label)}{p.address ? ` · ${p.address}` : ''}</span>
              </span>
              <Icon name="chevron" size={16} className="text-faint" />
            </Link>
          )
        })}
      </div>
    </section>
  )
}
