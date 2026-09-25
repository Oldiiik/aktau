'use client'
// Ask · the Aktau assistant. A chat that streams from /api/assistant: the
// model's short answer, what it is doing right now ("searching places"), and
// native cards for every tool result (places with call and route, official
// notices, 109 incidents, news). Facts on cards come from data, never prose.
// The user can attach a photo (resized here, sent with that one question),
// share their current position for "near me", and dictate by voice.
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AssistantEvent, AssistantMode, ChatImage, PlaceCard } from '@aktau/server'
import type { AskResponse } from '@aktau/types'
import { useApp, type L3 } from './app'
import { Answer } from './ask'
import { Icon, Logo, type IconName } from './primitives'
import { PHOTOS } from '@/lib/photos'
import { preparePhoto } from '@/lib/photo'

type Card = Exclude<AssistantEvent, { type: 'text' | 'status' | 'done' | 'error' }>
type Msg =
  | { role: 'user'; text: string; thumb?: string }
  | { role: 'assistant'; text: string; cards: Card[]; steps: string[]; working: string | null; error: string | null; done: boolean }

const STORE = 'aktau_chat_v1'
const HERE_ON = 'aktau_chat_here'

function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), reject, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  ))
}

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null }
const speechCtor = () => (typeof window === 'undefined' ? null : ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition ?? null))

const STARTERS: Array<{ icon: IconName; q: L3; photo?: true }> = [
  { icon: 'camera', q: { en: 'Photograph a problem, get a 109 report', ru: 'Сфотографируйте проблему, получите обращение в 109', kk: 'Мәселені суретке түсіріп, 109-ға өтініш алыңыз' }, photo: true },
  { icon: 'eye', q: { en: 'Where can I fix my glasses?', ru: 'Где починить очки?', kk: 'Көзілдірікті қайда жөндеуге болады?' } },
  { icon: 'power', q: { en: 'Will there be electricity tomorrow?', ru: 'Будет ли завтра свет?', kk: 'Ертең жарық бола ма?' } },
  { icon: 'shield', q: { en: 'A pharmacy open right now near me', ru: 'Аптека рядом, открытая сейчас', kk: 'Қазір ашық дәріхана жақын жерде' } },
  { icon: 'water', q: { en: 'Can I swim in the Caspian today?', ru: 'Можно сегодня купаться в Каспии?', kk: 'Бүгін Каспийде шомылуға бола ма?' } },
  { icon: 'report', q: { en: 'The street light by my building is out', ru: 'У моего дома не горит фонарь', kk: 'Үйімнің жанындағы шам жанбайды' } },
]

export function AssistantView() {
  const { lang, tx, me } = useApp()
  const params = useSearchParams()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<AssistantMode | null>(null)
  const [photo, setPhoto] = useState<{ image: ChatImage; thumb: string } | null>(null)
  const [hereOn, setHereOn] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [canSpeak, setCanSpeak] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<Recognition | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Synchronous guards: state updates are async, and dev Strict Mode runs effects twice.
  const busyRef = useRef(false)
  const initialSent = useRef(false)

  useEffect(() => {
    // Restore the last conversation only into an empty chat (a question from ?q= may already be running).
    try {
      const saved = localStorage.getItem(STORE)
      if (saved) { const list = (JSON.parse(saved) as Msg[]).map((m) => (m.role === 'assistant' ? { ...m, working: null, done: true } : m)); setMsgs((cur) => (cur.length ? cur : list)) }
    } catch { /* storage unavailable */ }
    fetch('/api/assistant').then((r) => r.json()).then((d) => setMode(d.mode)).catch(() => {})
    try { setHereOn(localStorage.getItem(HERE_ON) === '1') } catch { /* storage unavailable */ }
    setCanSpeak(!!speechCtor())
  }, [])

  const toggleHere = async () => {
    setHint(null)
    if (hereOn) { setHereOn(false); try { localStorage.removeItem(HERE_ON) } catch { /* ignore */ } return }
    try {
      await currentPosition()
      setHereOn(true); try { localStorage.setItem(HERE_ON, '1') } catch { /* ignore */ }
    } catch { setHint(tx({ en: 'Location is off or not allowed for this site.', ru: 'Геолокация выключена или не разрешена для сайта.', kk: 'Геолокация өшірулі немесе рұқсат жоқ.' })) }
  }

  const pickPhoto = async (f: File | undefined) => {
    setHint(null)
    if (!f) return
    try { setPhoto(await preparePhoto(f)) } catch { setHint(tx({ en: 'Could not read this photo.', ru: 'Не удалось прочитать фото.', kk: 'Фотоны оқу мүмкін болмады.' })) }
  }

  const dictate = () => {
    const Ctor = speechCtor()
    if (!Ctor) return
    if (listening) { recRef.current?.stop(); return }
    const rec = new Ctor()
    rec.lang = lang === 'kk' ? 'kk-KZ' : lang === 'ru' ? 'ru-RU' : 'en-US'
    rec.interimResults = true; rec.continuous = false
    const before = q ? `${q.trim()} ` : ''
    rec.onresult = (e) => setQ(before + Array.from(e.results).map((r) => r[0]?.transcript ?? '').join(''))
    rec.onend = () => { setListening(false); recRef.current = null; inputRef.current?.focus() }
    rec.onerror = () => setHint(tx({ en: 'Voice input is not available right now.', ru: 'Голосовой ввод сейчас недоступен.', kk: 'Дауыспен енгізу қазір қолжетімсіз.' }))
    recRef.current = rec; setListening(true); rec.start()
  }
  useEffect(() => { if (!msgs.length) return; try { localStorage.setItem(STORE, JSON.stringify(msgs.slice(-30))) } catch { /* ignore */ } }, [msgs])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs])

  const patchLast = (f: (m: Extract<Msg, { role: 'assistant' }>) => Extract<Msg, { role: 'assistant' }>) =>
    setMsgs((ms) => ms.map((m, i) => (i === ms.length - 1 && m.role === 'assistant' ? f(m) : m)))

  const send = useCallback(async (text: string, withPhoto: { image: ChatImage; thumb: string } | null = null) => {
    const question = text.trim()
    if ((!question && !withPhoto) || busyRef.current) return
    busyRef.current = true
    recRef.current?.stop()
    const history: Msg[] = [...msgs, { role: 'user', text: question, thumb: withPhoto?.thumb }]
    setMsgs([...history, { role: 'assistant', text: '', cards: [], steps: [], working: null, error: null, done: false }])
    setQ(''); setPhoto(null); setHint(null); setBusy(true)
    const ctl = new AbortController(); abortRef.current = ctl
    try {
      const here = hereOn ? await currentPosition().catch(() => null) : null
      const turns = history.filter((m) => m.role === 'user' || m.text).map((m) => ({ role: m.role, content: m.text }))
      if (withPhoto) (turns[turns.length - 1] as { images?: ChatImage[] }).images = [withPhoto.image]
      const r = await fetch('/api/assistant', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ lang, messages: turns, here }),
      })
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error?.message ?? `HTTP ${r.status}`)
      }
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
          if (!line.trim()) continue
          const ev = JSON.parse(line) as AssistantEvent
          if (ev.type === 'text') patchLast((m) => ({ ...m, text: m.text + ev.delta, working: null }))
          else if (ev.type === 'status') patchLast((m) => ({ ...m, working: ev.label, steps: m.steps.includes(ev.label) ? m.steps : [...m.steps, ev.label] }))
          else if (ev.type === 'error') patchLast((m) => ({ ...m, error: ev.message, working: null }))
          else if (ev.type === 'done') { setMode(ev.mode); patchLast((m) => ({ ...m, done: true, working: null })) }
          else patchLast((m) => ({ ...m, cards: [...m.cards, ev], working: null }))
        }
      }
      patchLast((m) => ({ ...m, done: true, working: null }))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patchLast((m) => ({ ...m, error: (e as Error).message, working: null, done: true }))
    } finally { busyRef.current = false; setBusy(false); abortRef.current = null }
  }, [lang, msgs, hereOn])

  const initial = params.get('q')
  useEffect(() => {
    if (!initial || initialSent.current) return
    initialSent.current = true
    void send(initial === 'weather' ? tx({ en: 'What is the weather and the sea like today?', ru: 'Какая сегодня погода и море?', kk: 'Бүгін ауа райы мен теңіз қандай?' }) : initial)
  }, [initial]) // eslint-disable-line react-hooks/exhaustive-deps

  const tool = (on: boolean) => `tap grid size-9 place-items-center rounded-[12px] ${on ? 'bg-blue text-on-blue' : 'text-secondary hover:bg-surface-2 hover:text-text'}`
  const composer = (
    <form onSubmit={(e) => { e.preventDefault(); void send(q, photo) }} className="flex flex-col gap-1 rounded-[22px] bg-surface p-2 card-shadow">
      {photo ? (
        <div className="relative ml-2 mt-1 self-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.thumb} alt={tx({ en: 'Attached photo', ru: 'Прикреплённое фото', kk: 'Тіркелген фото' })} className="size-16 rounded-[12px] object-cover hairline" />
          <button type="button" onClick={() => setPhoto(null)} aria-label={tx({ en: 'Remove photo', ru: 'Убрать фото', kk: 'Фотоны алып тастау' })}
            className="tap absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-text text-bg"><Icon name="x" size={12} /></button>
        </div>
      ) : null}
      <div className="flex items-end gap-2 pl-2">
      <textarea ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} rows={1} maxLength={1200} enterKeyHint="send"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(q, photo) } }}
        placeholder={tx({ en: 'Ask about anything in Aktau', ru: 'Спросите что угодно про Актау', kk: 'Ақтау туралы кез келген сұрақ' })}
        aria-label={tx({ en: 'Your question', ru: 'Ваш вопрос', kk: 'Сұрағыңыз' })}
        className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[15.5px] leading-[1.45] text-text outline-none placeholder:text-faint [field-sizing:content]" />
      {busy ? (
        <button type="button" onClick={() => abortRef.current?.abort()} className="tap grid size-11 flex-none place-items-center rounded-[16px] bg-surface-2 text-text hairline" aria-label={tx({ en: 'Stop', ru: 'Остановить', kk: 'Тоқтату' })}>
          <span className="size-3 rounded-[3px] bg-current" />
        </button>
      ) : (
        <button type="submit" disabled={!q.trim() && !photo} className="tap grid size-11 flex-none place-items-center rounded-[16px] bg-blue text-on-blue disabled:opacity-35" aria-label={tx({ en: 'Send', ru: 'Отправить', kk: 'Жіберу' })}>
          <Icon name="arrow" size={18} className="-rotate-90" />
        </button>
      )}
      </div>
      <div className="flex items-center gap-1 pl-1">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
        <button type="button" onClick={() => fileRef.current?.click()} className={tool(!!photo)} aria-label={tx({ en: 'Attach a photo', ru: 'Прикрепить фото', kk: 'Фото тіркеу' })}><Icon name="camera" size={18} /></button>
        <button type="button" onClick={() => void toggleHere()} aria-pressed={hereOn} className={`tap inline-flex h-9 items-center gap-1.5 rounded-[12px] px-2.5 text-[12.5px] font-semibold ${hereOn ? 'bg-blue text-on-blue' : 'text-secondary hover:bg-surface-2 hover:text-text'}`}>
          <Icon name="pin" size={16} />{hereOn ? tx({ en: 'Using my location', ru: 'Моё местоположение', kk: 'Менің орным' }) : tx({ en: 'Near me', ru: 'Рядом со мной', kk: 'Маған жақын' })}
        </button>
        {canSpeak ? <button type="button" onClick={dictate} aria-pressed={listening} className={`${tool(listening)} ${listening ? 'animate-pulse motion-reduce:animate-none' : ''}`} aria-label={tx({ en: 'Speak', ru: 'Сказать голосом', kk: 'Дауыспен айту' })}><Icon name="mic" size={18} /></button> : null}
        {hint ? <span className="ml-1 truncate t-meta text-red">{hint}</span> : null}
      </div>
    </form>
  )

  if (!msgs.length) {
    return (
      <div className="flex flex-1 flex-col gap-8">
        <div className="rise relative -mx-5 overflow-hidden sm:mx-0 sm:rounded-[28px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PHOTOS.sunset.src} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(8_18_22/0.15),rgb(8_18_22/0.78))]" />
          <div className="relative flex min-h-[240px] flex-col justify-end gap-2 p-6 sm:min-h-[280px] sm:p-8">
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(30px,5vw,44px)] font-semibold leading-[1.02] tracking-[-0.035em] text-white [font-variation-settings:'SHRP'_30]">
              {tx({ en: 'Ask Aktau anything', ru: 'Спросите у Актау', kk: 'Ақтаудан сұраңыз' })}
            </h1>
            <p className="max-w-[44ch] text-[15px] leading-[1.5] text-white/80">
              {tx({ en: 'Places and services, utilities at home, the sea, news and 109. Answers come with where they came from.', ru: 'Места и услуги, свет и вода дома, море, новости и 109. У каждого ответа есть источник.', kk: 'Орындар мен қызметтер, үйдегі жарық пен су, теңіз, жаңалықтар және 109.' })}
            </p>
          </div>
        </div>
        <div className="rise rise-1">{composer}</div>
        <section className="rise rise-2 flex flex-col gap-3">
          <h2 className="t-section text-text">{tx({ en: 'Try asking', ru: 'Попробуйте спросить', kk: 'Сұрап көріңіз' })}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {STARTERS.map((s) => (
              <button key={s.q.en} type="button" onClick={() => (s.photo ? fileRef.current?.click() : void send(tx(s.q)))}
                className="tap group flex min-h-[56px] items-center gap-3 rounded-[16px] bg-surface px-4 text-left hairline hover:bg-surface-2">
                <Icon name={s.icon} size={18} className="text-blue" />
                <span className="flex-1 text-[14.5px] font-[520] text-text">{tx(s.q)}</span>
                <Icon name="arrow" size={15} className="text-faint transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </section>
        <ModeNote mode={mode} admin={me?.role === 'admin'} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between pb-4">
        <h1 className="t-hero text-text">{tx({ en: 'Aktau assistant', ru: 'Помощник Актау', kk: 'Ақтау көмекшісі' })}</h1>
        <button type="button" onClick={() => { abortRef.current?.abort(); setMsgs([]); try { localStorage.removeItem(STORE) } catch { /* ignore */ } inputRef.current?.focus() }}
          className="tap inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-secondary hairline hover:text-text">
          <Icon name="plus" size={15} />{tx({ en: 'New chat', ru: 'Новый чат', kk: 'Жаңа чат' })}
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-7 pb-6" aria-live="polite">
        {msgs.map((m, i) => m.role === 'user'
          ? (
            <div key={i} className="fade-in flex max-w-[85%] flex-col items-end gap-1.5 self-end">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.thumb ? <img src={m.thumb} alt="" className="h-28 rounded-[16px] object-cover hairline" /> : null}
              {m.text ? <div className="rounded-[20px] rounded-br-[6px] bg-text px-4 py-2.5 text-[15px] leading-[1.45] text-bg">{m.text}</div> : null}
            </div>
          )
          : <AssistantTurn key={i} m={m} onRetry={() => { const lastQ = [...msgs.slice(0, i)].reverse().find((x) => x.role === 'user'); if (lastQ) { setMsgs(msgs.slice(0, i - 1)); void send(lastQ.text) } }} />)}
        <div ref={endRef} />
      </div>
      <div className="sticky bottom-[calc(92px+env(safe-area-inset-bottom))] z-10 transition-[bottom] duration-200 has-[textarea:focus]:bottom-[max(12px,env(safe-area-inset-bottom))] lg:bottom-6">{composer}</div>
      <ModeNote mode={mode} admin={me?.role === 'admin'} />
    </div>
  )
}

function ModeNote({ mode, admin }: { mode: AssistantMode | null; admin: boolean }) {
  const { tx } = useApp()
  if (mode !== 'offline') return null
  return (
    <p className="mt-3 t-meta text-faint">
      {tx({ en: 'Basic mode: places and city status answer from Aktau data only.', ru: 'Базовый режим: отвечаю только по данным Aktau о местах и городе.', kk: 'Негізгі режим: тек Aktau деректері бойынша.' })}
      {admin ? ' Set ANTHROPIC_API_KEY or GEMINI_API_KEY on the server to turn on the full assistant.' : ''}
    </p>
  )
}

function AssistantTurn({ m, onRetry }: { m: Extract<Msg, { role: 'assistant' }>; onRetry: () => void }) {
  const { tx } = useApp()
  const text = m.text.trim()
  return (
    <div className="flex gap-3">
      <Logo size={28} className="mt-0.5 flex-none" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {m.steps.length ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {m.steps.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 text-[12.5px] font-[520] text-faint">
                {m.working === s ? <span className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none" /> : <Icon name="check" size={13} className="text-green" />}
                {s}
              </span>
            ))}
          </div>
        ) : !m.done && !text ? <span className="inline-flex items-center gap-2 text-[13px] text-faint"><span className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none" />{tx({ en: 'Thinking', ru: 'Думаю', kk: 'Ойланудамын' })}</span> : null}
        {text ? <Markdown text={text} /> : null}
        {m.cards.map((c, i) => <CardView key={i} c={c} />)}
        {m.error ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[16px] bg-red-soft px-4 py-3">
            <span className="flex-1 t-sub font-semibold text-text">{m.error}</span>
            <button type="button" onClick={onRetry} className="tap t-sub font-bold text-blue">{tx({ en: 'Try again', ru: 'Повторить', kk: 'Қайталау' })}</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Cards ───────────────────────────────────────────────────────────────────
function CardView({ c }: { c: Card }) {
  const { tx } = useApp()
  switch (c.type) {
    case 'places': return c.places.length ? <PlaceStrip places={c.places} /> : null
    case 'answer': return <Answer a={c.answer as AskResponse} />
    case 'action': return (
      <Link href={c.href} className="tap inline-flex h-12 items-center gap-2 self-start rounded-[16px] bg-blue px-5 text-[14.5px] font-bold text-on-blue">
        <Icon name={c.href.startsWith('/map') ? 'map' : c.href === '/weather' ? 'sun' : 'report'} size={18} />{c.label}
      </Link>
    )
    case 'events': return (
      <div className="flex flex-col overflow-hidden rounded-[18px] bg-surface card-shadow">
        {c.events.map((e) => (
          <Link key={e.id} href={`/event/${e.id}`} className="tap flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-surface-2">
            <Icon name="shield" size={17} className="text-blue" />
            <span className="flex min-w-0 flex-1 flex-col"><span className="t-row truncate text-text">{e.title}</span><span className="t-meta text-secondary">{[e.authority, e.when].filter(Boolean).join(', ')}</span></span>
            {e.is_demo ? <span className="rounded-[6px] bg-demo-soft px-1.5 text-[11px] font-bold text-demo">DEMO</span> : null}
            <Icon name="chevron" size={15} className="text-faint" />
          </Link>
        ))}
      </div>
    )
    case 'incidents': return (
      <div className="flex flex-col overflow-hidden rounded-[18px] bg-surface card-shadow">
        {c.incidents.map((x) => (
          <Link key={x.id} href={`/incident/${x.id}`} className="tap flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-surface-2">
            <span className="t-mono text-[11.5px] text-faint">{x.code}</span>
            <span className="flex min-w-0 flex-1 flex-col"><span className="t-row truncate text-text">{x.place || '109'}</span><span className="t-meta text-secondary">{tx({ en: `${x.signal_count} reports`, ru: `обращений: ${x.signal_count}`, kk: `өтініш: ${x.signal_count}` })}</span></span>
            <Icon name="chevron" size={15} className="text-faint" />
          </Link>
        ))}
      </div>
    )
    case 'news': return (
      <div className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto scroll-px-1 px-1 pb-1">
        {c.articles.map((a) => (
          <Link key={a.id} href={`/news?story=${a.id}`} className="tap flex w-[220px] flex-none snap-start flex-col overflow-hidden rounded-[18px] bg-surface card-shadow">
            {a.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.image_url.replace('https://www.lada.kz/uploads/', 'https://www.lada.kz/cache/imagine/340x180/uploads/')} alt="" referrerPolicy="no-referrer" loading="lazy" className="aspect-[17/9] w-full object-cover" />
            ) : null}
            <span className="line-clamp-3 p-3 text-[13.5px] font-[580] leading-[1.35] text-text">{a.headline}</span>
          </Link>
        ))}
      </div>
    )
    case 'sources': return (
      <div className="flex flex-col gap-1.5">
        <span className="t-meta text-faint">{tx({ en: 'From the web', ru: 'Из интернета', kk: 'Интернеттен' })}</span>
        {c.sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center gap-2 t-sub text-blue hover:underline">
            <Icon name="external" size={13} /><span className="truncate">{s.title || new URL(s.url).host}</span>
          </a>
        ))}
      </div>
    )
  }
}

const KIND: Record<string, L3> = {
  'shop=optician': { en: 'Optician', ru: 'Оптика', kk: 'Оптика' }, 'amenity=pharmacy': { en: 'Pharmacy', ru: 'Аптека', kk: 'Дәріхана' },
  'amenity=dentist': { en: 'Dentist', ru: 'Стоматология', kk: 'Стоматология' }, 'amenity=bank': { en: 'Bank', ru: 'Банк', kk: 'Банк' },
  'amenity=atm': { en: 'ATM', ru: 'Банкомат', kk: 'Банкомат' }, 'amenity=fuel': { en: 'Fuel', ru: 'АЗС', kk: 'ЖҚС' },
  'amenity=cafe': { en: 'Cafe', ru: 'Кафе', kk: 'Кафе' }, 'amenity=restaurant': { en: 'Restaurant', ru: 'Ресторан', kk: 'Мейрамхана' },
  'amenity=clinic': { en: 'Clinic', ru: 'Клиника', kk: 'Клиника' }, 'amenity=hospital': { en: 'Hospital', ru: 'Больница', kk: 'Аурухана' },
  'shop=mobile_phone': { en: 'Phones', ru: 'Телефоны', kk: 'Телефондар' }, 'shop=supermarket': { en: 'Supermarket', ru: 'Супермаркет', kk: 'Супермаркет' },
  'shop=hairdresser': { en: 'Hairdresser', ru: 'Парикмахерская', kk: 'Шаштараз' }, 'shop=car_repair': { en: 'Car repair', ru: 'Автосервис', kk: 'Автосервис' },
  'shop=shoes': { en: 'Shoes', ru: 'Обувь', kk: 'Аяқ киім' }, 'craft=shoemaker': { en: 'Shoe repair', ru: 'Ремонт обуви', kk: 'Аяқ киім жөндеу' },
  'shop=watches': { en: 'Watches', ru: 'Часы', kk: 'Сағат' }, 'tourism=hotel': { en: 'Hotel', ru: 'Гостиница', kk: 'Қонақ үй' },
}

function PlaceStrip({ places }: { places: PlaceCard[] }) {
  return (
    <div className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto scroll-px-1 px-1 pb-1">
      {places.map((p) => <PlaceTile key={p.id} p={p} />)}
    </div>
  )
}

function PlaceTile({ p }: { p: PlaceCard }) {
  const { lang, tx } = useApp()
  const kind = KIND[p.kind] ? tx(KIND[p.kind]!) : p.kind.split('=').pop()!.replace(/_/g, ' ')
  const dist = p.distance_m == null ? null : p.distance_m < 1000 ? `${p.distance_m} ${lang === 'en' ? 'm' : 'м'}` : `${(p.distance_m / 1000).toFixed(1)} ${lang === 'en' ? 'km' : 'км'}`
  const where = [p.designator ? `${p.designator} ${lang === 'en' ? 'mkr' : 'мкр'}` : null, p.address].filter(Boolean).join(', ')
  const phone = p.phone?.split(/[;,]/)[0]?.trim()
  return (
    <article className="flex w-[272px] flex-none snap-start flex-col gap-3 rounded-[20px] bg-surface p-4 card-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[12.5px] font-[560] text-secondary">{kind}</span>
          <h3 className="truncate text-[16px] font-[650] tracking-[-0.01em] text-text">{p.name}</h3>
        </div>
        {dist ? <span className="t-num flex-none text-[15px] text-text">{dist}</span> : null}
      </div>
      <div className="flex flex-col gap-1 text-[13px] text-secondary">
        {where ? <span className="truncate">{where}</span> : null}
        {p.open_now === true ? <span className="font-[600] text-green">{tx({ en: 'Open now', ru: 'Сейчас открыто', kk: 'Қазір ашық' })}</span>
          : p.open_now === false ? <span className="font-[600] text-red">{tx({ en: 'Closed now', ru: 'Сейчас закрыто', kk: 'Қазір жабық' })}</span>
          : <span className="text-faint">{p.opening_hours ?? tx({ en: 'Hours unknown', ru: 'Часы работы не указаны', kk: 'Жұмыс уақыты белгісіз' })}</span>}
      </div>
      <div className="mt-auto flex gap-2">
        {phone ? <Action href={`tel:${phone.replace(/[^\d+]/g, '')}`} icon="phone">{tx({ en: 'Call', ru: 'Позвонить', kk: 'Қоңырау' })}</Action> : null}
        <Action href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`} icon="route" external>{tx({ en: 'Route', ru: 'Маршрут', kk: 'Бағыт' })}</Action>
      </div>
      <span className="flex items-center gap-3 text-[12px] text-faint">
        <span className="flex-1">{p.source}</span>
        <a href={`https://2gis.kz/aktau/search/${encodeURIComponent(p.name)}`} target="_blank" rel="noopener noreferrer" className="font-[600] text-blue hover:underline">2GIS</a>
        {p.website ? <a href={p.website} target="_blank" rel="noopener noreferrer" className="font-[600] text-blue hover:underline">{tx({ en: 'Website', ru: 'Сайт', kk: 'Сайт' })}</a> : null}
      </span>
    </article>
  )
}

function Action({ href, icon, children, external }: { href: string; icon: IconName; children: ReactNode; external?: boolean }) {
  return (
    <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="tap inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-soft text-[13px] font-[650] text-blue-strong hover:brightness-95">
      <Icon name={icon} size={14} />{children}
    </a>
  )
}

// ── A tiny, safe markdown subset: paragraphs, lists, **bold**, links ───────────
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/)
  return (
    <div className="flex flex-col gap-2.5 text-[15.5px] leading-[1.55] text-text [text-wrap:pretty]">
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim())
        if (lines.length && lines.every((l) => /^\s*([-•*]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]!)
          const List = ordered ? 'ol' : 'ul'
          return <List key={i} className={`flex flex-col gap-1.5 pl-5 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-faint`}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-•*]|\d+[.)])\s+/, ''))}</li>)}</List>
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j ? <br /> : null}{inline(l)}</span>)}</p>
      })}
    </div>
  )
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    if (m[1]) out.push(<strong key={k++} className="font-[650]">{m[1]}</strong>)
    else if (m[2]) out.push(<a key={k++} href={m[3]} target="_blank" rel="noopener noreferrer" className="text-blue underline decoration-[1.5px] underline-offset-2">{m[2]}</a>)
    else if (m[4]) out.push(<a key={k++} href={m[4]} target="_blank" rel="noopener noreferrer" className="break-all text-blue underline underline-offset-2">{new URL(m[4]).host}</a>)
    last = re.lastIndex
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
