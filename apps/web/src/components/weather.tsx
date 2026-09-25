'use client'
// Weather · the detailed page behind Home's weather card (not in the nav).
// Forecast = Open-Meteo model, station reading = Kazhydromet (official), sea =
// Open-Meteo Marine (model), air = CAMS (model estimate). Each block says which.
// Charts are single-series inline SVG in the accent colour; every value is also
// printed, so the hourly strip and the daily rows are the table view.
import Link from 'next/link'
import { useMemo } from 'react'
import type { WeatherDetail } from '@aktau/server'
import { fmtWeekday } from '@aktau/normalization/time'
import { useApp } from './app'
import { BackLink, Icon } from './primitives'

type L3 = { en: string; ru: string; kk: string }
const TZ = 'Asia/Aqtau'
const r0 = (v: number | null | undefined) => (v == null ? '—' : String(Math.round(v)))

function useFmt() {
  const { lang } = useApp()
  return useMemo(() => ({
    time: (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)),
    hour: (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit' }).format(new Date(iso)),
    day: (date: string) => fmtWeekday(new Date(`${date}T12:00:00Z`), lang, 'short'),
    ms: lang === 'en' ? 'm/s' : 'м/с',
  }), [lang])
}

// ── Glyph: WMO weather code → a small illustration ──────────────────────────
type Kind = 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'
function kindOf(code: number | null): Kind {
  if (code == null || code === 0) return 'clear'
  if (code <= 2) return 'partly'
  if (code === 3) return 'cloud'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  return 'storm'
}
export function WeatherGlyph({ code, day = true, size = 28, className = '' }: { code: number | null; day?: boolean | null; size?: number; className?: string }) {
  const k = kindOf(code)
  const sun = day !== false
  const cloud = <path d="M9 25h15a6 6 0 0 0 .6-11.97A8 8 0 0 0 9.3 15.2 5 5 0 0 0 9 25Z" fill="currentColor" opacity={0.92} />
  const body = (() => {
    switch (k) {
      case 'clear': return sun
        ? <g><circle cx="16" cy="16" r="6.5" fill="#f6b73c" /><g stroke="#f6b73c" strokeWidth="2" strokeLinecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="16" y1="4" x2="16" y2="6.5" transform={`rotate(${a} 16 16)`} />)}</g></g>
        : <path d="M20.5 6.5a10 10 0 1 0 5 16.5A9 9 0 0 1 20.5 6.5Z" fill="#c9d4f5" />
      case 'partly': return <g>{sun ? <circle cx="12" cy="11" r="5.5" fill="#f6b73c" /> : <path d="M14.5 4.5a7 7 0 1 0 3.5 11.6 6.3 6.3 0 0 1-3.5-11.6Z" fill="#c9d4f5" />}<g transform="translate(3 3)">{cloud}</g></g>
      case 'cloud': return cloud
      case 'fog': return <g>{cloud}<g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={0.6}><line x1="7" y1="28.5" x2="25" y2="28.5" /></g></g>
      case 'drizzle': return <g transform="translate(0 -3)">{cloud}<g fill="var(--blue)"><circle cx="12" cy="29.5" r="1.3" /><circle cx="19" cy="29.5" r="1.3" /></g></g>
      case 'rain': return <g transform="translate(0 -3)">{cloud}<g stroke="var(--blue)" strokeWidth="2" strokeLinecap="round"><line x1="11" y1="28" x2="9.5" y2="31" /><line x1="17" y1="28" x2="15.5" y2="31" /><line x1="23" y1="28" x2="21.5" y2="31" /></g></g>
      case 'snow': return <g transform="translate(0 -3)">{cloud}<g fill="var(--blue)"><circle cx="11" cy="29.5" r="1.5" /><circle cx="17" cy="30.5" r="1.5" /><circle cx="23" cy="29.5" r="1.5" /></g></g>
      case 'storm': return <g transform="translate(0 -3)">{cloud}<path d="M17 25l-3.5 5h3l-1.5 4.5 5-6h-3.2l1.7-3.5Z" fill="#f6b73c" /></g>
    }
  })()
  return <svg viewBox="0 0 32 32" width={size} height={size} className={`text-secondary ${className}`} aria-hidden>{body}</svg>
}

// ── Page ────────────────────────────────────────────────────────────────────
export function WeatherView({ w }: { w: WeatherDetail }) {
  const { lang, tx } = useApp()
  const f = useFmt()
  const c = w.current
  const today = w.daily[0]
  const night = c?.is_day === false
  return (
    <div className="flex flex-col gap-4 pb-6">
      <BackLink href="/">{tx({ en: 'Home', ru: 'Главная', kk: 'Басты' })}</BackLink>

      {/* Hero */}
      <section className={`rise relative overflow-hidden rounded-[28px] p-5 text-white card-shadow ${night ? 'weather-night' : 'weather-day'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-white/80">{tx({ en: 'Aktau', ru: 'Актау', kk: 'Ақтау' })} · {tx({ en: 'now', ru: 'сейчас', kk: 'қазір' })}</span>
            <span className="mt-1 font-[family-name:var(--font-display)] text-[84px] font-semibold leading-[0.95] tracking-[-0.05em]">{r0(c?.temp)}°</span>
            <span className="mt-1 text-[17px] font-semibold">{c?.text ?? ''}</span>
            <span className="mt-0.5 text-[14px] text-white/80">
              {tx({ en: 'Feels like', ru: 'Ощущается как', kk: 'Сезілуі' })} {r0(c?.feels)}°
              {today ? ` · ${tx({ en: 'H', ru: 'Макс.', kk: 'Ең жоғ.' })} ${r0(today.max)}° ${tx({ en: 'L', ru: 'мин.', kk: 'ең төм.' })} ${r0(today.min)}°` : ''}
            </span>
          </div>
          <WeatherGlyph code={c?.code ?? null} day={c?.is_day} size={88} className="!text-white drop-shadow-[0_8px_18px_rgb(0_20_80/0.25)]" />
        </div>
        {w.observation ? (
          <div className="mt-4 flex items-center gap-2 rounded-[14px] bg-white/15 px-3 py-2 text-[12.5px] backdrop-blur-sm">
            <Icon name="shield" size={14} />
            <span className="min-w-0 flex-1 truncate">{tx({ en: 'Kazhydromet', ru: 'Казгидромет', kk: 'Қазгидромет' })}: <b>{r0(w.observation.temp)}°</b>{w.observation.wind != null ? `, ${tx({ en: 'wind', ru: 'ветер', kk: 'жел' })} ${r0(w.observation.wind)} ${f.ms}` : ''}</span>
            <span className="text-white/75" suppressHydrationWarning>{f.time(w.observation.observed_at)}</span>
          </div>
        ) : null}
      </section>

      {w.advisories.map((a) => (
        <Link key={a.id} href={`/event/${a.id}`} className="rise rise-1 tap flex items-start gap-3 rounded-[20px] bg-amber-soft p-4 hairline">
          <Icon name="alert" size={18} className="mt-0.5 text-amber" />
          <span className="flex flex-col"><span className="t-row text-text">{a.text || a.kind}</span><span className="t-meta text-secondary">{a.origin === 'OFFICIAL' ? tx({ en: 'Official warning', ru: 'Официальное предупреждение', kk: 'Ресми ескерту' }) : tx({ en: 'Aktau app advisory (forecast thresholds)', ru: 'Предупреждение приложения (пороги прогноза)', kk: 'Қолданба ескертуі (болжам шегі)' })}</span></span>
        </Link>
      ))}

      <Hourly w={w} />
      <Daily w={w} />

      <div className="grid grid-cols-2 gap-3">
        <Wind w={w} />
        <Sun w={w} />
        <Tile icon="water" label={tx({ en: 'Humidity', ru: 'Влажность', kk: 'Ылғалдылық' })} value={c?.humidity != null ? `${r0(c.humidity)}%` : '—'} note={w.observation?.dewpoint != null ? `${tx({ en: 'Dew point', ru: 'Точка росы', kk: 'Шық нүктесі' })} ${r0(w.observation.dewpoint)}°` : undefined} />
        <Tile icon="radar" label={tx({ en: 'Pressure', ru: 'Давление', kk: 'Қысым' })} value={c?.pressure != null ? `${r0(c.pressure)}` : '—'} unit={lang === 'en' ? 'hPa' : 'гПа'} note={c?.pressure != null ? `${r0(c.pressure * 0.750062)} ${lang === 'en' ? 'mmHg' : 'мм рт. ст.'}` : undefined} />
        <Uv w={w} />
        <Tile icon="water" label={tx({ en: 'Rain today', ru: 'Осадки сегодня', kk: 'Бүгінгі жауын' })} value={today?.precip_mm != null ? `${today.precip_mm.toFixed(1)}` : '—'} unit={lang === 'en' ? 'mm' : 'мм'} note={today?.precip_prob != null ? `${tx({ en: 'Chance', ru: 'Вероятность', kk: 'Ықтималдығы' })} ${r0(today.precip_prob)}%` : undefined} />
      </div>

      <Sea w={w} />
      <Air w={w} />

      <p className="px-1 t-meta text-faint">
        {tx({ en: 'Forecast, sea and air are models (Open-Meteo, CAMS); the station reading is official (RSE Kazhydromet, WMO WIS2). None of these is a safety rating.', ru: 'Прогноз, море и воздух — модели (Open-Meteo, CAMS); данные станции — официальные (РГП «Казгидромет», WMO WIS2). Это не оценка безопасности.', kk: 'Болжам, теңіз және ауа — модельдер (Open-Meteo, CAMS); станция деректері ресми (Қазгидромет, WMO WIS2). Бұл қауіпсіздік бағасы емес.' })}
      </p>
    </div>
  )
}

function Card({ title, children, className = '', note }: { title: string; children: React.ReactNode; className?: string; note?: string }) {
  return (
    <section className={`rise rise-2 flex flex-col gap-3 rounded-[24px] bg-surface p-4 card-shadow ${className}`}>
      <div className="flex items-baseline justify-between gap-2"><h2 className="t-label text-faint">{title}</h2>{note ? <span className="t-meta text-[11px] text-faint">{note}</span> : null}</div>
      {children}
    </section>
  )
}

// ── 24 hours: glyph + temperature curve + wind, one column per hour ─────────
function Hourly({ w }: { w: WeatherDetail }) {
  const { tx } = useApp()
  const f = useFmt()
  const hs = w.hourly
  if (!hs.length) return null
  const COL = 56, BAND = 40
  const temps = hs.map((h) => h.temp ?? 0)
  const lo = Math.min(...temps), hi = Math.max(...temps), span = Math.max(1, hi - lo)
  const y = (t: number) => 6 + (1 - (t - lo) / span) * (BAND - 12)
  const pts = hs.map((h, i) => `${i * COL + COL / 2},${y(h.temp ?? lo).toFixed(1)}`).join(' ')
  return (
    <Card title={tx({ en: 'Next 24 hours', ru: 'Ближайшие 24 часа', kk: 'Алдағы 24 сағат' })} note="Open-Meteo">
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
        <div className="relative" style={{ width: hs.length * COL }}>
          <div className="flex">
            {hs.map((h, i) => (
              <div key={h.time} className="flex flex-col items-center gap-1" style={{ width: COL }}>
                <span className="t-meta text-[12px] font-semibold text-secondary" suppressHydrationWarning>{i === 0 ? tx({ en: 'Now', ru: 'Сейчас', kk: 'Қазір' }) : f.hour(h.time)}</span>
                <WeatherGlyph code={h.code} day={h.is_day} size={26} />
                <span className="h-[14px] text-[11px] font-semibold text-blue">{h.precip_prob != null && h.precip_prob >= 20 ? `${r0(h.precip_prob)}%` : ''}</span>
              </div>
            ))}
          </div>
          {/* Temperature: one series, 2px accent line; the numbers sit on the points. */}
          <svg width={hs.length * COL} height={BAND + 18} className="block overflow-visible" aria-hidden>
            <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" transform="translate(0 16)" />
            {hs.map((h, i) => (
              <g key={h.time} transform={`translate(${i * COL + COL / 2} ${y(h.temp ?? lo) + 16})`}>
                <circle r="3" fill="var(--surface)" stroke="var(--blue)" strokeWidth="2" />
                <text y="-9" textAnchor="middle" className="fill-text text-[13px] font-semibold">{r0(h.temp)}°</text>
              </g>
            ))}
          </svg>
          <div className="flex">
            {hs.map((h) => (
              <div key={h.time} className="flex flex-col items-center gap-0.5" style={{ width: COL }}>
                <WindArrow deg={h.wind_dir} size={14} />
                <span className="text-[11px] text-secondary">{r0(h.wind)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="t-meta text-[11px] text-faint">{tx({ en: `Temperature °C · chance of rain · wind ${f.ms}`, ru: `Температура °C · вероятность осадков · ветер ${f.ms}`, kk: `Температура °C · жауын ықтималдығы · жел ${f.ms}` })}</p>
    </Card>
  )
}

// ── 7 days: min–max range bars on one shared scale ─────────────────────────
function Daily({ w }: { w: WeatherDetail }) {
  const { tx } = useApp()
  const f = useFmt()
  const ds = w.daily.filter((d) => d.min != null && d.max != null)
  if (!ds.length) return null
  const lo = Math.min(...ds.map((d) => d.min!)), hi = Math.max(...ds.map((d) => d.max!)), span = Math.max(1, hi - lo)
  const now = w.current?.temp
  return (
    <Card title={tx({ en: '7 days', ru: '7 дней', kk: '7 күн' })} note="Open-Meteo">
      <div className="flex flex-col">
        {ds.map((d, i) => (
          <div key={d.date} className="flex h-12 items-center gap-3 border-b border-line last:border-0">
            <span className="w-[4.5rem] flex-none truncate text-[15px] font-semibold capitalize text-text">{i === 0 ? tx({ en: 'Today', ru: 'Сегодня', kk: 'Бүгін' }) : f.day(d.date)}</span>
            <WeatherGlyph code={d.code} size={26} />
            <span className="w-8 flex-none text-[12px] font-semibold text-blue">{d.precip_prob != null && d.precip_prob >= 20 ? `${r0(d.precip_prob)}%` : ''}</span>
            <span className="w-8 flex-none text-right text-[15px] text-secondary">{r0(d.min)}°</span>
            <span className="relative h-1.5 flex-1 rounded-full bg-surface-2 hairline">
              <span className="absolute inset-y-0 rounded-full bg-blue" style={{ left: `${((d.min! - lo) / span) * 100}%`, right: `${100 - ((d.max! - lo) / span) * 100}%` }} />
              {i === 0 && now != null ? <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface ring-2 ring-text" style={{ left: `${Math.min(100, Math.max(0, ((now - lo) / span) * 100))}%` }} aria-label={`now ${r0(now)}°`} /> : null}
            </span>
            <span className="w-8 flex-none text-[15px] font-semibold text-text">{r0(d.max)}°</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function WindArrow({ deg, size = 16, className = '' }: { deg: number | null; size?: number; className?: string }) {
  // Meteorological direction is where the wind comes FROM; the arrow points where it blows TO.
  if (deg == null) return <span style={{ width: size, height: size }} />
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={`text-secondary ${className}`} style={{ transform: `rotate(${deg + 180}deg)` }} aria-hidden>
      <path d="M8 1.5 12 12 8 9.8 4 12Z" fill="currentColor" />
    </svg>
  )
}

const WIND: Record<string, L3> = {
  calm: { en: 'Calm', ru: 'Штиль', kk: 'Тымық' }, light: { en: 'Light wind', ru: 'Слабый ветер', kk: 'Әлсіз жел' },
  moderate: { en: 'Moderate wind', ru: 'Умеренный ветер', kk: 'Қалыпты жел' }, strong: { en: 'Strong wind', ru: 'Сильный ветер', kk: 'Күшті жел' }, gale: { en: 'Gale', ru: 'Шторм', kk: 'Дауыл' },
}
const COMPASS: Record<string, string[]> = {
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], ru: ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'], kk: ['С', 'СШ', 'Ш', 'ОШ', 'О', 'ОБ', 'Б', 'СБ'],
}

function Wind({ w }: { w: WeatherDetail }) {
  const { lang, tx } = useApp()
  const f = useFmt()
  const c = w.current
  const dir = c?.wind_dir ?? null
  const from = dir != null ? COMPASS[lang]![Math.round(dir / 45) % 8] : null
  return (
    <Card title={tx({ en: 'Wind', ru: 'Ветер', kk: 'Жел' })}>
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 64 64" width="52" height="52" className="flex-none" aria-hidden>
          <circle cx="32" cy="32" r="29" fill="none" stroke="var(--border)" strokeWidth="2" />
          <text x="32" y="12" textAnchor="middle" className="fill-faint text-[8px] font-bold">{COMPASS[lang]![0]}</text>
          {dir != null ? <g style={{ transform: `rotate(${dir + 180}deg)`, transformOrigin: '32px 32px' }}><path d="M32 12 38 40 32 35 26 40Z" fill="var(--blue)" /></g> : null}
        </svg>
        <div className="flex flex-col">
          <span className="font-[family-name:var(--font-display)] text-[28px] font-semibold leading-none text-text">{r0(c?.wind)}<span className="ml-1 text-[13px] font-medium text-secondary">{f.ms}</span></span>
          <span className="mt-1 whitespace-nowrap t-meta text-secondary">{tx({ en: 'Gusts', ru: 'Порывы', kk: 'Екпін' })} {r0(c?.gust)} {f.ms}</span>
          {from ? <span className="t-meta text-secondary">{tx({ en: 'From', ru: 'Откуда:', kk: 'Қайдан:' })} {from}</span> : null}
        </div>
      </div>
      {c?.conditions.wind ? <span className={`t-meta font-semibold ${c.conditions.attention ? 'text-amber' : 'text-text'}`}>{tx(WIND[c.conditions.wind]!)}</span> : null}
    </Card>
  )
}

function Sun({ w }: { w: WeatherDetail }) {
  const { tx } = useApp()
  const f = useFmt()
  const d = w.daily[0]
  if (!d?.sunrise || !d.sunset) return <Tile icon="sun" label={tx({ en: 'Sun', ru: 'Солнце', kk: 'Күн' })} value="—" />
  const rise = new Date(d.sunrise).getTime(), set = new Date(d.sunset).getTime(), now = new Date(w.now).getTime()
  const t = Math.min(1, Math.max(0, (now - rise) / (set - rise)))
  const up = now > rise && now < set
  // Sun position on the arc (semi-ellipse from sunrise to sunset).
  const x = 6 + t * 52, y = 30 - Math.sin(t * Math.PI) * 22
  const len = Math.round((set - rise) / 60000)
  return (
    <Card title={tx({ en: 'Sun', ru: 'Солнце', kk: 'Күн' })}>
      <svg viewBox="0 0 64 36" className="w-full" aria-hidden>
        <path d="M6 30 Q32 -14 58 30" fill="none" stroke="var(--border)" strokeWidth="2" strokeDasharray="3 3" />
        <line x1="2" y1="30" x2="62" y2="30" stroke="var(--line)" strokeWidth="1" />
        {up ? <circle cx={x} cy={y} r="4" fill="#f6b73c" stroke="var(--surface)" strokeWidth="2" /> : null}
      </svg>
      <div className="flex justify-between t-meta text-secondary" suppressHydrationWarning>
        <span>↑ {f.time(d.sunrise)}</span><span>↓ {f.time(d.sunset)}</span>
      </div>
      <span className="t-meta text-faint">{tx({ en: 'Daylight', ru: 'Световой день', kk: 'Күн ұзақтығы' })} {Math.floor(len / 60)}:{String(len % 60).padStart(2, '0')}</span>
    </Card>
  )
}

function Tile({ icon, label, value, unit, note }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: string; unit?: string; note?: string }) {
  return (
    <Card title={label}>
      <div className="flex items-end justify-between gap-2">
        <span className="font-[family-name:var(--font-display)] text-[28px] font-semibold leading-none text-text">{value}{unit ? <span className="ml-1 text-[13px] font-medium text-secondary">{unit}</span> : null}</span>
        <Icon name={icon} size={18} className="text-faint" />
      </div>
      {note ? <span className="t-meta text-secondary">{note}</span> : null}
    </Card>
  )
}

function Uv({ w }: { w: WeatherDetail }) {
  const { tx } = useApp()
  const uv = w.hourly[0]?.uv ?? w.daily[0]?.uv_max ?? null
  const max = w.daily[0]?.uv_max ?? null
  const word = (v: number): L3 => v < 3 ? { en: 'Low', ru: 'Низкий', kk: 'Төмен' } : v < 6 ? { en: 'Moderate', ru: 'Умеренный', kk: 'Орташа' } : v < 8 ? { en: 'High', ru: 'Высокий', kk: 'Жоғары' } : v < 11 ? { en: 'Very high', ru: 'Очень высокий', kk: 'Өте жоғары' } : { en: 'Extreme', ru: 'Экстремальный', kk: 'Экстремалды' }
  return <Tile icon="sun" label={tx({ en: 'UV index', ru: 'УФ-индекс', kk: 'УК индексі' })} value={uv != null ? r0(uv) : '—'} note={uv != null ? `${tx(word(uv))}${max != null ? ` · ${tx({ en: 'max', ru: 'макс.', kk: 'ең жоғ.' })} ${r0(max)}` : ''}` : undefined} />
}

const SEA: Record<string, L3> = {
  calm: { en: 'Calm sea', ru: 'Море спокойно', kk: 'Теңіз тынық' }, slight: { en: 'Small waves', ru: 'Слабое волнение', kk: 'Әлсіз толқын' },
  moderate: { en: 'Moderate waves', ru: 'Умеренное волнение', kk: 'Қалыпты толқын' }, rough: { en: 'Rough sea', ru: 'Сильное волнение', kk: 'Күшті толқын' }, very_rough: { en: 'Very rough sea', ru: 'Очень сильное волнение', kk: 'Өте күшті толқын' },
}

function Sea({ w }: { w: WeatherDetail }) {
  const { lang, tx } = useApp()
  const f = useFmt()
  const s = w.sea
  if (!s) return null
  const hs = s.hourly.filter((h) => h.wave != null)
  const W = 300, H = 56
  const hi = Math.max(0.5, ...hs.map((h) => h.wave!))
  const pts = hs.map((h, i) => `${(i / Math.max(1, hs.length - 1)) * W},${(H - 4 - (h.wave! / hi) * (H - 12)).toFixed(1)}`)
  const m = lang === 'en' ? 'm' : 'м'
  return (
    <Card title={tx({ en: 'The Caspian', ru: 'Каспий', kk: 'Каспий' })} note={tx({ en: 'Open-Meteo Marine · model', ru: 'Open-Meteo Marine · модель', kk: 'Open-Meteo Marine · модель' })}>
      <div className={`grid gap-2 ${s.temp != null ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="flex flex-col"><span className="font-[family-name:var(--font-display)] text-[26px] font-semibold leading-none text-text">{s.wave != null ? s.wave.toFixed(1) : '—'}<span className="ml-1 text-[13px] font-medium text-secondary">{m}</span></span><span className="t-meta text-secondary">{tx({ en: 'Waves', ru: 'Волны', kk: 'Толқын' })}</span></div>
        {/* The marine model often has no sea-surface temperature for the Caspian: no tile rather than a dash. */}
        {s.temp != null ? <div className="flex flex-col"><span className="font-[family-name:var(--font-display)] text-[26px] font-semibold leading-none text-text">{`${r0(s.temp)}°`}</span><span className="t-meta text-secondary">{tx({ en: 'Water', ru: 'Вода', kk: 'Су' })}</span></div> : null}
        <div className="flex flex-col"><span className="font-[family-name:var(--font-display)] text-[26px] font-semibold leading-none text-text">{s.period != null ? r0(s.period) : '—'}<span className="ml-1 text-[13px] font-medium text-secondary">{lang === 'en' ? 's' : 'с'}</span></span><span className="t-meta text-secondary">{tx({ en: 'Wave period', ru: 'Период волн', kk: 'Толқын кезеңі' })}</span></div>
      </div>
      {s.sea_word ? <span className="t-sub font-semibold text-text">{tx(SEA[s.sea_word]!)}</span> : null}
      {hs.length > 1 ? (
        <figure className="flex flex-col gap-1">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" preserveAspectRatio="none" role="img" aria-label={tx({ en: 'Wave height, next 24 hours', ru: 'Высота волн, 24 часа', kk: 'Толқын биіктігі, 24 сағат' })}>
            <line x1="0" y1={H - 4} x2={W} y2={H - 4} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <polyline points={pts.join(' ')} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <figcaption className="flex justify-between t-meta text-[11px] text-faint" suppressHydrationWarning>
            <span>{f.hour(hs[0]!.time)}:00</span>
            <span>{tx({ en: 'Wave height, 24 h · peak', ru: 'Высота волн, 24 ч · макс.', kk: 'Толқын биіктігі, 24 сағ · ең жоғ.' })} {Math.max(...hs.map((h) => h.wave!)).toFixed(1)} {m}</span>
            <span>{f.hour(hs[hs.length - 1]!.time)}:00</span>
          </figcaption>
        </figure>
      ) : null}
      <Link href="/map?layer=swim" className="tap inline-flex h-11 items-center justify-center gap-2 rounded-[14px] bg-soft text-[14px] font-bold text-blue-strong"><Icon name="map" size={17} />{tx({ en: 'Where to swim: official beaches', ru: 'Где купаться: официальные пляжи', kk: 'Қайда шомылуға болады: ресми жағажайлар' })}</Link>
    </Card>
  )
}

// US AQI bands; status colours + a text label, never colour alone.
const AQI_BANDS: Array<{ upto: number; tone: string; label: L3 }> = [
  { upto: 50, tone: 'var(--green)', label: { en: 'Good', ru: 'Хорошо', kk: 'Жақсы' } },
  { upto: 100, tone: '#d9a51f', label: { en: 'Moderate', ru: 'Умеренно', kk: 'Орташа' } },
  { upto: 150, tone: 'var(--amber)', label: { en: 'Unhealthy for sensitive groups', ru: 'Вредно для чувствительных', kk: 'Сезімтал адамдарға зиянды' } },
  { upto: 200, tone: 'var(--red)', label: { en: 'Unhealthy', ru: 'Вредно', kk: 'Зиянды' } },
  { upto: 300, tone: '#8e3b8f', label: { en: 'Very unhealthy', ru: 'Очень вредно', kk: 'Өте зиянды' } },
  { upto: 500, tone: '#6b1f2a', label: { en: 'Hazardous', ru: 'Опасно', kk: 'Қауіпті' } },
]

function Air({ w }: { w: WeatherDetail }) {
  const { tx } = useApp()
  const a = w.air
  if (!a || a.aqi == null) return null
  const band = AQI_BANDS.find((b) => a.aqi! <= b.upto) ?? AQI_BANDS[AQI_BANDS.length - 1]!
  const pos = Math.min(100, (a.aqi / 300) * 100)
  return (
    <Card title={tx({ en: 'Air quality', ru: 'Качество воздуха', kk: 'Ауа сапасы' })} note={tx({ en: 'CAMS · model estimate', ru: 'CAMS · модельная оценка', kk: 'CAMS · модельдік баға' })}>
      <div className="flex items-baseline gap-3">
        <span className="font-[family-name:var(--font-display)] text-[34px] font-semibold leading-none text-text">{r0(a.aqi)}</span>
        <span className="flex items-center gap-1.5 t-row text-text"><span className="size-2.5 rounded-full" style={{ background: band.tone }} />{tx(band.label)}</span>
      </div>
      <div className="relative">
        <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full">
          {AQI_BANDS.slice(0, 5).map((b, i) => <span key={b.upto} className="h-full" style={{ background: b.tone, flex: i < 2 ? 50 : i === 4 ? 100 : 50 }} />)}
        </div>
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface ring-2 ring-text" style={{ left: `${pos}%` }} />
      </div>
      <div className="flex gap-4 t-meta text-secondary">
        <span>PM2.5 <b className="text-text">{r0(a.pm2_5)}</b> µg/m³</span>
        <span>PM10 <b className="text-text">{r0(a.pm10)}</b> µg/m³</span>
      </div>
    </Card>
  )
}
