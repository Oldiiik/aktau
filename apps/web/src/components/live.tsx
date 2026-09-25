'use client'
// Live demo session: the same incident pipeline, with a QR audience as the
// affected residents of one place.
//   LiveAudience   a phone that scanned the code: no sign-up, no GPS. It waits
//                  for city signals, asks "does this affect you too?", shows
//                  the team, the deadline and the work live, then asks "is it fixed?"
//   LivePresenter  the projector: QR code, how many are connected, the live
//                  count of confirmations, the operator steps (the same API as
//                  109 Copilot), the residents' verification and the final tally
// Every screen refetches canonical state from the database; realtime events
// only say when.
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fmtTime } from '@aktau/normalization/time'
import type { SessionStateDTO } from '@aktau/server'
import { plural } from '@/lib/plural'
import { useApp, useLinkState, useRealtime, type RealtimeEvent } from './app'
import { Badge, Beacon, Button, Icon, Logo } from './primitives'
import { ConfirmButtons, Pipeline, SERVICE_ICON, STATUS, VerifyButtons, etaLine, incidentHeading, residentsText, timelineText } from './incident-ui'

type Current = NonNullable<SessionStateDTO['current']>

function useSession(initial: SessionStateDTO) {
  const [s, setS] = useState(initial)
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/live/${initial.session.code}`, { cache: 'no-store' })
      if (r.ok) setS(await r.json())
    } catch { /* keep the last state */ }
  }, [initial.session.code])
  const mine = (e: RealtimeEvent) => e.session === initial.session.id || e.id === initial.session.id
  useRealtime(() => void load(), ['incidents'], { wait: 150, filter: mine })
  // A slow safety net: canonical state every 20 s even if an event is lost.
  useEffect(() => { const t = setInterval(() => void load(), 20_000); return () => clearInterval(t) }, [load])
  return { s, load }
}

/** A number that ticks to its new value, so a room can watch it grow. */
function Count({ n, className = '' }: { n: number; className?: string }) {
  const [shown, setShown] = useState(n)
  const [bump, setBump] = useState(false)
  const prev = useRef(n)
  useEffect(() => {
    if (n === prev.current) return
    const from = prev.current
    prev.current = n
    setBump(true)
    const reduce = typeof window !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || Math.abs(n - from) > 40) { setShown(n); setTimeout(() => setBump(false), 300); return }
    let k = from
    const step = n > from ? 1 : -1
    const t = setInterval(() => { k += step; setShown(k); if (k === n) { clearInterval(t); setTimeout(() => setBump(false), 250) } }, 60)
    return () => clearInterval(t)
  }, [n])
  return <span className={`inline-block transition-transform duration-200 ${bump ? 'scale-110' : ''} ${className}`}>{shown}</span>
}

// ── The phone ────────────────────────────────────────────────────────────────
export function LiveAudience({ initial }: { initial: SessionStateDTO }) {
  const { lang, tx } = useApp()
  const { s, load } = useSession(initial)
  const link = useLinkState()
  const cur = s.current
  const ended = s.session.status !== 'active'
  // Joined by the page itself; if the cookie arrived late, join now.
  useEffect(() => { if (!initial.member && !ended) void fetch(`/api/live/${initial.session.code}`, { method: 'POST' }).then(() => load()) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-5 bg-bg px-4 pb-10 pt-[max(20px,env(safe-area-inset-top))]">
      <header className="flex items-center gap-3">
        <Logo size={36} />
        <div className="flex min-w-0 flex-col">
          <span className="font-[family-name:var(--font-display)] text-[19px] font-semibold leading-none tracking-[-0.03em] text-text">Aktau</span>
          <span className="t-meta truncate text-secondary">{s.session.title}</span>
        </div>
        <span className="flex-1" />
        <Badge tone="demo">DEMO</Badge>
      </header>

      <section className="rise flex flex-col gap-2 rounded-[24px] bg-surface p-5 card-shadow">
        <span className="flex items-center gap-2 t-label text-secondary"><Beacon tone={ended ? 'secondary' : link === 'reconnecting' ? 'amber' : 'green'} live={!ended && link === 'live'} />{s.session.venue}</span>
        <p className="t-hero !text-[21px] text-text">{ended ? tx({ en: 'This session has ended.', ru: 'Сессия завершена.', kk: 'Сессия аяқталды.' }) : tx({ en: 'You are connected to this location.', ru: 'Вы подключены к текущей локации.', kk: 'Сіз осы орынға қосылдыңыз.' })}</p>
        {!cur && !ended ? <p className="t-sub text-secondary">{tx({ en: 'Waiting for city signals…', ru: 'Ожидаем городские сигналы…', kk: 'Қала сигналдарын күтудеміз…' })}</p> : null}
        <p className="t-meta text-faint">{tx({ en: 'No sign-up and no GPS: the QR code is your location.', ru: 'Без регистрации и GPS: QR-код и есть ваша локация.', kk: 'Тіркелусіз және GPS-сіз: QR-код — сіздің орныңыз.' })} · {s.members} {plural(lang, s.members, { en: ['connected', 'connected'], ru: ['подключён', 'подключены', 'подключено'], kk: 'қосылды' })}</p>
      </section>

      {cur ? <AudienceIncident key={cur.id} i={cur} live={s.live} onChange={() => void load()} /> : null}

      <p className="mt-auto px-1 t-meta text-faint">{tx({ en: 'A live demo of Aktau: the same pipeline the city uses, stored as demo data.', ru: 'Живое демо Aktau: тот же конвейер, что и для города, данные помечены как демо.', kk: 'Aktau тірі демосы: қаладағыдай конвейер, деректер демо ретінде белгіленген.' })}</p>
    </div>
  )
}

function AudienceIncident({ i, live, onChange }: { i: Current; live: SessionStateDTO['live']; onChange: () => void }) {
  const { lang, tx } = useApp()
  const st = STATUS[i.status] ?? STATUS.NEW!
  const title = incidentHeading(lang, i)
  const eta = ['ROUTED', 'ACCEPTED', 'IN_PROGRESS'].includes(i.status) ? etaLine(lang, i.commit_finish_at) : null
  const last = live?.timeline.filter((x) => ['routed', 'accepted', 'deadline_set', 'deadline_changed', 'dispatched', 'completed', 'verified', 'disputed', 'resolved', 'reopened'].includes(x.kind)).slice(-1)[0]
  if (i.ask === 'confirm') return (
    <section className="sheet-in flex flex-col gap-4 rounded-[26px] bg-surface p-5 card-shadow beam-edge">
      <span className="t-label text-blue">{tx({ en: 'New problem here', ru: 'Новая проблема здесь', kk: 'Мұнда жаңа мәселе' })}</span>
      <div className="flex items-start gap-3">
        <span className="grid size-12 flex-none place-items-center rounded-[15px] bg-surface-2 text-text hairline"><Icon name={SERVICE_ICON[i.service]} size={22} /></span>
        <h1 className="t-headline !text-[22px] text-text">{title}</h1>
      </div>
      <p className="t-card text-text">{tx({ en: 'Did you run into it too?', ru: 'Вы тоже столкнулись?', kk: 'Сіз де тап болдыңыз ба?' })}</p>
      <ConfirmButtons id={i.id} onDone={onChange} yes={{ en: 'Yes, I confirm', ru: 'Да, подтверждаю', kk: 'Иә, растаймын' }} no={{ en: 'No', ru: 'Нет', kk: 'Жоқ' }} />
      {i.confirm_count ? <p className="t-meta text-faint">{residentsText(lang, i.confirm_count)}</p> : null}
    </section>
  )
  if (i.ask === 'verify') return (
    <section className="sheet-in flex flex-col gap-4 rounded-[26px] bg-green-soft p-5 card-shadow">
      <span className="t-label text-green">{tx({ en: 'Your check is needed', ru: 'Нужна ваша проверка', kk: 'Тексеруіңіз керек' })}</span>
      <h1 className="t-headline !text-[21px] text-text">{tx({ en: 'The team reports the problem is solved. Confirm?', ru: 'Исполнитель сообщил, что проблема решена. Подтвердить?', kk: 'Орындаушы мәселе шешілді деді. Растайсыз ба?' })}</h1>
      <p className="t-sub text-secondary">{title}</p>
      {i.completion_note ? <p className="rounded-[14px] bg-surface p-3 t-sub text-text hairline">{i.completion_note}</p> : null}
      <VerifyButtons id={i.id} onDone={onChange} />
    </section>
  )
  const done = i.status === 'VERIFIED' || i.status === 'RESOLVED'
  return (
    <section className={`fade-in flex flex-col gap-4 rounded-[26px] p-5 card-shadow ${done ? 'bg-green-soft' : i.status === 'DISPUTED' ? 'bg-red-soft' : 'bg-surface'}`}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={st.tone} dot>{tx(st.label)}</Badge>
        <span className="t-meta text-secondary">{residentsText(lang, i.confirm_count)}</span>
      </div>
      <h1 className="t-headline !text-[21px] text-text">{title}</h1>
      <Pipeline status={i.status} />
      {last ? <p className="flex items-start gap-2 t-card text-text"><Icon name="bell" size={17} className="mt-0.5 flex-none text-blue" />{timelineText(lang, last)}</p> : null}
      {i.team && !done ? <p className="t-sub text-secondary">{tx({ en: 'Responsible', ru: 'Исполнитель', kk: 'Орындаушы' })}: {i.team}</p> : null}
      {eta ? <p className="t-card text-text" suppressHydrationWarning>{eta}</p> : null}
      {done && i.verify_pct != null ? <p className="t-card text-text">{i.verify_pct}% {tx({ en: 'of residents confirmed it is fixed', ru: 'жителей подтвердили устранение', kk: 'тұрғын шешілгенін растады' })}</p> : null}
      {i.relation === 'confirmed' && !done ? <p className="flex items-center gap-1.5 t-meta text-green"><Icon name="check" size={14} />{tx({ en: 'You confirmed it; you will be asked when it is fixed.', ru: 'Вы подтвердили; когда проблему решат, вас спросят.', kk: 'Сіз растадыңыз.' })}</p> : null}
      {i.my_answer ? <p className="flex items-center gap-1.5 t-meta text-secondary"><Icon name="check" size={14} />{tx({ en: 'Your answer is counted.', ru: 'Ваш ответ учтён.', kk: 'Жауабыңыз есептелді.' })}</p> : null}
      <Link href={`/incident/${i.code}`} className="tap self-start t-meta font-bold text-blue">{tx({ en: 'Full history', ru: 'Вся история', kk: 'Толық тарих' })} →</Link>
    </section>
  )
}

// ── The projector ────────────────────────────────────────────────────────────
export function LivePresenter({ initial, joinUrl, qr }: { initial: SessionStateDTO; joinUrl: string; qr: string }) {
  const { tx } = useApp()
  const { s, load } = useSession(initial)
  const cur = s.current
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="flex flex-wrap items-center gap-4 border-b border-line px-6 py-4">
        <Logo size={34} />
        <div className="flex min-w-0 flex-col">
          <span className="t-label text-faint">{tx({ en: 'Live demo session', ru: 'Живая демо-сессия', kk: 'Тірі демо-сессия' })} · {s.session.code}</span>
          <h1 className="font-[family-name:var(--font-display)] text-[22px] font-semibold leading-tight tracking-[-0.03em]">{s.session.title} · {s.session.venue}</h1>
        </div>
        <span className="flex-1" />
        <Link href={cur ? `/copilot?incident=${cur.code}` : '/copilot'} className="tap inline-flex h-10 items-center gap-2 rounded-full bg-surface px-4 text-[13px] font-bold text-text hairline"><Icon name="radar" size={16} className="text-blue" />109 Copilot</Link>
        <Badge tone="demo">DEMO</Badge>
      </header>
      <div className="grid flex-1 gap-6 p-6 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <aside className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-4 rounded-[28px] bg-surface p-6 card-shadow">
            <div className="w-full max-w-[300px] overflow-hidden rounded-[18px] bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="t-mono break-all text-center text-[13px] text-secondary">{joinUrl.replace(/^https?:\/\//, '')}</p>
            <p className="text-center t-sub text-secondary">{tx({ en: 'Scan to join. No sign-up, no GPS: this code is the location.', ru: 'Отсканируйте, чтобы подключиться. Без регистрации и GPS: код и есть локация.', kk: 'Қосылу үшін сканерлеңіз.' })}</p>
          </div>
          <div className="flex items-end justify-between rounded-[22px] bg-surface p-5 card-shadow">
            <span className="flex flex-col"><span className="t-label text-faint">{tx({ en: 'Connected', ru: 'Подключено', kk: 'Қосылды' })}</span><span className="t-num text-[48px] font-semibold leading-none"><Count n={s.members} /></span></span>
            <Icon name="people" size={28} className="text-blue" />
          </div>
          <SessionControls code={s.session.code} active={s.session.status === 'active'} onChange={() => void load()} />
        </aside>
        <main className="flex min-w-0 flex-col gap-5">
          {cur ? <PresenterIncident key={cur.id} i={cur} live={s.live!} onChange={() => void load()} /> : <PresenterCompose sessionId={s.session.id} code={s.session.code} onDone={() => void load()} disabled={s.session.status !== 'active'} />}
        </main>
      </div>
    </div>
  )
}

function PresenterCompose({ sessionId, code, onDone, disabled }: { sessionId: string; code: string; onDone: () => void; disabled: boolean }) {
  const { tx } = useApp()
  const [text, setText] = useState('Wi-Fi в зале работает нестабильно')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <section className="flex flex-col gap-4 rounded-[28px] bg-surface p-6 card-shadow">
      <span className="flex items-center gap-2 t-label text-secondary"><Beacon tone="green" live />{tx({ en: 'Waiting for city signals', ru: 'Ожидаем городские сигналы', kk: 'Қала сигналдарын күтудеміз' })}</span>
      <h2 className="t-title">{tx({ en: 'Report one harmless problem at the venue', ru: 'Сообщите об одной безобидной проблеме в зале', kk: 'Залдағы бір қарапайым мәселе туралы хабарлаңыз' })}</h2>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={300} className="w-full resize-none rounded-[16px] bg-bg p-4 text-[20px] font-semibold text-text outline-none hairline" />
      <div className="flex flex-wrap gap-2">
        <Button full={false} disabled={busy || disabled || text.trim().length < 5} onClick={async () => {
          setBusy(true); setErr(null)
          try {
            const r = await fetch('/api/incidents/signals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text.trim(), session_id: sessionId }) })
            const d = await r.json()
            if (!r.ok) throw new Error(d.error?.message ?? 'Failed')
            onDone()
          } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
        }}><Icon name="send" size={18} />{tx({ en: 'Publish to everyone connected', ru: 'Опубликовать для всех подключённых', kk: 'Барлығына жариялау' })}</Button>
        <Link href={`/report?session=${code}`} className="tap inline-flex h-[50px] items-center gap-2 rounded-[16px] px-5 text-[15px] font-bold text-blue hairline">{tx({ en: 'Use the Report screen', ru: 'Через экран «Сообщить»', kk: '«Хабарлау» экраны арқылы' })}</Link>
      </div>
      {err ? <p className="t-sub text-red">{err}</p> : null}
      <p className="t-meta text-faint">{tx({ en: 'It goes through the normal report pipeline, with this session as the location.', ru: 'Проходит через обычный конвейер обращений; локация — эта сессия.', kk: 'Қалыпты өтініш конвейері арқылы өтеді.' })}</p>
    </section>
  )
}

const DEMO_NOTE = 'Точка доступа перезагружена, канал Wi-Fi переключён на свободный'

function PresenterIncident({ i, live, onChange }: { i: Current; live: NonNullable<SessionStateDTO['live']>; onChange: () => void }) {
  const { lang, tx } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const act = async (body: unknown) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/ops/incidents/${i.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error?.message ?? 'Failed')
      onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const st = STATUS[i.status] ?? STATUS.NEW!
  const n = i.verify_yes + i.verify_partial + i.verify_no
  const done = i.status === 'VERIFIED' || i.status === 'RESOLVED'
  const feed = live.timeline.slice(-6).reverse()
  return (
    <>
      <section className="flex flex-col gap-5 rounded-[28px] bg-surface p-6 card-shadow">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={st.tone} dot>{tx(st.label)}</Badge><span className="t-mono text-[12px] text-faint">{i.code}</span></div>
        <h2 className="t-title !text-[30px]">{incidentHeading(lang, i)}</h2>
        <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-end">
          <div className="flex flex-col">
            <span className="t-num text-[120px] font-semibold leading-[0.85] text-blue"><Count n={i.confirm_count} /></span>
            <span className="t-card text-secondary">{plural(lang, i.confirm_count, { en: ['confirmation', 'confirmations'], ru: ['подтверждение', 'подтверждения', 'подтверждений'], kk: 'растау' })}</span>
          </div>
          <p className="t-hero !text-[22px] text-text">
            <Count n={live.resident_signals} /> {plural(lang, live.resident_signals, { en: ['resident signal', 'resident signals'], ru: ['сигнал жителей', 'сигнала жителей', 'сигналов жителей'], kk: 'тұрғын сигналы' })} → 1 {tx({ en: 'city incident', ru: 'городская проблема', kk: 'қала мәселесі' })}
          </p>
        </div>
        <Pipeline status={i.status} />
        {!done ? (
          <div className="flex flex-wrap gap-2">
            {i.status === 'NEW' ? <Button full={false} disabled={busy} onClick={() => void act({ action: 'route', team: 'Demo IT Team' })}><Icon name="send" size={17} />{tx({ en: 'Assign → Demo IT Team', ru: 'Назначить → Demo IT Team', kk: 'Тағайындау → Demo IT Team' })}</Button> : null}
            {['ROUTED', 'ACCEPTED', 'IN_PROGRESS'].includes(i.status) && !i.commit_finish_at ? <Button full={false} disabled={busy} onClick={() => void act({ action: 'commit', finish_at: new Date(Date.now() + 10 * 60_000).toISOString() })}><Icon name="timer" size={17} />{tx({ en: 'ETA → 10 minutes', ru: 'Срок → 10 минут', kk: 'Мерзім → 10 минут' })}</Button> : null}
            {['ROUTED', 'ACCEPTED'].includes(i.status) ? <Button full={false} style="secondary" disabled={busy} onClick={() => void act({ action: 'dispatch', message: 'Work started' })}><Icon name="bus" size={17} />{tx({ en: 'Start work', ru: 'Работы начались', kk: 'Жұмыс басталды' })}</Button> : null}
            {['ROUTED', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED'].includes(i.status) ? <Button full={false} style="secondary" disabled={busy} onClick={() => void act({ action: 'complete', note: DEMO_NOTE })}><Icon name="check" size={17} />{tx({ en: 'Submit completion', ru: 'Сообщить о выполнении', kk: 'Орындалғанын хабарлау' })}</Button> : null}
            {i.status === 'EVIDENCE_SUBMITTED' ? <Button full={false} style="outline" disabled={busy} onClick={() => void act({ action: 'resolve', force: true, reason: tx({ en: 'Closed by the presenter', ru: 'Закрыто ведущим', kk: 'Жүргізуші жапты' }) })}>{tx({ en: 'Close without waiting', ru: 'Закрыть, не дожидаясь', kk: 'Күтпей жабу' })}</Button> : null}
          </div>
        ) : null}
        {err ? <p className="t-sub text-red">{err}</p> : null}
        {i.team || i.commit_finish_at ? <p className="t-sub text-secondary" suppressHydrationWarning>{[i.team ? `${tx({ en: 'Responsible', ru: 'Исполнитель', kk: 'Орындаушы' })}: ${i.team}` : null, !done ? etaLine(lang, i.commit_finish_at) : null].filter(Boolean).join(' · ')}</p> : null}
      </section>

      {i.verify_round > 0 ? (
        <section className={`flex flex-col gap-4 rounded-[28px] p-6 card-shadow ${done ? 'bg-green-soft' : i.status === 'DISPUTED' ? 'bg-red-soft' : 'bg-surface'}`}>
          <span className="t-label text-secondary">{tx({ en: 'Residents’ verification', ru: 'Проверка жителями', kk: 'Тұрғындар тексеруі' })}</span>
          <div className="grid grid-cols-4 gap-3">
            {[[n, tx({ en: 'answers', ru: 'ответов', kk: 'жауап' }), 'text-text'], [i.verify_yes, tx({ en: 'yes', ru: 'да', kk: 'иә' }), 'text-green'], [i.verify_partial, tx({ en: 'partly', ru: 'частично', kk: 'ішінара' }), 'text-amber'], [i.verify_no, tx({ en: 'no', ru: 'нет', kk: 'жоқ' }), 'text-red']].map(([v, l, c]) => (
              <div key={String(l)} className="flex flex-col rounded-[18px] bg-surface p-4 hairline"><span className={`t-num text-[44px] font-semibold leading-none ${c}`}><Count n={Number(v)} /></span><span className="t-sub text-secondary">{l}</span></div>
            ))}
          </div>
          {n ? <div className="flex h-3 overflow-hidden rounded-full bg-line" aria-hidden><span className="bg-green transition-[width] duration-700" style={{ width: `${(i.verify_yes / n) * 100}%` }} /><span className="bg-amber transition-[width] duration-700" style={{ width: `${(i.verify_partial / n) * 100}%` }} /><span className="bg-red transition-[width] duration-700" style={{ width: `${(i.verify_no / n) * 100}%` }} /></div> : null}
          <p className="t-hero !text-[24px]">{n ? `${i.verify_pct}% ${tx({ en: 'confirmed it is fixed', ru: 'подтвердили устранение', kk: 'шешілгенін растады' })}` : tx({ en: 'Waiting for the residents who confirmed it', ru: 'Ждём ответов подтвердивших жителей', kk: 'Растаған тұрғындардың жауабын күтудеміз' })}</p>
          {!done && n ? <p className="t-sub text-secondary">{tx({ en: `Closes when ${live.quorum} of ${live.eligible} answer and 60% say “yes, fully”.`, ru: `Закроется, когда ответят ${live.quorum} из ${live.eligible} и 60% скажут «да, полностью».`, kk: `${live.eligible}-дан ${live.quorum} жауап беріп, 60% «иә» десе жабылады.` })}</p> : null}
        </section>
      ) : null}

      {done ? (
        <section className="sheet-in flex flex-col gap-4 rounded-[28px] bg-surface p-7 card-shadow beam-edge">
          <span className="font-[family-name:var(--font-display)] text-[44px] font-bold leading-none tracking-[-0.03em] text-green">{tx({ en: 'RESOLVED', ru: 'РЕШЕНО', kk: 'ШЕШІЛДІ' })}</span>
          <ul className="grid gap-3 sm:grid-cols-2">
            <Tally n={live.participants} l={plural(lang, live.participants, { en: ['resident took part', 'residents took part'], ru: ['житель участвовал', 'жителя участвовали', 'жителей участвовали'], kk: 'тұрғын қатысты' })} />
            <Tally n={live.resident_signals} l={plural(lang, live.resident_signals, { en: ['resident signal', 'resident signals'], ru: ['сигнал жителей', 'сигнала жителей', 'сигналов жителей'], kk: 'тұрғын сигналы' })} />
            <Tally n={1} l={tx({ en: 'shared city incident', ru: 'общая городская проблема', kk: 'ортақ қала мәселесі' })} />
            <Tally n={1} l={i.status === 'VERIFIED' ? tx({ en: `responsible team · result verified by residents (${i.verify_pct}%)`, ru: `ответственная команда · результат проверен жителями (${i.verify_pct}%)`, kk: `жауапты команда · нәтижені тұрғындар растады (${i.verify_pct}%)` }) : tx({ en: 'responsible team', ru: 'ответственная команда', kk: 'жауапты команда' })} />
          </ul>
          <p className="t-sub text-secondary">{tx({ en: `${live.resident_signals} resident signals consolidated into 1 actionable incident.`, ru: `${live.resident_signals} ${plural('ru', live.resident_signals, { en: ['', ''], ru: ['сигнал жителей объединён', 'сигнала жителей объединены', 'сигналов жителей объединены'], kk: '' })} в 1 городскую проблему, с которой можно работать.`, kk: `${live.resident_signals} тұрғын сигналы 1 мәселеге біріктірілді.` })}</p>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 rounded-[24px] bg-surface p-5 card-shadow">
        <span className="t-label text-faint">{tx({ en: 'Live timeline', ru: 'Хронология', kk: 'Хронология' })}</span>
        {feed.map((x) => <p key={x.id} className="flex gap-3 t-sub text-text"><span className="t-mono w-12 flex-none text-faint" suppressHydrationWarning>{fmtTime(new Date(x.created_at))}</span>{timelineText(lang, x)}</p>)}
      </section>
    </>
  )
}

function Tally({ n, l }: { n: number; l: string }) {
  return <li className="flex items-baseline gap-3 rounded-[18px] bg-bg p-4 hairline"><span className="t-num text-[40px] font-semibold leading-none"><Count n={n} /></span><span className="t-card text-secondary">{l}</span></li>
}

function SessionControls({ code, active, onChange }: { code: string; active: boolean; onChange: () => void }) {
  const { tx } = useApp()
  const [busy, setBusy] = useState(false)
  if (!active) return <p className="t-sub text-secondary">{tx({ en: 'This session has ended.', ru: 'Сессия завершена.', kk: 'Сессия аяқталды.' })}</p>
  return (
    <Button style="outline" size="sm" disabled={busy} onClick={async () => {
      if (!confirm(tx({ en: 'End this session? Phones stop receiving new problems.', ru: 'Завершить сессию? Телефоны перестанут получать новые проблемы.', kk: 'Сессияны аяқтау керек пе?' }))) return
      setBusy(true)
      try { await fetch(`/api/ops/live/${code}`, { method: 'PATCH' }); onChange() } finally { setBusy(false) }
    }}>{tx({ en: 'End session', ru: 'Завершить сессию', kk: 'Сессияны аяқтау' })}</Button>
  )
}
