'use client'
// You · your Aktau, alerts, home picker, inbox, data sources.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ago, areaName } from '@aktau/i18n'
import type { AlertPreferences, Lang } from '@aktau/types'
import { useApp } from './app'
import { AccountSection } from './account'
import { EVIDENCE_CREDITS, PHOTOS } from '@/lib/photos'
import { BackLink, Badge, Button, Eyebrow, Icon, PageTitle, Plaque, Toggle, type IconName } from './primitives'

type SavedLoc = { id: string; label: string; type: string; is_primary: boolean; area_name: string | null; area_name_ru: string | null; area_name_kk: string | null; designator: string | null; house_number: string | null }

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax`
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-[12px] bg-bg p-0.5 hairline">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={v === value}
          className={`tap h-8 rounded-[10px] px-2.5 text-[12px] font-bold ${v === value ? 'bg-surface text-text card-shadow' : 'text-secondary hover:text-text'}`}>{l}</button>
      ))}
    </div>
  )
}

export function YouView({ locations, reports = 0 }: { locations: SavedLoc[]; reports?: number }) {
  const { lang, t, tx, me } = useApp()
  const home = locations.find((l) => l.type === 'HOME') ?? locations[0]
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system')
  useEffect(() => { setTheme((document.cookie.match(/aktau_theme=(\w+)/)?.[1] as never) ?? 'system') }, [])
  const setLang = async (next: Lang) => {
    setCookie('aktau_lang', next)
    // Notifications are rendered server-side in the device's language.
    const iid = document.cookie.match(/aktau_iid=([^;]+)/)?.[1]
    if (iid) await fetch('/api/device/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installation_id: iid, platform: 'web', language: next }) }).catch(() => {})
    location.reload()
  }
  const applyTheme = (next: 'system' | 'light' | 'dark') => {
    setCookie('aktau_theme', next); setTheme(next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
  }
  const numeric = home?.designator && /^\d/.test(home.designator)
  return (
    <div className="flex flex-col gap-5">
      <div className="rise"><PageTitle eyebrow={me ? me.email : tx({ en: 'No account needed', ru: 'Без аккаунта', kk: 'Аккаунтсыз' })}>{t('you.title')}</PageTitle></div>

      <Link href="/you/home" className="rise rise-1 tap relative overflow-hidden rounded-[28px] bg-surface card-shadow">
        <div className="panel-seams absolute inset-0 opacity-70" aria-hidden />
        <div className="relative flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between"><Eyebrow>{t('loc.home')}</Eyebrow><span className="t-meta font-bold text-blue">{home ? tx({ en: 'Change', ru: 'Изменить', kk: 'Өзгерту' }) : t('you.setHome')} →</span></div>
          {home ? (numeric ? <Plaque district={home.designator!} house={home.house_number} size={64} /> : <span className="plaque text-[36px] text-text">{home.designator ? areaName(lang, { name: home.area_name ?? '', name_ru: home.area_name_ru, name_kk: home.area_name_kk }) : home.label}</span>)
            : <span className="plaque text-[40px] text-faint">?? / ??</span>}
          <p className="t-sub text-secondary">{home ? t('you.atHome') : t('you.noHome')}</p>
        </div>
      </Link>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-end justify-between"><h2 className="t-section text-text">{t('you.myPlaces')}</h2><Link href="/you/home?type=CUSTOM" className="tap t-meta font-bold text-blue">+ {t('action.add')}</Link></div>
        <div className="no-scrollbar -mx-5 flex gap-2.5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          {locations.length ? locations.map((l) => (
            <Link key={l.id} href={`/?saved=${l.id}`} className="tap flex w-[128px] flex-none flex-col gap-2 rounded-[18px] bg-surface p-3.5 card-shadow hover:bg-surface-2">
              <span className="t-label !text-[9.5px] text-faint">{l.type === 'HOME' ? t('loc.home') : l.label}</span>
              <span className="plaque text-[24px] text-text">{l.designator ? `${l.designator}${l.house_number ? `/${l.house_number}` : ''}` : '•'}</span>
            </Link>
          )) : <p className="t-sub text-secondary">{t('you.noPlaces')}</p>}
        </div>
      </section>

      <Link href="/report" className="tap flex items-center gap-4 rounded-[22px] bg-surface p-5 text-text card-shadow">
        <span className="grid size-12 place-items-center rounded-[16px] beam-fill"><Icon name="report" size={22} className="text-on-blue" /></span>
        <span className="flex flex-1 flex-col"><span className="t-card text-text">{tx({ en: 'My reports to 109', ru: 'Мои обращения в 109', kk: '109-ға өтініштерім' })}</span><span className="t-meta text-secondary">{reports ? tx({ en: `${reports} followed · every update comes to your inbox`, ru: `${reports} отслеживается · все обновления во входящих`, kk: `${reports} бақылауда` }) : tx({ en: 'Report a problem in one sentence', ru: 'Сообщите о проблеме одним предложением', kk: 'Мәселені бір сөйлеммен хабарлаңыз' })}</span></span>
        <span className="t-num text-[28px] font-semibold text-text">{reports}</span>
      </Link>

      <section className="flex flex-col rounded-[22px] bg-surface p-2 card-shadow">
        <SettingRow icon="bell" href="/you/alerts" title={t('you.alerts')} sub={t('you.alerts.sub')} />
        <div className="flex min-h-[60px] items-center gap-3 px-3">
          <Icon name="globe" size={19} className="text-secondary" />
          <span className="t-row flex-1 text-text">{t('you.language')}</span>
          <Segmented value={lang} options={[['ru', 'РУС'], ['kk', 'ҚАЗ'], ['en', 'ENG']]} onChange={(v) => void setLang(v)} />
        </div>
        <div className="flex min-h-[60px] items-center gap-3 px-3">
          <Icon name="moon" size={19} className="text-secondary" />
          <span className="t-row flex-1 text-text">{t('you.appearance')}</span>
          <Segmented value={theme} options={[['system', tx({ en: 'Auto', ru: 'Авто', kk: 'Авто' })], ['light', tx({ en: 'Day', ru: 'День', kk: 'Күн' })], ['dark', tx({ en: 'Night', ru: 'Ночь', kk: 'Түн' })]]} onChange={applyTheme} />
        </div>
        <SettingRow icon="shield" href="/you/sources" title={t('you.sources')} sub={t('you.sources.sub')} />
        <SettingRow icon="lighthouse" href="/welcome" title={tx({ en: 'About Aktau', ru: 'О проекте Aktau', kk: 'Aktau туралы' })} sub={tx({ en: 'How the city picture is built', ru: 'Как устроена картина города', kk: 'Қала бейнесі қалай құрылады' })} />
      </section>

      <AccountSection />
    </div>
  )
}

function SettingRow({ icon, title, sub, href }: { icon: IconName; title: string; sub: string; href: string }) {
  return (
    <Link href={href} className="tap flex min-h-[60px] items-center gap-3 rounded-[14px] px-3 hover:bg-surface-2">
      <Icon name={icon} size={19} className="text-secondary" />
      <span className="flex flex-1 flex-col"><span className="t-row text-text">{title}</span><span className="t-meta text-secondary">{sub}</span></span>
      <Icon name="chevron" size={16} className="text-faint" />
    </Link>
  )
}

// ── Home picker: local index only ("14" never leaves our database) ────────
type Hit = { kind: 'area' | 'building'; id: string; area_id?: string; label: string; sublabel: string; designator?: string | null }

export function HomePicker({ type = 'HOME' }: { type?: 'HOME' | 'CUSTOM' }) {
  const { t, tx } = useApp()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [area, setArea] = useState<Hit | null>(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState(type === 'HOME' ? 'Home' : '')
  useEffect(() => {
    const query = area ? `${area.designator ?? ''} ${q}` : q
    if (!query.trim()) { setHits([]); return }
    const ctl = new AbortController()
    const id = setTimeout(() => {
      fetch(`/api/areas/search?q=${encodeURIComponent(query.trim())}`, { signal: ctl.signal }).then((r) => r.json()).then((d) => setHits(d.results)).catch(() => {})
    }, 150)
    return () => { clearTimeout(id); ctl.abort() }
  }, [q, area])

  const save = async (body: Record<string, unknown>) => {
    setBusy(true)
    await fetch('/api/me/locations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: label || 'Place', type, ...body }) })
    router.push(type === 'HOME' ? '/' : '/you')
    router.refresh()
  }

  const preview = q.match(/^\s*(\d{1,2}[а-яa-z]?)\s*[ ,/-]\s*(\d{1,3}[а-яa-z]?)\s*$/i)
  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/you">{t('nav.you')}</BackLink>
      <PageTitle sub={tx({ en: 'Type your microdistrict and house, e.g. “14 21”. Utility notices often name specific houses, so the house number matters. Nothing you type leaves Aktau’s own database.', ru: 'Введите микрорайон и дом, например «14 21». Уведомления часто называют конкретные дома — номер дома важен. Ничего из введённого не уходит за пределы базы Aktau.', kk: 'Шағын аудан мен үйді жазыңыз, мысалы «14 21».' })}>{type === 'HOME' ? t('you.setHome') : t('action.add')}</PageTitle>
      <div className="flex items-center justify-center rounded-[26px] bg-surface py-8 card-shadow panel-seams">
        {area ? <Plaque district={area.designator ?? '?'} house={q.trim() || '··'} size={72} />
          : preview ? <Plaque district={preview[1]!.toUpperCase()} house={preview[2]!.toUpperCase()} size={72} />
          : <span className="plaque text-[72px] text-faint">{q.trim() || '14 / 21'}</span>}
      </div>
      {type === 'CUSTOM' ? (
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tx({ en: 'Name (School, Work…)', ru: 'Название (Школа, Работа…)', kk: 'Атауы (Мектеп, Жұмыс…)' })} className="h-[52px] rounded-[16px] bg-surface px-4 t-body text-text outline-none card-shadow placeholder:text-faint" />
      ) : null}
      {area ? (
        <div className="flex items-center justify-between rounded-[16px] bg-soft px-4 py-3">
          <span className="t-row text-text">{area.label}</span>
          <button type="button" className="t-meta font-bold text-blue" onClick={() => { setArea(null); setQ('') }}>{tx({ en: 'Change', ru: 'Изменить', kk: 'Өзгерту' })}</button>
        </div>
      ) : null}
      <label className="flex h-[56px] items-center gap-3 rounded-[18px] bg-surface px-4 card-shadow">
        <Icon name="search" size={20} className="text-secondary" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={area ? tx({ en: 'House number', ru: 'Номер дома', kk: 'Үй нөмірі' }) : '14, 14 21, Samal…'} inputMode={area ? 'numeric' : 'text'}
          className="h-full flex-1 bg-transparent t-body !text-[16px] text-text outline-none placeholder:text-faint" />
      </label>
      <div className="flex flex-col gap-2">
        {hits.map((h) => (
          <button key={`${h.kind}-${h.id}`} type="button" disabled={busy}
            onClick={() => (h.kind === 'building' ? save({ building_id: h.id }) : (setArea(h), setQ('')))}
            className="tap flex h-[64px] items-center gap-3 rounded-[18px] bg-surface px-4 text-left card-shadow hover:bg-surface-2">
            <span className="grid size-10 place-items-center rounded-[12px] bg-surface-2 hairline"><Icon name={h.kind === 'building' ? 'building' : 'pin'} size={19} className="text-blue" /></span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="t-row text-text">{h.label}</span>
              <span className="t-meta text-secondary">{h.kind === 'building' ? tx({ en: 'Building · OpenStreetMap address', ru: 'Дом · адрес OpenStreetMap', kk: 'Үй · OpenStreetMap' }) : h.sublabel}</span>
            </span>
            <Icon name="chevron" size={16} className="text-faint" />
          </button>
        ))}
      </div>
      {area ? <Button style="secondary" disabled={busy} onClick={() => save({ area_id: area.id })}>{tx({ en: 'Use the whole microdistrict', ru: 'Весь микрорайон', kk: 'Бүкіл шағын аудан' })}</Button> : null}
      <Button style="quiet" disabled={busy} onClick={() => navigator.geolocation?.getCurrentPosition((p) => save({ lat: p.coords.latitude, lon: p.coords.longitude }))}>
        <Icon name="pin" size={17} />{tx({ en: 'Use my current location', ru: 'Моё текущее местоположение', kk: 'Қазіргі орным' })}
      </Button>
    </div>
  )
}

// ── Alerts · Preferences ─────────────────────────────────────────────────────
const PREF_ROWS: Array<[keyof AlertPreferences, string, IconName]> = [
  ['water', 'alerts.water', 'water'], ['electricity', 'alerts.electricity', 'power'], ['heating', 'alerts.heating', 'flame'], ['road', 'alerts.road', 'roads'],
  ['weather', 'alerts.weather', 'wind'], ['transport', 'alerts.transport', 'bus'], ['events', 'alerts.events', 'calendar'],
]

export function AlertsView({ initial }: { initial: AlertPreferences }) {
  const { t } = useApp()
  const router = useRouter()
  const [p, setP] = useState(initial)
  const [saved, setSaved] = useState(false)
  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/you">{t('nav.you')}</BackLink>
      <PageTitle sub={t('alerts.subtitle')}>{t('alerts.title')}</PageTitle>
      <section className="flex flex-col rounded-[22px] bg-surface p-2 card-shadow">
        {PREF_ROWS.map(([k, label, icon]) => (
          <div key={k} className="flex min-h-[58px] items-center gap-3 px-3">
            <Icon name={icon} size={19} className="text-secondary" />
            <span className="t-row flex-1 text-text">{t(label)}</span>
            <Toggle label={t(label)} checked={p[k] as boolean} onChange={(v) => { setP({ ...p, [k]: v }); setSaved(false) }} />
          </div>
        ))}
      </section>
      <button type="button" onClick={() => { setP({ ...p, affects_me_only: !p.affects_me_only }); setSaved(false) }}
        className={`tap flex flex-col gap-2 rounded-[22px] p-5 text-left ${p.affects_me_only ? 'bg-soft ring-2 ring-blue' : 'bg-surface card-shadow'}`}>
        <span className="flex items-center justify-between"><span className="t-card text-text">{t('alerts.onlyMe')}</span>{p.affects_me_only ? <Icon name="check" size={20} className="text-blue" /> : <span className="size-5 rounded-full border-2 border-border" />}</span>
        <span className="t-sub text-secondary">{t('alerts.onlyMe.body')}</span>
      </button>
      <Button onClick={async () => {
        await fetch('/api/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, emergency: true }) })
        setSaved(true)
        setTimeout(() => router.push('/you'), 600)
      }}>{saved ? <><Icon name="check" size={18} />{t('action.save')}</> : t('action.save')}</Button>
    </div>
  )
}

// ── Inbox: official notifications + 109 incident updates, one stream ─────────
type Note = { id: string; event_id?: string | null; incident_id?: string | null; code?: string | null; kind: 'event' | 'incident'; msg_kind?: string; title: string; body: string; created_at: string }

export function InboxView({ items }: { items: Note[] }) {
  const { lang, t, tx } = useApp()
  // Read after mount: the server cannot know what this device has seen.
  const [seen, setSeen] = useState<number>(Number.POSITIVE_INFINITY)
  useEffect(() => {
    try { setSeen(Number(localStorage.getItem('aktau_inbox_seen') ?? 0)); localStorage.setItem('aktau_inbox_seen', String(Date.now())) } catch { setSeen(0) }
  }, [])
  return (
    <div className="flex flex-col gap-5">
      <PageTitle eyebrow={tx({ en: 'Official notices · 109 updates', ru: 'Уведомления · обновления 109', kk: 'Хабарламалар · 109 жаңалықтары' })}>{t('inbox.title')}</PageTitle>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[24px] bg-surface p-10 text-center card-shadow">
          <Icon name="inbox" size={32} className="text-faint" />
          <p className="t-body text-secondary">{t('inbox.empty')}</p>
          <Link href="/report" className="t-meta font-bold text-blue">{tx({ en: 'Report a problem →', ru: 'Сообщить о проблеме →', kk: 'Мәселе туралы хабарлау →' })}</Link>
        </div>
      ) : null}
      <div className="flex flex-col gap-2.5">
        {items.map((n) => {
          const fresh = new Date(n.created_at).getTime() > seen
          return (
            <Link key={n.id} href={n.kind === 'incident' ? `/incident/${n.code ?? n.incident_id}${n.msg_kind === 'verify_request' ? '#verify' : ''}` : `/event/${n.event_id}`} className={`tap flex gap-3 rounded-[20px] p-4 card-shadow hover:bg-surface-2 ${n.msg_kind === 'warning' ? 'bg-red-soft' : 'bg-surface'}`}>
              <span className={`grid size-10 flex-none place-items-center rounded-[13px] ${n.msg_kind === 'warning' ? 'bg-red text-bg' : n.kind === 'incident' ? 'beam-fill' : 'bg-soft'}`}><Icon name={n.msg_kind === 'warning' ? 'alert' : n.msg_kind === 'verify_request' ? 'check' : n.kind === 'incident' ? 'radar' : 'shield'} size={18} className={n.msg_kind === 'warning' ? '' : n.kind === 'incident' ? 'text-on-blue' : 'text-blue'} /></span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="t-row text-text">{n.title}</span>
                  <span className="flex flex-none items-center gap-1.5 t-meta text-faint" suppressHydrationWarning>{fresh ? <span className="size-2 rounded-full bg-red" /> : null}{ago(lang, n.created_at)}</span>
                </div>
                <span className="t-sub text-secondary">{n.body}</span>
                {n.kind === 'incident' && n.code ? <span className="flex items-center gap-2 t-mono text-[11px] text-faint">{n.code}{n.msg_kind === 'verify_request' ? <span className="rounded-full bg-green-soft px-2 py-0.5 font-sans text-[11px] font-bold text-green">{tx({ en: 'Answer: is it fixed?', ru: 'Ответить: решено?', kk: 'Жауап беру' })}</span> : null}</span> : null}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ── Data sources (public source health) ─────────────────────────────────────
type SourceRow = { slug: string; name: string; organization: string | null; source_type: string; authority_level: number; adapter_type: string; enabled: boolean; last_successful_fetch_at: string | null; last_run_status: string | null; notes?: string | null }

export function SourcesView({ sources }: { sources: SourceRow[] }) {
  const { lang, tx } = useApp()
  const state = (s: SourceRow) => !s.enabled ? { tone: 'neutral' as const, label: tx({ en: 'off', ru: 'выкл.', kk: 'өшірулі' }) }
    : s.adapter_type === 'manual' ? { tone: 'unknown' as const, label: tx({ en: 'manual review', ru: 'ручная проверка', kk: 'қолмен тексеру' }) }
    : s.last_run_status === 'FAILED' ? { tone: 'active' as const, label: tx({ en: 'unavailable', ru: 'недоступен', kk: 'қолжетімсіз' }) }
    : s.last_successful_fetch_at ? { tone: 'resolved' as const, label: tx({ en: 'live', ru: 'работает', kk: 'жұмыс істейді' }) } : { tone: 'unknown' as const, label: tx({ en: 'pending', ru: 'ожидание', kk: 'күтуде' }) }
  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/you">{tx({ en: 'You', ru: 'Вы', kk: 'Сіз' })}</BackLink>
      <PageTitle sub={tx({ en: 'Official utilities outrank the akimat, 109, local media and resident reports. Model data is always labelled as a model.', ru: 'Официальные коммунальные службы важнее акимата, 109, СМИ и сообщений жителей. Модельные данные всегда помечены как модель.', kk: 'Ресми коммуналдық қызметтер әкімдіктен, 109-дан, БАҚ пен тұрғындардан жоғары.' })}>{tx({ en: 'Data sources', ru: 'Источники данных', kk: 'Дереккөздер' })}</PageTitle>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {sources.map((s) => {
          const st = state(s)
          return (
            <div key={s.slug} className="flex flex-col gap-2 rounded-[20px] bg-surface p-4 card-shadow">
              <div className="flex items-center justify-between gap-2"><span className="t-row text-text">{s.name}</span><Badge tone={st.tone} dot>{st.label}</Badge></div>
              <span className="t-meta text-secondary">{s.organization} · {s.source_type.toLowerCase()}</span>
              <div className="flex items-center gap-2"><span className="t-label !text-[9px] text-faint">authority</span><span className="h-1 flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-blue" style={{ width: `${s.authority_level}%` }} /></span><span className="t-mono text-[10.5px] text-faint">{s.authority_level}</span></div>
              {s.last_successful_fetch_at ? <span className="t-meta text-faint" suppressHydrationWarning>{tx({ en: 'Last checked', ru: 'Проверено', kk: 'Тексерілді' })} {ago(lang, s.last_successful_fetch_at)}</span> : null}
            </div>
          )
        })}
      </div>
      <section className="flex flex-col gap-3 pt-2">
        <h2 className="t-section text-text">{tx({ en: 'Photographs', ru: 'Фотографии', kk: 'Суреттер' })}</h2>
        <p className="t-sub max-w-[60ch] text-secondary">{tx({ en: 'City photos are from Wikimedia Commons, used under their licences. News photos belong to their publishers. 109 demo evidence uses stock photos, not the real place.', ru: 'Фото города с Wikimedia Commons, по их лицензиям. Фото новостей принадлежат изданиям. В демо 109 используются стоковые фото, а не реальное место.', kk: 'Қала суреттері Wikimedia Commons-тан, лицензиялары бойынша.' })}</p>
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {[...Object.values(PHOTOS), ...EVIDENCE_CREDITS].map((p) => (
            <li key={p.page} className="t-meta text-secondary"><a href={p.page} target="_blank" rel="noopener noreferrer" className="text-text hover:text-blue hover:underline">{p.alt}</a>, {p.author}, {p.license}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
