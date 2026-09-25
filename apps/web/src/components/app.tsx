'use client'
// App context (language, installation), realtime subscription, and chrome:
// a sidebar on desktop, a floating tab bar with the Report action on phones.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@aktau/i18n'
import type { Lang } from '@aktau/types'
import type { Me } from '@/lib/session'
import { Icon, Logo, type IconName } from './primitives'

export type L3 = { en: string; ru: string; kk?: string }
type AppCtx = {
  lang: Lang
  installationId: string | null
  /** The signed-in account (null = anonymous, which is the normal case). */
  me: Me | null
  t: (key: string, p?: Record<string, string | number>) => string
  /** Inline copy for new surfaces: kk falls back to ru. */
  tx: (s: L3) => string
}
const Ctx = createContext<AppCtx>({ lang: 'en', installationId: null, me: null, t: (k) => k, tx: (s) => s.en })

export function AppProvider({ lang, installationId, me, children }: { lang: Lang; installationId: string | null; me: Me | null; children: ReactNode }) {
  const tr = useCallback((key: string, p?: Record<string, string | number>) => t(lang, key, p), [lang])
  const tx = useCallback((s: L3) => (lang === 'kk' ? s.kk ?? s.ru : s[lang]), [lang])
  return <Ctx.Provider value={{ lang, installationId, me, t: tr, tx }}>{children}<LiveStatus /></Ctx.Provider>
}

export const useApp = () => useContext(Ctx)
export const isStaff = (me: Me | null) => me?.role === 'operator' || me?.role === 'admin'

export const ROLE_LABEL: Record<Me['role'], L3> = {
  resident: { en: 'Resident', ru: 'Житель', kk: 'Тұрғын' },
  operator: { en: '109 operator', ru: 'Оператор 109', kk: '109 операторы' },
  admin: { en: 'Admin', ru: 'Администратор', kk: 'Әкімші' },
}

export async function signOut() {
  await fetch('/api/auth/signout', { method: 'POST' }).catch(() => {})
  location.href = '/'
}

// ── Realtime: one EventSource per tab, fan-out to subscribers ──────────────
// Events are hints from persisted changes (realtime_outbox); every screen
// refetches its canonical state. After a dropped connection the browser
// reconnects on its own (the server replays from Last-Event-ID) and every
// subscriber is told to resync, so nothing depends on an event arriving.
export type RealtimeEvent = { topic: string; kind: string; id: string | null; [k: string]: unknown }
type Listener = (e: RealtimeEvent) => void
type LinkState = 'connecting' | 'live' | 'reconnecting'
const listeners = new Set<Listener>()
const statusListeners = new Set<(s: LinkState) => void>()
let source: EventSource | null = null
let link: LinkState = 'connecting'
let dropped = false
function setLink(s: LinkState) { link = s; statusListeners.forEach((l) => l(s)) }
function ensureSource() {
  if (source || typeof window === 'undefined') return
  source = new EventSource('/api/stream')
  source.onopen = () => {
    setLink('live')
    if (dropped) { dropped = false; listeners.forEach((l) => l({ topic: '*', kind: 'resync', id: null })) }
  }
  source.onerror = () => { dropped = true; setLink('reconnecting') }
  for (const topic of ['city_events', 'sources', 'incidents', 'news']) {
    source.addEventListener(topic, (m) => {
      const data = JSON.parse((m as MessageEvent).data) as { kind: string; id: string | null; [k: string]: unknown }
      listeners.forEach((l) => l({ ...data, topic }))
    })
  }
}

/**
 * Calls `cb` (debounced by `wait` ms) whenever city state changes on the
 * server, and once after a reconnect ({ kind: 'resync' }) so the screen can
 * refetch everything. `filter` can skip events that cannot concern this screen.
 */
export function useRealtime(cb: Listener, topics: string[] = ['city_events'], opts: { wait?: number; filter?: (e: RealtimeEvent) => boolean } = {}) {
  const ref = useRef(cb)
  ref.current = cb
  const filter = useRef(opts.filter)
  filter.current = opts.filter
  const wait = opts.wait ?? 250
  useEffect(() => {
    ensureSource()
    let timer: ReturnType<typeof setTimeout> | undefined
    const l: Listener = (e) => {
      if (e.kind !== 'resync' && (!topics.includes(e.topic) || (filter.current && !filter.current(e)))) return
      clearTimeout(timer)
      timer = setTimeout(() => ref.current(e), wait)
    }
    listeners.add(l)
    return () => { listeners.delete(l); clearTimeout(timer) }
  }, [topics.join(','), wait]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The live link's state, for a quiet "Reconnecting…" indicator. */
export function useLinkState(): LinkState {
  const [s, setS] = useState<LinkState>(link)
  useEffect(() => { setS(link); statusListeners.add(setS); return () => { statusListeners.delete(setS) } }, [])
  return s
}

/** Shows only when the live connection has been down for more than a moment. */
export function LiveStatus() {
  const { tx } = useApp()
  const s = useLinkState()
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (s !== 'reconnecting') { setShow(false); return }
    const t = setTimeout(() => setShow(true), 1500)
    return () => clearTimeout(t)
  }, [s])
  if (!show) return null
  return (
    <div role="status" className="fade-in pointer-events-none fixed left-1/2 top-[calc(10px+env(safe-area-inset-top))] z-50 -translate-x-1/2">
      <span className="glass card-shadow inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-bold text-secondary">
        <span className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none" />
        {tx({ en: 'Reconnecting…', ru: 'Переподключение…', kk: 'Қайта қосылуда…' })}
      </span>
    </div>
  )
}

function useUnread() {
  const [unread, setUnread] = useState(0)
  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch('/api/me/notifications', { cache: 'no-store' }).then((r) => r.json()) as Promise<{ notifications: Array<{ created_at: string }> }>,
        fetch('/api/me/incidents', { cache: 'no-store' }).then((r) => r.json()) as Promise<{ messages: Array<{ created_at: string }> }>,
      ])
      let seen = 0
      try { seen = Number(localStorage.getItem('aktau_inbox_seen') ?? 0) } catch { /* private mode */ }
      setUnread([...a.notifications, ...b.messages].filter((n) => new Date(n.created_at).getTime() > seen).length)
    } catch { /* offline: keep last count */ }
  }, [])
  useEffect(() => { void load() }, [load])
  useRealtime(() => void load(), ['city_events', 'incidents'])
  return unread
}

// ── Chrome ───────────────────────────────────────────────────────────────────
export function TopBar() {
  const { tx } = useApp()
  const unread = useUnread()
  return (
    <header className="glass sticky top-0 z-30 -mx-5 flex h-[calc(52px+env(safe-area-inset-top))] items-center gap-2.5 border-b border-line px-5 pt-[env(safe-area-inset-top)] sm:-mx-6 sm:px-6 lg:hidden">
      <Link href="/" className="tap flex items-center gap-2.5" aria-label="Aktau">
        <Logo size={32} />
        <span className="font-[family-name:var(--font-display)] text-[18px] font-semibold tracking-[-0.03em] text-text">Aktau</span>
      </Link>
      <div className="flex-1" />
      <Link href="/afisha" className="tap grid size-11 place-items-center rounded-full text-secondary hover:bg-surface" aria-label={tx({ en: 'Where to go', ru: 'Афиша', kk: 'Афиша' })}>
        <Icon name="ticket" size={22} />
      </Link>
      <Link href="/news" className="tap grid size-11 place-items-center rounded-full text-secondary hover:bg-surface" aria-label={tx({ en: 'News', ru: 'Новости', kk: 'Жаңалықтар' })}>
        <Icon name="news" size={22} />
      </Link>
      <Link href="/inbox" className="tap relative -mr-1.5 grid size-11 place-items-center rounded-full text-secondary hover:bg-surface" aria-label={`${tx({ en: 'Inbox', ru: 'Входящие', kk: 'Хабарлар' })}${unread ? ` (${unread})` : ''}`}>
        <Icon name="bell" size={22} />
        {unread > 0 ? <span className="absolute right-2 top-2 grid min-w-4 place-items-center rounded-full bg-red px-1 text-[9.5px] font-bold leading-4 text-white">{unread > 9 ? '9+' : unread}</span> : null}
      </Link>
    </header>
  )
}

type Tab = { href: string; icon: IconName; label: L3; match: (p: string) => boolean }
const TABS: Tab[] = [
  { href: '/', icon: 'home', label: { en: 'Home', ru: 'Главная', kk: 'Басты' }, match: (p) => p === '/' || p.startsWith('/event') },
  { href: '/map', icon: 'map', label: { en: 'Map', ru: 'Карта', kk: 'Карта' }, match: (p) => p.startsWith('/map') || p.startsWith('/place') },
  { href: '/report', icon: 'report', label: { en: 'Report', ru: 'Сообщить', kk: 'Хабарлау' }, match: (p) => p.startsWith('/report') || p.startsWith('/incident') },
  { href: '/ask', icon: 'ask', label: { en: 'Ask', ru: 'Спросить', kk: 'Сұрау' }, match: (p) => p.startsWith('/ask') },
  { href: '/you', icon: 'you', label: { en: 'You', ru: 'Вы', kk: 'Сіз' }, match: (p) => p.startsWith('/you') || p.startsWith('/inbox') },
]

/** True while a text field has focus: on phones the on-screen keyboard is up. */
function useTyping() {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes((t as HTMLInputElement).type)) || t.isContentEditable)
    const on = (e: FocusEvent) => { if (isField(e.target)) setTyping(true) }
    const off = (e: FocusEvent) => { if (isField(e.target)) setTyping(false) }
    document.addEventListener('focusin', on)
    document.addEventListener('focusout', off)
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', off) }
  }, [])
  return typing
}

export function BottomNav() {
  const path = usePathname() ?? '/'
  const { tx } = useApp()
  const typing = useTyping()
  return (
    <nav className={`fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(10px,env(safe-area-inset-bottom))] transition-[transform,opacity] duration-200 lg:hidden ${typing ? 'pointer-events-none translate-y-full opacity-0' : ''}`} aria-label="Main">
      <ul className="glass card-shadow mx-auto flex h-[66px] max-w-[460px] items-center justify-between rounded-[26px] px-2">
        {TABS.map((tab) => {
          const active = tab.match(path)
          if (tab.href === '/report') {
            return (
              <li key={tab.href} className="flex w-[72px] justify-center">
                <Link href={tab.href} aria-current={active ? 'page' : undefined} className="tap -mt-6 flex flex-col items-center gap-1">
                  <span className={`grid size-[54px] place-items-center rounded-[19px] bg-blue shadow-[0_8px_18px_-8px_var(--blue)] ring-4 ring-bg ${active ? 'bg-blue-strong' : ''}`}>
                    <Icon name="report" size={23} className="text-on-blue" />
                  </span>
                  <span className={`t-nav ${active ? 'text-text' : 'text-faint'}`}>{tx(tab.label)}</span>
                </Link>
              </li>
            )
          }
          return (
            <li key={tab.href} className="w-[64px]">
              <Link href={tab.href} aria-current={active ? 'page' : undefined} className={`tap flex flex-col items-center gap-1 rounded-[16px] py-1.5 ${active ? 'text-text' : 'text-faint hover:text-secondary'}`}>
                <Icon name={tab.icon} size={22} />
                <span className="t-nav">{tx(tab.label)}</span>
                <span className={`h-[3px] w-4 rounded-full transition-colors ${active ? 'bg-blue' : 'bg-transparent'}`} />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

const NEWS_TAB: Tab = { href: '/news', icon: 'news', label: { en: 'News', ru: 'Новости', kk: 'Жаңалықтар' }, match: (p) => p.startsWith('/news') }
const AFISHA_TAB: Tab = { href: '/afisha', icon: 'ticket', label: { en: 'Where to go', ru: 'Афиша', kk: 'Афиша' }, match: (p) => p.startsWith('/afisha') }

export function SideNav() {
  const path = usePathname() ?? '/'
  const { tx, lang, me } = useApp()
  const unread = useUnread()
  const item = (active: boolean) => `tap flex h-11 items-center gap-3 rounded-[14px] px-3 text-[14px] font-bold ${active ? 'bg-bg text-text hairline' : 'text-secondary hover:bg-bg hover:text-text'}`
  const nav = [...TABS.slice(0, 4), NEWS_TAB, AFISHA_TAB, TABS[4]!]
  return (
    <aside className="sticky top-0 hidden h-dvh w-[264px] flex-none flex-col gap-6 overflow-y-auto border-r border-line bg-surface/60 px-5 py-6 no-scrollbar lg:flex">
      <Link href="/" className="tap flex items-center gap-3 px-2" aria-label="Aktau">
        <Logo size={36} />
        <span className="font-[family-name:var(--font-display)] text-[20px] font-semibold leading-none tracking-[-0.03em] text-text">Aktau</span>
      </Link>
      <nav className="flex flex-col gap-1" aria-label="Main">
        {nav.map((tab) => {
          const active = tab.match(path)
          const report = tab.href === '/report'
          return (
            <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined}
              className={report ? 'tap beam-fill beam-glow my-1 flex h-11 items-center gap-3 rounded-[14px] px-3 text-[14px] font-bold text-on-blue' : item(active)}>
              <Icon name={tab.icon} size={20} />
              <span className="flex-1 truncate">{report ? tx({ en: 'Report a problem', ru: 'Сообщить о проблеме', kk: 'Мәселені хабарлау' }) : tx(tab.label)}</span>
            </Link>
          )
        })}
        <Link href="/inbox" aria-current={path.startsWith('/inbox') ? 'page' : undefined} className={item(path.startsWith('/inbox'))}>
          <Icon name="bell" size={20} />
          <span className="flex-1">{tx({ en: 'Inbox', ru: 'Входящие', kk: 'Хабарлар' })}</span>
          {unread ? <span className="grid min-w-5 place-items-center rounded-full bg-red px-1.5 text-[10.5px] font-bold leading-5 text-white">{unread}</span> : null}
        </Link>
      </nav>
      {isStaff(me) ? (
        <nav className="flex flex-col gap-1" aria-label={tx({ en: 'Workspace', ru: 'Рабочее место', kk: 'Жұмыс орны' })}>
          <p className="t-label px-3 pb-1 text-faint">{tx({ en: 'Workspace', ru: 'Рабочее место', kk: 'Жұмыс орны' })}</p>
          <Link href="/copilot" aria-current={path.startsWith('/copilot') ? 'page' : undefined} className={item(path.startsWith('/copilot'))}>
            <Icon name="radar" size={20} className="text-beam" />
            <span className="flex-1">109 Copilot</span>
          </Link>
          {me?.role === 'admin' ? (
            <Link href="/admin" className={item(false)}>
              <Icon name="key" size={20} />
              <span className="flex-1">{tx({ en: 'Admin console', ru: 'Админ-панель', kk: 'Әкімші панелі' })}</span>
              <Icon name="arrow" size={14} className="text-faint" />
            </Link>
          ) : null}
        </nav>
      ) : null}
      <div className="flex-1" />
      <AccountCard />
      <div className="flex flex-col gap-1 px-2">
        <Link href="/welcome" className="tap flex items-center gap-2 t-meta font-bold text-secondary hover:text-text">
          <Icon name="lighthouse" size={15} /> {tx({ en: 'About Aktau', ru: 'О проекте', kk: 'Жоба туралы' })}
        </Link>
        <p className="t-meta text-faint">{lang === 'en' ? 'Map data © OpenStreetMap' : 'Данные карты © OpenStreetMap'}</p>
      </div>
    </aside>
  )
}

export function Avatar({ me, size = 36 }: { me: Me; size?: number }) {
  const initial = (me.name ?? me.email).trim().charAt(0).toUpperCase()
  return (
    <span className={`grid flex-none place-items-center rounded-full font-[family-name:var(--font-display)] font-semibold ${me.role === 'resident' ? 'bg-soft text-blue' : 'beam-fill'}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{initial}</span>
  )
}

function AccountCard() {
  const { me, tx } = useApp()
  if (!me) {
    return (
      <Link href="/signin" className="tap flex items-center gap-3 rounded-[18px] bg-bg p-3.5 hairline hover:bg-surface-2">
        <span className="grid size-9 place-items-center rounded-full bg-soft text-blue"><Icon name="you" size={18} /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="t-row text-text">{tx({ en: 'Sign in', ru: 'Войти', kk: 'Кіру' })}</span>
          <span className="t-meta text-secondary">{tx({ en: 'Optional · keeps your places', ru: 'Необязательно · сохранит места', kk: 'Міндетті емес' })}</span>
        </span>
      </Link>
    )
  }
  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-bg p-3 hairline">
      <Link href="/you" className="tap flex min-w-0 flex-1 items-center gap-3">
        <Avatar me={me} />
        <span className="flex min-w-0 flex-col">
          <span className="t-row truncate text-text">{me.name ?? me.email.split('@')[0]}</span>
          <span className={`t-meta truncate ${me.role === 'resident' ? 'text-secondary' : 'font-bold text-beam'}`}>{tx(ROLE_LABEL[me.role])}</span>
        </span>
      </Link>
      <button type="button" onClick={() => void signOut()} className="tap grid size-9 flex-none place-items-center rounded-full text-faint hover:bg-surface hover:text-text" aria-label={tx({ en: 'Sign out', ru: 'Выйти', kk: 'Шығу' })}>
        <Icon name="logout" size={17} />
      </button>
    </div>
  )
}

/** Mobile: one column + floating tab bar. Desktop: sidebar + a wider reading column. */
export function Screen({ children, bare = false, wide = false }: { children: ReactNode; bare?: boolean; wide?: boolean | 'xl' }) {
  return (
    <div className="min-h-dvh bg-bg lg:flex">
      <SideNav />
      <div className="relative flex min-h-dvh min-w-0 flex-1 flex-col">
        {bare ? children : (
          <div className={`mx-auto flex w-full flex-1 flex-col px-5 pb-32 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10 ${wide === 'xl' ? 'max-w-[1280px]' : wide ? 'max-w-[1120px]' : 'max-w-[520px] lg:max-w-[760px]'}`}>
            <TopBar />
            <main className="mt-4 flex flex-1 flex-col lg:mt-0">{children}</main>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
