'use client'
// 109 Copilot — Aktau's workspace for 109 operators (and admins). It lives
// inside the app shell like any other section; thinks in incidents, not tickets.
//   left   incoming signals (every channel) + one row per incident: the
//          aggregate (residents, affected area, priority), never the duplicates
//   centre the selected signal (AI intake → match → route) or the incident's
//          whole loop: assign → the team commits → work → completion → residents verify
//   right  SLA guardian, analytics from real incidents, call QA, demo and live sessions
// The copilot proposes; every action here is a human decision, audited.
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ago } from '@aktau/i18n'
import { checkResponse, type EvidencePhoto } from '@aktau/city-core/incidents'
import { fmtTime } from '@aktau/normalization/time'
import type { IncidentDetailDTO, IncidentDTO, SignalPreview } from '@aktau/server'
import { ROLE_LABEL, useApp, useRealtime } from './app'
import { Badge, Button, CopilotTag, Icon, Meter, type IconName } from './primitives'
import {
  CHANNEL, CHECK, Pipeline, PriorityChip, REASON, SERVICE_ICON, SOURCE, STATUS, SlaChip, duration, etaLine, incidentHeading, incidentName, placeText,
  priorityWhy, residentsText, scopeText, sourceLabel, timelineText, whereText,
} from './incident-ui'
import { Proof, Responsibility } from './incident'
import { plural } from '@/lib/plural'

type Pending = { id: string; channel: string; raw_text: string; lang: string; created_at: string; is_demo: boolean; preview: SignalPreview }
type Analytics = {
  days: number; active: number; overdue: number; response_min: number | null; resolution_h: number | null; closed: number; verified: number; reopened: number
  recurring: number; first_time: number; residents: number; merged: number; verified_rate: number | null; first_time_fix_rate: number | null
}
type Stats = {
  signals_today: number; signals_attached_today: number; confirmations_today: number; incidents_open: number; incidents_new: number; resolved_7d: number; verified_7d: number
  disputed_open: number; avg_accept_min: number | null; phone_calls: number; intervention: number; merge_ratio: number; call_qa: { total: number; review: number }; analytics: Analytics
}
type State = { stats: Stats; incidents: IncidentDTO[]; pending: Pending[] }
type Sel = { kind: 'signal'; id: string } | { kind: 'incident'; id: string } | { kind: 'compose' } | null
type Filter = 'all' | 'overdue' | 'reopened' | 'impact'

async function api<T = unknown>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error?.message ?? `HTTP ${r.status}`)
  return d as T
}

const FILTERS: Array<{ key: Filter; label: { en: string; ru: string; kk: string }; test: (i: IncidentDTO) => boolean }> = [
  { key: 'all', label: { en: 'All', ru: 'Все', kk: 'Барлығы' }, test: () => true },
  { key: 'overdue', label: { en: 'Overdue', ru: 'Просрочено', kk: 'Кешіккен' }, test: (i) => i.sla.level === 'breached' },
  { key: 'reopened', label: { en: 'Reopened', ru: 'Повторно открыто', kk: 'Қайта ашылған' }, test: (i) => i.reopen_count > 0 || i.status === 'DISPUTED' },
  { key: 'impact', label: { en: 'High impact', ru: 'Высокое влияние', kk: 'Үлкен әсер' }, test: (i) => i.priority === 'CRITICAL' || i.priority === 'HIGH' || i.residents >= 10 },
]

export function OpsConsole({ initial, demo, embed = false, focus = null }: { initial: State; demo: boolean; embed?: boolean; focus?: string | null }) {
  const { lang, tx, me } = useApp()
  const [s, setS] = useState(initial)
  const [sel, setSel] = useState<Sel>(() => {
    const f = focus ? initial.incidents.find((i) => i.id === focus || i.code === focus.toUpperCase()) : null
    return f ? { kind: 'incident', id: f.id } : initial.pending[0] ? { kind: 'signal', id: initial.pending[0].id } : initial.incidents[0] ? { kind: 'incident', id: initial.incidents[0].id } : null
  })
  const [filter, setFilter] = useState<Filter>('all')
  const [flash, setFlash] = useState<string | null>(null)
  const refresh = useCallback(async () => { try { setS(await api<State>('/api/ops/state')) } catch { /* keep */ } }, [])
  // Bursts of confirmations coalesce into one refresh.
  useRealtime(() => void refresh(), ['incidents'], { wait: 400 })
  const toast = (m: string) => { setFlash(m); setTimeout(() => setFlash(null), 2600) }
  // Phones stack the queue above the desk: bring the desk into view on selection.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (window.innerWidth < 1024) document.getElementById('copilot-desk')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [sel])

  const guardian = useMemo(() => s.incidents.filter((i) => i.sla.level === 'at_risk' || i.sla.level === 'breached' || i.priority === 'CRITICAL' && i.status === 'NEW')
    .sort((a, b) => (a.sla.minutes_left ?? 1e9) - (b.sla.minutes_left ?? 1e9)), [s.incidents])
  const open = s.incidents.filter((i) => !['VERIFIED', 'REJECTED'].includes(i.status))
  const shown = s.incidents.filter(FILTERS.find((f) => f.key === filter)!.test)
  const incoming = s.stats.signals_today + (s.stats.confirmations_today ?? 0)

  return (
    <div className={`flex flex-col bg-bg text-text lg:h-dvh lg:overflow-hidden ${embed ? 'h-dvh overflow-hidden' : 'min-h-dvh pb-28 lg:pb-0'}`}>
      <header className="flex flex-none flex-wrap items-center gap-x-5 gap-y-3 border-b border-line px-5 pb-4 pt-[max(16px,env(safe-area-inset-top))] lg:px-6 lg:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="beam-fill beam-glow grid size-10 flex-none place-items-center rounded-[13px]"><Icon name="radar" size={20} className="text-on-blue" /></span>
          <div className="flex min-w-0 flex-col">
            <span className="t-label text-faint">{tx({ en: 'Workspace · unified contact centre', ru: 'Рабочее место · единый контакт-центр', kk: 'Жұмыс орны · бірыңғай байланыс орталығы' })}</span>
            <h1 className="font-[family-name:var(--font-display)] text-[20px] font-semibold leading-tight tracking-[-0.03em] text-text">109 Copilot</h1>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4">
          <HeadStat v={incoming} l={tx({ en: 'resident signals 24h', ru: 'сигналов жителей 24ч', kk: 'сигнал 24с' })} />
          <HeadStat v={`${Math.round(s.stats.merge_ratio * 100)}%`} l={tx({ en: 'joined an incident', ru: 'присоединено', kk: 'біріктірілді' })} beam />
          <HeadStat v={s.stats.incidents_open} l={tx({ en: 'open', ru: 'открыто', kk: 'ашық' })} />
          <HeadStat v={guardian.length} l={tx({ en: 'at risk', ru: 'под угрозой', kk: 'қауіпте' })} red={guardian.length > 0} />
        </div>
        {demo ? <Badge tone="demo">DEMO</Badge> : null}
        {!embed ? (
          <div className="flex items-center gap-2">
            <Link href="/copilot/pilot" className="tap inline-flex h-9 items-center gap-1.5 rounded-full bg-demo-soft px-3 text-[12px] font-bold text-demo"><Icon name="radar" size={14} />{tx({ en: 'Pilot simulation', ru: 'Симуляция пилота', kk: 'Пилот симуляциясы' })}</Link>
            <Link href="/map?layer=109" className="tap inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3 text-[12px] font-bold text-secondary hairline hover:text-text"><Icon name="map" size={14} />{tx({ en: 'On the map', ru: 'На карте', kk: 'Картада' })}</Link>
            {me ? <span className="hidden items-center gap-1.5 rounded-full bg-beam-soft px-3 py-1.5 text-[12px] font-bold text-beam xl:inline-flex">{tx(ROLE_LABEL[me.role])} · {me.name ?? me.email.split('@')[0]}</span> : null}
          </div>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_1fr] xl:grid-cols-[340px_1fr_320px]">
        {/* Left: queue + incidents */}
        <aside className="no-scrollbar flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-line p-3">
          <button type="button" onClick={() => setSel({ kind: 'compose' })} className={`tap flex h-12 items-center gap-2.5 rounded-[14px] px-4 text-[13.5px] font-bold ${sel?.kind === 'compose' ? 'beam-fill' : 'bg-surface text-text hairline hover:bg-surface-2'}`}>
            <Icon name="phone" size={17} />{tx({ en: 'New intake', ru: 'Новый приём', kk: 'Жаңа қабылдау' })}<span className="ml-auto t-mono text-[10.5px] opacity-60">call · chat</span>
          </button>
          <section className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between px-1"><p className="t-label text-faint">{tx({ en: 'Incoming', ru: 'Входящие', kk: 'Кіріс' })}</p><span className="t-mono text-[11px] text-beam">{s.pending.length}</span></div>
            {s.pending.length ? s.pending.map((p) => {
              const m = p.preview.matches[0]
              const active = sel?.kind === 'signal' && sel.id === p.id
              return (
                <button key={p.id} type="button" onClick={() => setSel({ kind: 'signal', id: p.id })}
                  className={`tap flex flex-col gap-1.5 rounded-[14px] p-3 text-left ${active ? 'bg-surface beam-edge' : 'bg-surface/60 hairline hover:bg-surface'}`}>
                  <span className="flex items-center gap-2 t-mono text-[10.5px] text-faint">
                    <Icon name={CHANNEL[p.channel]?.icon ?? 'report'} size={12} />{CHANNEL[p.channel]?.label}<span suppressHydrationWarning>· {fmtTime(new Date(p.created_at))}</span>
                    <span className="ml-auto">{m?.likely ? <span className="text-green">dup {Math.round(m.score * 100)}%</span> : <span className="text-beam">NEW</span>}</span>
                  </span>
                  <span className="t-sub line-clamp-2 text-text">{p.raw_text}</span>
                  {p.preview.intake.risk === 'imminent' ? <span className="t-meta font-bold text-red">⚠ {tx({ en: 'danger', ru: 'опасно', kk: 'қауіпті' })}</span> : null}
                </button>
              )
            }) : <p className="px-1 t-meta text-faint">{tx({ en: 'Queue is clear.', ru: 'Очередь пуста.', kk: 'Кезек бос.' })}</p>}
          </section>
          <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-1"><p className="t-label text-faint">{tx({ en: 'Incidents', ru: 'Инциденты', kk: 'Оқиғалар' })}</p><span className="t-mono text-[11px] text-faint">{open.length}</span></div>
            <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1.5">
              {FILTERS.map((f) => {
                const n = s.incidents.filter(f.test).length
                return <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} className={`tap inline-flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-[12px] font-bold ${filter === f.key ? 'bg-text text-bg' : 'bg-surface text-secondary hairline'}`}>{tx(f.label)}{f.key !== 'all' ? <span className="t-mono opacity-70">{n}</span> : null}</button>
              })}
            </div>
            {shown.map((i) => {
              const active = sel?.kind === 'incident' && sel.id === i.id
              return (
                <button key={i.id} type="button" onClick={() => setSel({ kind: 'incident', id: i.id })}
                  className={`tap flex items-center gap-3 rounded-[14px] p-2.5 text-left ${active ? 'bg-surface hairline' : 'hover:bg-surface/60'}`}>
                  <span className={`grid size-9 flex-none place-items-center rounded-[11px] ${i.priority === 'CRITICAL' ? 'bg-red text-bg' : 'bg-surface-2 text-text hairline'}`}><Icon name={SERVICE_ICON[i.service]} size={16} /></span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="t-row truncate text-text">{incidentHeading(lang, i)}</span>
                    <span className="t-meta truncate text-secondary"><span className="t-mono text-faint">{i.code}</span> · {whereText(lang, i)}</span>
                    <span className="t-meta truncate text-faint" suppressHydrationWarning>{tx(STATUS[i.status]?.label ?? STATUS.NEW!.label)} · {ago(lang, i.first_signal_at)}{i.demo_session_id ? ' · live' : ''}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="t-num text-[15px] font-semibold text-text" title={residentsText(lang, i.residents)}>{i.residents}</span>
                    {i.priority === 'CRITICAL' || i.priority === 'HIGH' ? <span className={`size-1.5 rounded-full ${i.priority === 'CRITICAL' ? 'bg-red' : 'bg-amber'}`} /> : i.sla.level === 'breached' ? <span className="size-1.5 rounded-full bg-red" /> : null}
                  </span>
                </button>
              )
            })}
            {!shown.length ? <p className="px-1 py-2 t-meta text-faint">{tx({ en: 'Nothing here.', ru: 'Здесь пусто.', kk: 'Бос.' })}</p> : null}
          </section>
        </aside>

        {/* Centre */}
        <main id="copilot-desk" className="no-scrollbar min-h-0 scroll-mt-4 overflow-y-auto p-4 sm:p-6">
          {sel?.kind === 'compose' ? <Composer onQueued={(id) => { void refresh().then(() => setSel({ kind: 'signal', id })); toast(tx({ en: 'Signal added to the queue', ru: 'Сигнал добавлен в очередь', kk: 'Сигнал кезекке қосылды' })) }} />
            : sel?.kind === 'signal' ? (() => { const p = s.pending.find((x) => x.id === sel.id); return p ? <SignalDesk p={p} onDone={async (incidentId, msg) => { await refresh(); setSel({ kind: 'incident', id: incidentId }); toast(msg) }} /> : <Empty /> })()
            : sel?.kind === 'incident' ? <IncidentDesk id={sel.id} version={s.incidents.find((i) => i.id === sel.id)?.updated_at ?? ''} all={s.incidents} onChange={(m) => { void refresh(); if (m) toast(m) }} onOpen={(id) => setSel({ kind: 'incident', id })} />
            : <Empty />}
        </main>

        {/* Right: guardian + analytics */}
        <aside className="no-scrollbar hidden min-h-0 flex-col gap-4 overflow-y-auto border-l border-line p-4 xl:flex">
          <section className="flex flex-col gap-3 rounded-[20px] bg-surface p-4 hairline">
            <div className="flex items-center justify-between"><p className="t-label text-faint">SLA guardian</p><Icon name="timer" size={16} className="text-red" /></div>
            <p className="t-card text-text">{guardian.length ? tx({ en: `${guardian.length} need intervention now`, ru: `${guardian.length} требуют вмешательства сейчас`, kk: `${guardian.length} қазір араласуды қажет етеді` }) : tx({ en: 'Nothing at risk', ru: 'Рисков нет', kk: 'Қауіп жоқ' })}</p>
            {guardian.map((i) => (
              <button key={i.id} type="button" onClick={() => setSel({ kind: 'incident', id: i.id })} className="tap flex flex-col gap-1.5 rounded-[14px] bg-bg p-3 text-left hairline hover:bg-surface-2">
                <span className="flex items-center justify-between gap-2"><span className="t-mono text-[10.5px] text-faint">{i.code}</span><SlaChip sla={i.sla} /></span>
                <span className="t-row text-text">{incidentHeading(lang, i)} · {whereText(lang, i)}</span>
                <span className="t-meta text-secondary">{i.sla.reasons.map((r) => tx(REASON[r] ?? { en: r, ru: r })).join(' · ') || tx({ en: 'critical risk', ru: 'критический риск', kk: 'сыни қауіп' })}</span>
              </button>
            ))}
          </section>
          <AnalyticsPanel a={s.stats.analytics} />
          <section className="flex flex-col gap-3 rounded-[20px] bg-surface p-4 hairline">
            <div className="flex items-center justify-between"><p className="t-label text-faint">Call QA</p><CopilotTag>AI</CopilotTag></div>
            <div className="flex items-end gap-2"><span className="t-num text-[30px] font-semibold leading-none text-text">{s.stats.call_qa.total ? Math.round(((s.stats.call_qa.total - s.stats.call_qa.review) / s.stats.call_qa.total) * 100) : 100}%</span><span className="t-meta pb-1 text-secondary">{tx({ en: 'calls normal', ru: 'звонков в норме', kk: 'қоңырау қалыпты' })}</span></div>
            <Meter value={s.stats.call_qa.total ? (s.stats.call_qa.total - s.stats.call_qa.review) / s.stats.call_qa.total : 1} tone="green" />
            <p className="t-meta text-secondary">{s.stats.call_qa.review} / {s.stats.call_qa.total} {tx({ en: 'flagged for an analyst: address not clarified, no request number, risk not asked. Never an automatic penalty.', ru: 'на проверку аналитику: не уточнён адрес, не сообщён номер, не спросили про опасность. Никаких автоматических штрафов.', kk: 'талдаушыға тексеруге. Автоматты айыппұл жоқ.' })}</p>
          </section>
          <LiveSessions />
          {demo ? <DemoControls onDone={() => { void refresh(); toast('Demo scenario reloaded') }} /> : null}
        </aside>
      </div>
      {flash ? <div className="sheet-in fixed bottom-24 left-1/2 lg:bottom-5 z-50 -translate-x-1/2 rounded-full beam-fill px-5 py-3 text-[13px] font-bold shadow-2xl">{flash}</div> : null}
    </div>
  )
}

/** Real numbers from real incidents (30 days). No invented savings. */
function AnalyticsPanel({ a }: { a: Analytics }) {
  const { lang, tx } = useApp()
  const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`)
  return (
    <section className="flex flex-col gap-3 rounded-[20px] bg-surface p-4 hairline">
      <div className="flex items-center justify-between"><p className="t-label text-faint">{tx({ en: 'Analytics · 30 days', ru: 'Аналитика · 30 дней', kk: 'Талдау · 30 күн' })}</p><Icon name="layers" size={15} className="text-faint" /></div>
      <div className="grid grid-cols-2 gap-2">
        <Tile v={a.active} l={tx({ en: 'active incidents', ru: 'активных', kk: 'белсенді' })} />
        <Tile v={a.overdue} l={tx({ en: 'overdue', ru: 'просрочено', kk: 'кешіккен' })} red={a.overdue > 0} />
        <Tile v={a.response_min != null ? duration(lang, a.response_min) : '–'} l={tx({ en: 'avg. time to assign', ru: 'ср. время реакции', kk: 'орт. әрекет уақыты' })} />
        <Tile v={a.resolution_h != null ? duration(lang, a.resolution_h * 60) : '–'} l={tx({ en: 'avg. time to fix', ru: 'ср. время решения', kk: 'орт. шешу уақыты' })} />
        <Tile v={pct(a.verified_rate)} l={tx({ en: 'verified by residents', ru: 'подтверждено жителями', kk: 'тұрғындар растады' })} beam />
        <Tile v={pct(a.first_time_fix_rate)} l={tx({ en: 'fixed the first time', ru: 'решено с первого раза', kk: 'бірінші реттен шешілді' })} />
        <Tile v={a.reopened} l={tx({ en: 'reopened', ru: 'повторно открыто', kk: 'қайта ашылды' })} red={a.reopened > 0} />
        <Tile v={a.recurring} l={tx({ en: 'recurring problems', ru: 'повторные проблемы', kk: 'қайталанатын' })} />
      </div>
      <p className="t-meta text-faint">{tx({ en: `${a.residents} resident signals joined ${a.closed + a.active} incidents.`, ru: `${a.residents} сигналов жителей объединены в ${a.closed + a.active} ${plural('ru', a.closed + a.active, { en: ['', ''], ru: ['инцидент', 'инцидента', 'инцидентов'], kk: '' })}.`, kk: `${a.residents} сигнал ${a.closed + a.active} оқиғаға біріктірілді.` })}</p>
    </section>
  )
}

function HeadStat({ v, l, beam, red }: { v: React.ReactNode; l: string; beam?: boolean; red?: boolean }) {
  return <span className="flex items-baseline gap-1.5"><span className={`t-num text-[17px] font-semibold ${beam ? 'beam-text' : red ? 'text-red' : 'text-text'}`}>{v}</span><span className="t-meta text-faint">{l}</span></span>
}
function Tile({ v, l, beam, red }: { v: React.ReactNode; l: string; beam?: boolean; red?: boolean }) {
  return <div className="flex flex-col gap-1 rounded-[16px] bg-surface p-3 hairline"><span className={`t-num text-[22px] font-semibold leading-none ${beam ? 'beam-text' : red ? 'text-red' : 'text-text'}`}>{v}</span><span className="t-meta leading-tight text-secondary">{l}</span></div>
}
function Empty() {
  const { tx } = useApp()
  return <div className="grid h-full place-items-center"><p className="t-sub text-faint">{tx({ en: 'Select a signal or an incident.', ru: 'Выберите сигнал или инцидент.', kk: 'Сигнал не оқиғаны таңдаңыз.' })}</p></div>
}

// ── Intake: the copilot's reading of one message ────────────────────────────
const SCOPE: Record<string, { en: string; ru: string; kk: string }> = {
  single: { en: 'One apartment', ru: 'Одна квартира', kk: 'Бір пәтер' }, building: { en: 'Whole building', ru: 'Весь дом', kk: 'Бүкіл үй' },
  multiple: { en: 'Several homes', ru: 'Несколько квартир / домов', kk: 'Бірнеше үй' }, area: { en: 'Area', ru: 'Участок / двор', kk: 'Аумақ' },
}
const KIND: Record<string, { en: string; ru: string; kk: string }> = {
  outage: { en: 'Outage', ru: 'Отключение', kk: 'Ажырату' }, damage: { en: 'Damage', ru: 'Повреждение', kk: 'Зақым' },
  hazard: { en: 'Hazard', ru: 'Опасность', kk: 'Қауіп' }, complaint: { en: 'Complaint', ru: 'Жалоба', kk: 'Шағым' },
}
function IntakePanel({ p, text }: { p: SignalPreview; text: string }) {
  const { lang, tx } = useApp()
  const i = p.intake
  const fields: Array<[string, string | null, string | undefined]> = [
    [tx({ en: 'Category', ru: 'Категория', kk: 'Санат' }), i.service === 'other' ? null : `${incidentName(lang, i.service)}`, i.spans.find((x) => x.field === 'service')?.text],
    [tx({ en: 'Location', ru: 'Адрес', kk: 'Мекенжай' }), i.designator ? placeText(lang, { designator: i.designator, house: i.house }) + (i.entrance ? ` · ${tx({ en: 'entrance', ru: 'подъезд', kk: 'кіреберіс' })} ${i.entrance}` : '') : null, [i.spans.find((x) => x.field === 'designator')?.text, i.spans.find((x) => x.field === 'house')?.text].filter(Boolean).join(' · ')],
    [tx({ en: 'Started', ru: 'Началось', kk: 'Басталды' }), i.started_text, i.started_at ? fmtTime(new Date(i.started_at)) : undefined],
    [tx({ en: 'Scope', ru: 'Масштаб', kk: 'Ауқым' }), tx(SCOPE[i.scope]!), i.scope_text ?? undefined],
    [tx({ en: 'Type', ru: 'Тип', kk: 'Түрі' }), tx(KIND[i.kind]!), undefined],
    [tx({ en: 'Risk', ru: 'Риск', kk: 'Қауіп' }), i.risk === 'none' ? tx({ en: 'No immediate danger detected', ru: 'Прямой опасности не выявлено', kk: 'Тікелей қауіп жоқ' }) : i.risk_flags.map((f) => tx(REASON[f] ?? { en: f, ru: f })).join(', '), undefined],
  ]
  return (
    <section className="flex flex-col gap-4 rounded-[22px] bg-surface p-5 hairline">
      <div className="flex items-center justify-between"><CopilotTag>AI intake</CopilotTag><span className="t-mono text-[11px] text-faint">{p.ms} ms · {i.lang.toUpperCase()} · {tx({ en: 'confidence', ru: 'уверенность', kk: 'сенімділік' })} {Math.round(i.confidence * 100)}%</span></div>
      <p className="rounded-[14px] bg-bg p-3 t-mono text-[12.5px] leading-relaxed text-secondary hairline whitespace-pre-line">{highlight(text, i.spans.map((x) => x.text))}</p>
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        {fields.map(([k, v, src]) => (
          <div key={k} className={`flex flex-col gap-0.5 rounded-[14px] p-3 ${v ? 'bg-bg hairline' : 'bg-amber-soft'}`}>
            <dt className="t-label !text-[9px] text-faint">{k}</dt>
            <dd className={`t-row ${v ? 'text-text' : 'text-amber'}`}>{v ?? tx({ en: 'missing', ru: 'нет', kk: 'жоқ' })}</dd>
            {src ? <dd className="t-mono truncate text-[10.5px] text-faint">{src}</dd> : null}
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${i.priority === 'CRITICAL' ? 'bg-red text-bg' : i.priority === 'HIGH' ? 'bg-amber-soft text-amber' : 'bg-bg text-secondary hairline'}`}>{i.priority}</span>
        {i.missing.map((m) => <span key={m} className="rounded-full bg-amber-soft px-2.5 py-1 text-[11px] font-bold text-amber">{tx({ en: 'ask', ru: 'уточнить', kk: 'нақтылау' })}: {tx(REASON[m] ?? { en: m, ru: m })}</span>)}
      </div>
    </section>
  )
}

/** Marks the fragments the copilot grounded its fields in. */
function highlight(text: string, frags: string[]) {
  const lower = text.toLowerCase().replace(/ё/g, 'е')
  const marks: Array<[number, number]> = []
  for (const f of frags) {
    const idx = lower.indexOf(f.toLowerCase())
    if (idx >= 0 && f.length > 1) marks.push([idx, idx + f.length])
  }
  marks.sort((a, b) => a[0] - b[0])
  const out: React.ReactNode[] = []
  let at = 0
  for (const [a, b] of marks) {
    if (a < at) continue
    out.push(text.slice(at, a), <mark key={a} className="rounded bg-beam-soft px-0.5 text-beam">{text.slice(a, b)}</mark>)
    at = b
  }
  out.push(text.slice(at))
  return out
}

function MatchPanel({ p, onAttach, onCreate, busy }: { p: SignalPreview; onAttach: (id: string) => void; onCreate: () => void; busy: boolean }) {
  const { lang, tx } = useApp()
  return (
    <section className="flex flex-col gap-3 rounded-[22px] bg-surface p-5 hairline">
      <div className="flex items-center justify-between"><CopilotTag>{tx({ en: 'Incident matching', ru: 'Поиск дубликатов', kk: 'Қайталауды іздеу' })}</CopilotTag><span className="t-meta text-faint">{p.matches.length} {tx({ en: 'candidates', ru: 'кандидатов', kk: 'үміткер' })}</span></div>
      {p.official[0] ? (
        <div className="flex items-center gap-3 rounded-[14px] bg-soft p-3"><Icon name="shield" size={18} className="text-blue" /><div className="flex flex-col"><span className="t-row text-text">{tx({ en: 'Official notice covers this', ru: 'Есть официальное уведомление', kk: 'Ресми хабарлама бар' })}: {p.official[0].title}</span><span className="t-meta text-secondary">{p.official[0].reported_authority} · {tx({ en: 'tell the resident it is planned work', ru: 'сообщите жителю, что это плановые работы', kk: 'тұрғынға жоспарлы жұмыс екенін айтыңыз' })}</span></div></div>
      ) : null}
      {p.matches.map((m, k) => (
        <div key={m.id} className={`flex flex-col gap-3 rounded-[16px] p-4 ${m.likely ? 'bg-beam-soft' : 'bg-bg hairline'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="t-row text-text">{m.likely ? tx({ en: 'Likely duplicate', ru: 'Вероятный дубликат', kk: 'Ықтимал қайталау' }) : tx({ en: 'Possible match', ru: 'Возможное совпадение', kk: 'Мүмкін сәйкестік' })} · <span className="t-mono">{m.code}</span></span>
              <span className="t-meta text-secondary">{incidentName(lang, m.service)} · {placeText(lang, m)} · {m.signal_count} {tx({ en: 'reports', ru: 'обращений', kk: 'өтініш' })} · {tx(STATUS[m.status]?.label ?? STATUS.NEW!.label)}</span>
            </div>
            <span className={`t-num text-[26px] font-semibold leading-none ${m.likely ? 'beam-text' : 'text-secondary'}`}>{Math.round(m.score * 100)}%</span>
          </div>
          <Meter value={m.score} tone={m.likely ? 'beam' : 'blue'} />
          <p className="flex flex-wrap gap-1.5">{m.reasons.map((r) => <span key={r} className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-secondary hairline">{tx(REASON[r] ?? { en: r, ru: r })}</span>)}</p>
          <Button size="sm" style={k === 0 && m.likely ? 'beam' : 'outline'} disabled={busy} onClick={() => onAttach(m.id)}><Icon name="merge" size={16} />{tx({ en: `Attach signal to ${m.code}`, ru: `Присоединить к ${m.code}`, kk: `${m.code} оқиғасына қосу` })}</Button>
        </div>
      ))}
      {!p.matches.length ? <p className="t-sub text-secondary">{tx({ en: 'No open incident like this.', ru: 'Похожих открытых инцидентов нет.', kk: 'Ұқсас ашық оқиға жоқ.' })}</p> : null}
      <Button size="sm" style={p.matches.some((m) => m.likely) ? 'outline' : 'primary'} disabled={busy} onClick={onCreate}><Icon name="plus" size={16} />{tx({ en: 'Create a separate incident', ru: 'Создать отдельный инцидент', kk: 'Бөлек оқиға ашу' })}</Button>
    </section>
  )
}

function SignalDesk({ p, onDone }: { p: Pending; onDone: (incidentId: string, msg: string) => void }) {
  const { tx } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const act = async (body: unknown, msg: string) => {
    setBusy(true); setErr(null)
    try { const r = await api<{ incident_id: string }>(`/api/ops/signals/${p.id}`, body); onDone(r.incident_id, msg) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div key={p.id} className="fade-in mx-auto flex max-w-[980px] flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-[12px] bg-surface hairline"><Icon name={CHANNEL[p.channel]?.icon ?? 'report'} size={18} /></span>
        <div className="flex flex-col"><span className="t-label text-faint">{CHANNEL[p.channel]?.label} · <span suppressHydrationWarning>{fmtTime(new Date(p.created_at))}</span></span><h1 className="t-headline text-text">{tx({ en: 'Incoming signal', ru: 'Входящий сигнал', kk: 'Кіріс сигнал' })}</h1></div>
        {p.is_demo ? <Badge tone="demo">DEMO</Badge> : null}
      </div>
      <div className="grid gap-5 2xl:grid-cols-2">
        <IntakePanel p={p.preview} text={p.raw_text} />
        <MatchPanel p={p.preview} busy={busy}
          onAttach={(id) => act({ action: 'attach', incident_id: id }, tx({ en: 'Attached, no new request opened', ru: 'Присоединено — новая заявка не создана', kk: 'Қосылды — жаңа өтініш ашылмады' }))}
          onCreate={() => act({ action: 'create' }, tx({ en: 'Incident created, confirm the route', ru: 'Инцидент создан — подтвердите маршрут', kk: 'Оқиға ашылды' }))} />
      </div>
      <RoutePreview p={p.preview} />
      {err ? <p className="t-sub text-red">{err}</p> : null}
    </div>
  )
}

function RoutePreview({ p }: { p: SignalPreview }) {
  return <Responsibility d={{ responsible_chain: p.route.chain, responsible_org: p.route.org, routing_confidence: p.route.confidence, routing_note: p.route.note, needs_human_review: p.route.needs_review }} />
}

// ── Composer: a call transcript or a message from another channel ──────────
const CALLS = [
  'Оператор: 109, слушаю.\nЖитель: Алло, 14 микрорайон, 21 дом. Воды нет со вчерашнего вечера, у соседей тоже.\nОператор: Понял, уточните подъезд.\nЖитель: Второй.',
  '14 ш/а 23 үйде су жоқ, таңертеңнен бері',
  'Оператор: 109, слушаю.\nЖитель: В 14 мкр возле дома 20 висит блок кондиционера на проводах, прямо над входом, может упасть на людей.',
  '32А мкр дом 5, лифт не работает с утра, у нас пожилые люди на 9 этаже',
  '29 мкр во дворе дома 12 открытый люк канализации, дети играют рядом',
]

type SpeechRec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null }

function Composer({ onQueued }: { onQueued: (signalId: string) => void }) {
  const { tx, lang } = useApp()
  const [text, setText] = useState('')
  const [channel, setChannel] = useState<'PHONE' | 'WHATSAPP' | 'INSTAGRAM' | 'KOMEK109'>('PHONE')
  const [p, setP] = useState<SignalPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [typing, setTyping] = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRec | null>(null)
  useEffect(() => {
    if (text.trim().length < 4) { setP(null); return }
    const ctl = new AbortController()
    const id = setTimeout(() => { fetch('/api/ops/signals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, channel, preview: true }), signal: ctl.signal }).then((r) => r.json()).then(setP).catch(() => {}) }, 250)
    return () => { clearTimeout(id); ctl.abort() }
  }, [text, channel])
  // A simulated incoming call: the transcript streams in as speech-to-text would.
  const simulate = () => {
    const call = CALLS[Math.floor(Math.random() * CALLS.length)]!
    setChannel(call.startsWith('Оператор') ? 'PHONE' : 'KOMEK109')
    setText(''); setTyping(true)
    const words = call.split(/(\s+)/)
    let k = 0
    const id = setInterval(() => {
      k += 1
      setText(words.slice(0, k).join(''))
      if (k >= words.length) { clearInterval(id); setTyping(false) }
    }, 55)
  }
  const mic = () => {
    if (listening) { recRef.current?.stop(); return }
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
    const Rec = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Rec) return
    const rec = new Rec()
    rec.lang = lang === 'kk' ? 'kk-KZ' : lang === 'en' ? 'en-US' : 'ru-RU'
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = (e) => setText(Array.from(e.results).map((r) => r[0]!.transcript).join(' '))
    rec.onend = () => setListening(false)
    recRef.current = rec
    setListening(true); setChannel('PHONE'); rec.start()
  }
  return (
    <div className="fade-in mx-auto flex max-w-[980px] flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="t-headline text-text">{tx({ en: 'New intake', ru: 'Новый приём', kk: 'Жаңа қабылдау' })}</h1>
        <div className="flex gap-2">
          <Button size="sm" full={false} style="outline" onClick={mic}><Icon name="mic" size={15} />{listening ? tx({ en: 'Stop', ru: 'Стоп', kk: 'Тоқтату' }) : tx({ en: 'Live transcription', ru: 'Живая расшифровка', kk: 'Тірі транскрипция' })}</Button>
          <Button size="sm" full={false} style="beam" disabled={typing} onClick={simulate}><Icon name="phone" size={15} />{tx({ en: 'Simulate incoming call', ru: 'Симулировать звонок', kk: 'Қоңырауды симуляциялау' })}</Button>
        </div>
      </div>
      <div className={`flex flex-col gap-3 rounded-[22px] bg-surface p-4 hairline ${typing || listening ? 'beam-edge' : ''}`}>
        <div className="flex flex-wrap gap-1.5">
          {(['PHONE', 'WHATSAPP', 'INSTAGRAM', 'KOMEK109'] as const).map((c) => (
            <button key={c} type="button" onClick={() => setChannel(c)} className={`tap inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold ${channel === c ? 'bg-text text-bg' : 'bg-bg text-secondary hairline'}`}><Icon name={CHANNEL[c]!.icon} size={13} />{CHANNEL[c]!.label}</button>
          ))}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={tx({ en: 'Paste a transcript or a message…', ru: 'Вставьте расшифровку звонка или сообщение…', kk: 'Қоңырау транскрипциясын не хабарды қойыңыз…' })}
          className="w-full resize-none bg-transparent t-mono text-[13.5px] leading-relaxed text-text outline-none placeholder:text-faint" />
      </div>
      {p ? (
        <>
          <IntakePanel p={p} text={text} />
          {p.matches[0]?.likely ? <p className="flex items-center gap-2 rounded-[16px] bg-beam-soft p-4 t-row text-text"><Icon name="merge" size={18} className="text-beam" />{tx({ en: `Likely a duplicate of ${p.matches[0].code} (${Math.round(p.matches[0].score * 100)}%). Queue it — you’ll attach it in one tap.`, ru: `Вероятно, дубликат ${p.matches[0].code} (${Math.round(p.matches[0].score * 100)}%). Поставьте в очередь — присоедините одним нажатием.`, kk: `${p.matches[0].code} қайталауы болуы мүмкін.` })}</p> : null}
          <Button disabled={busy || typing} onClick={async () => {
            setBusy(true)
            try { const r = await api<{ signal_id: string }>('/api/ops/signals', { text, channel }); setText(''); onQueued(r.signal_id) } finally { setBusy(false) }
          }}><Icon name="send" size={17} />{tx({ en: 'Register signal', ru: 'Зарегистрировать сигнал', kk: 'Сигналды тіркеу' })}</Button>
        </>
      ) : null}
    </div>
  )
}

// ── Incident desk: one aggregate incident, the whole loop on one screen ─────
type StaffDetail = IncidentDetailDTO & {
  signals: Array<IncidentDetailDTO['signals'][number] & { raw_text?: string; photo?: string | null; check?: SignalCheck | null }>
}

export function IncidentDesk({ id, version, all, onChange, onOpen, initial = null }: { id: string; version: string; all: IncidentDTO[]; onChange: (msg?: string) => void; onOpen: (id: string) => void; initial?: StaffDetail | null }) {
  const { lang, tx } = useApp()
  const [d, setD] = useState<StaffDetail | null>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [update, setUpdate] = useState('')
  const load = useCallback(async () => { try { setD(await api(`/api/ops/incidents/${id}`)) } catch { /* ignore */ } }, [id])
  useEffect(() => { void load() }, [load, version])
  const act = async (body: unknown, msg?: string) => {
    setBusy(true); setErr(null)
    try { await api(`/api/ops/incidents/${id}`, body); await load(); onChange(msg); return true } catch (e) { setErr((e as Error).message); return false } finally { setBusy(false) }
  }
  if (!d) return <div className="mx-auto h-64 max-w-[980px] rounded-[22px] shimmer" />
  const st = STATUS[d.status] ?? STATUS.NEW!
  const routed = !['NEW', 'REJECTED'].includes(d.status)
  const merged = d.signal_count - 1
  const who = d.team ? `${d.team}${d.responsible_org && d.responsible_org !== d.team ? ` · ${d.responsible_org}` : ''}` : d.responsible_org
  return (
    <div key={d.id} className="fade-in mx-auto flex max-w-[980px] flex-col gap-5">
      <div className="flex flex-wrap items-start gap-4">
        <span className={`grid size-14 flex-none place-items-center rounded-[18px] ${d.priority === 'CRITICAL' ? 'bg-red text-bg' : 'bg-surface text-text hairline'}`}><Icon name={SERVICE_ICON[d.service]} size={26} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2"><span className="t-mono text-[12px] text-faint">{d.code} · {d.service.toUpperCase()}</span>{d.is_demo ? <Badge tone="demo">DEMO</Badge> : null}{d.session ? <Badge tone="demo">{tx({ en: 'Live session', ru: 'Живая сессия', kk: 'Тірі сессия' })} · {d.session.code}</Badge> : null}</div>
          <h1 className="t-title !text-[24px] text-text">{incidentHeading(lang, d)} · {whereText(lang, d)}</h1>
          <div className="flex flex-wrap items-center gap-2"><Badge tone={st.tone} dot>{tx(st.label)}</Badge><PriorityChip level={d.priority} /><SlaChip sla={d.sla} />{d.risk_flags.map((f) => <Badge key={f} tone="active">{tx(REASON[f] ?? { en: f, ru: f })}</Badge>)}</div>
        </div>
        <div className="flex flex-col items-end">
          <span className="t-num text-[44px] font-semibold leading-none beam-text">{d.residents}</span>
          <span className="t-meta text-faint">{tx({ en: 'resident signals → 1 incident', ru: 'сигналов жителей → 1 инцидент', kk: 'тұрғын сигналы → 1 оқиға' })}</span>
        </div>
      </div>

      {/* The aggregate, as the operator needs it */}
      <section className="grid gap-px overflow-hidden rounded-[20px] bg-line hairline sm:grid-cols-2 lg:grid-cols-3">
        <Fact label={tx({ en: 'Confirmations', ru: 'Подтверждения жителей', kk: 'Тұрғындар растауы' })} value={`${d.confirm_count}`} sub={merged > 0 ? `${merged} ${plural(lang, merged, { en: ['report merged into this incident', 'reports merged into this incident'], ru: ['обращение объединено сюда', 'обращения объединены сюда', 'обращений объединено сюда'], kk: 'өтініш біріктірілді' })}` : tx({ en: 'the first report opened it', ru: 'открыто первым обращением', kk: 'алғашқы өтініш ашты' })} />
        <Fact label={tx({ en: 'Affected', ru: 'Затрагивает', kk: 'Қамтиды' })} value={scopeText(lang, d)} sub={d.scope_source === 'operator' ? tx({ en: 'set by an operator', ru: 'задано оператором', kk: 'оператор белгіледі' }) : tx({ en: 'inferred from reports', ru: 'определено по обращениям', kk: 'өтініштерден анықталды' })} />
        <Fact label={tx({ en: 'Priority', ru: 'Приоритет', kk: 'Басымдық' })} value={<PriorityChip level={d.priority} />} sub={d.priority_reasons.slice(0, 3).map((r) => priorityWhy(lang, r)).join(' · ')} />
        <Fact label={tx({ en: 'Reported', ru: 'Сообщено', kk: 'Хабарланды' })} value={<span suppressHydrationWarning>{ago(lang, d.first_signal_at)}</span>} sub={<span suppressHydrationWarning>{fmtTime(new Date(d.first_signal_at))} · {Object.entries(d.channels).map(([c, n]) => `${CHANNEL[c]?.label ?? c} ${n}`).join(', ')}</span>} />
        <Fact label={routed ? tx({ en: 'Responsible', ru: 'Ответственный', kk: 'Жауапты' }) : tx({ en: 'Likely responsible', ru: 'Вероятно отвечает', kk: 'Ықтимал жауапты' })} value={who ?? '—'} sub={routed ? tx({ en: 'assigned by 109', ru: 'назначено 109', kk: '109 тағайындады' }) : `${tx(SOURCE.ai!)} · ${d.routing_confidence != null ? Math.round(d.routing_confidence * 100) : '–'}%`} />
        <Fact label={tx({ en: 'Deadline', ru: 'Срок', kk: 'Мерзім' })} value={<span suppressHydrationWarning>{etaLine(lang, d.commit_finish_at) ?? tx({ en: 'not committed', ru: 'не назначен', kk: 'белгіленбеген' })}</span>} sub={d.deadline_changes ? `${d.deadline_changes} ${plural(lang, d.deadline_changes, { en: ['change', 'changes'], ru: ['изменение', 'изменения', 'изменений'], kk: 'өзгеріс' })}` : undefined} />
      </section>
      <div className="rounded-[20px] bg-surface p-4 hairline"><Pipeline status={d.status} /></div>

      <Actions d={d} all={all} busy={busy} act={act} onOpen={onOpen} />
      {err ? <p className="t-sub text-red">{err}</p> : null}
      <VerificationPanel d={d} busy={busy} act={act} />

      {routed && d.status !== 'REJECTED' ? (
        <section className="flex flex-col gap-3 rounded-[22px] bg-surface p-5 hairline">
          <div className="flex items-center justify-between"><h2 className="t-row text-text">{tx({ en: `Update all ${d.residents} residents at once`, ru: `Обновление сразу для всех ${d.residents} жителей`, kk: `Барлық ${d.residents} тұрғынға бір жаңалық` })}</h2><Icon name="people" size={17} className="text-secondary" /></div>
          <div className="flex gap-2">
            <input value={update} onChange={(e) => setUpdate(e.target.value)} placeholder={tx({ en: 'Crew on site, water expected by 18:00.', ru: 'Бригада на месте, подача ожидается к 18:00.', kk: 'Бригада орнында.' })} className="h-11 flex-1 rounded-[13px] bg-bg px-3 t-body text-text outline-none hairline placeholder:text-faint" />
            <Button size="sm" full={false} disabled={busy || update.trim().length < 2} onClick={() => { void act({ action: 'update', message: update.trim() }, tx({ en: `Sent to ${d.residents} residents`, ru: `Отправлено ${d.residents} жителям`, kk: `${d.residents} тұрғынға жіберілді` })); setUpdate('') }}><Icon name="send" size={15} />{tx({ en: 'Send', ru: 'Отправить', kk: 'Жіберу' })}</Button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Responsibility d={d} />
        <Proof d={d} />
      </div>

      <Confirmations d={d} />

      <section className="flex flex-col gap-2 rounded-[22px] bg-surface p-5 hairline">
        <h2 className="t-row mb-1 text-text">{tx({ en: 'Reports', ru: 'Обращения', kk: 'Өтініштер' })} · {d.signals.length}</h2>
        {d.signals.map((x) => (
          <div key={x.id} className="flex items-start gap-3 rounded-[14px] bg-bg p-3 hairline">
            <Icon name={CHANNEL[x.channel]?.icon ?? 'report'} size={15} className="mt-0.5 text-secondary" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="t-sub text-text whitespace-pre-line">{x.raw_text}</span>
              {x.photo ? (
                <a href={x.photo} target="_blank" rel="noreferrer" className="tap mt-1 self-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.photo} alt={tx({ en: "Resident's photo", ru: 'Фото жителя', kk: 'Тұрғынның фотосы' })} className="h-28 max-w-[220px] rounded-[12px] object-cover hairline" />
                </a>
              ) : null}
              {x.check ? <CheckChip c={x.check} /> : null}
              <span className="t-mono text-[10.5px] text-faint" suppressHydrationWarning>{fmtTime(new Date(x.created_at))} · {x.lang?.toUpperCase()} · {x.designator ?? '-'}{x.house ? `/${x.house}` : ''}{x.match_score != null ? ` · match ${Math.round(x.match_score * 100)}%` : ''} · {x.decision}{x.origin === 'staff' ? ' · staff' : ''}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-1 rounded-[22px] bg-surface p-5 hairline">
        <h2 className="t-row mb-2 text-text">{tx({ en: 'Timeline (audit trail)', ru: 'Хронология (журнал)', kk: 'Хронология' })}</h2>
        {d.timeline.map((x) => (
          <div key={x.id} className="flex gap-3 border-l border-line py-1.5 pl-3">
            <span className="t-mono w-12 flex-none text-[11px] text-faint" suppressHydrationWarning>{fmtTime(new Date(x.created_at))}</span>
            <span className="flex min-w-0 flex-col">
              <span className={`t-sub ${x.source === 'ai' ? 'text-beam' : 'text-text'}`}>{timelineText(lang, x)}</span>
              <span className="t-meta text-faint">{tx(sourceLabel(x))}{x.visibility === 'staff' ? ` · ${tx({ en: '109 only', ru: 'только 109', kk: 'тек 109' })}` : ''} · {x.actor}</span>
            </span>
          </div>
        ))}
      </section>
    </div>
  )
}

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface p-4">
      <span className="t-label !text-[11px] text-faint">{label}</span>
      <span className="t-row text-text">{value}</span>
      {sub ? <span className="t-meta text-secondary">{sub}</span> : null}
    </div>
  )
}

const REASONS_DEADLINE = [
  { en: 'Extra equipment is needed', ru: 'Требуется дополнительное оборудование', kk: 'Қосымша жабдық қажет' },
  { en: 'Waiting for access to the premises', ru: 'Нужен доступ в помещение', kk: 'Үй-жайға кіру керек' },
  { en: 'Weather conditions', ru: 'Погодные условия', kk: 'Ауа райы' },
  { en: 'The damage is larger than expected', ru: 'Повреждение больше, чем ожидалось', kk: 'Зақым күткеннен үлкен' },
]

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
/** A wall-clock time in Aktau (UTC+5), today or tomorrow. */
function aqtauAt(h: number, m: number, dayOffset: number) {
  const now = new Date()
  const local = new Date(now.getTime() + 5 * 3600_000)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, h - 5, m))
}

/** Status-dependent operator and team actions. */
function Actions({ d, all, busy, act, onOpen }: { d: StaffDetail; all: IncidentDTO[]; busy: boolean; act: (b: unknown, m?: string) => Promise<boolean>; onOpen: (id: string) => void }) {
  const { tx } = useApp()
  if (d.merged_into) return (
    <button type="button" onClick={() => onOpen(d.merged_into!.id)} className="tap flex items-center gap-3 rounded-[22px] bg-soft p-5 text-left">
      <Icon name="merge" size={20} className="text-blue" /><span className="t-row text-text">{tx({ en: `Merged into ${d.merged_into.code}`, ru: `Объединено с ${d.merged_into.code}`, kk: `${d.merged_into.code} біріктірілді` })}</span>
    </button>
  )
  if (d.status === 'REJECTED') return <p className="rounded-[22px] bg-surface p-5 t-sub text-secondary hairline">{tx({ en: 'Closed without work.', ru: 'Закрыто без работ.', kk: 'Жұмыссыз жабылды.' })}</p>
  return (
    <div className="flex flex-col gap-3">
      {d.status === 'NEW' ? <AssignPanel d={d} all={all} busy={busy} act={act} /> : null}
      {['ROUTED', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED'].includes(d.status) ? <TeamPanel d={d} busy={busy} act={act} /> : null}
      <MorePanel d={d} all={all} busy={busy} act={act} />
    </div>
  )
}

function AssignPanel({ d, all, busy, act }: { d: StaffDetail; all: IncidentDTO[]; busy: boolean; act: (b: unknown, m?: string) => Promise<boolean> }) {
  const { tx } = useApp()
  const [org, setOrg] = useState(d.responsible_org ?? '')
  const [team, setTeam] = useState(d.team ?? (d.session ? 'Demo IT Team' : ''))
  const alternatives = ((d.responsible_chain as Array<{ name: string; level: string }>) ?? []).filter((c) => !['object', 'system'].includes(c.level)).map((c) => c.name)
  const orgs = [...new Set([d.responsible_org, ...alternatives].filter(Boolean) as string[])]
  const teams = [...new Set(all.filter((i) => i.team && (i.responsible_org === org || !org)).map((i) => i.team!))].slice(0, 8)
  return (
    <section className="flex flex-col gap-3 rounded-[22px] bg-surface p-5 beam-edge">
      <div className="flex items-center justify-between"><h2 className="t-row text-text">{tx({ en: 'Assign the responsible team', ru: 'Назначить исполнителя', kk: 'Орындаушыны тағайындау' })}</h2><CopilotTag>{d.routing_confidence != null ? `${Math.round(d.routing_confidence * 100)}%` : 'route'}</CopilotTag></div>
      {d.needs_human_review ? <p className="flex items-center gap-2 t-sub text-amber"><Icon name="alert" size={16} />{tx({ en: 'Possible responsibility ambiguity, you decide.', ru: 'Возможна неоднозначность ответственности — решаете вы.', kk: 'Жауапкершілік анық емес — сіз шешесіз.' })}</p> : null}
      <div className="flex flex-col gap-1.5">
        <span className="t-meta text-secondary">{tx({ en: 'Confirm the responsible organisation', ru: 'Подтвердите ответственную организацию', kk: 'Жауапты ұйымды растаңыз' })}</span>
        <div className="flex flex-wrap gap-2">{orgs.map((o) => <button key={o} type="button" onClick={() => setOrg(o)} className={`tap h-9 rounded-full px-3.5 text-[12.5px] font-bold ${org === o ? 'bg-text text-bg' : 'bg-bg text-secondary hairline'}`}>{o}</button>)}</div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="t-meta text-secondary">{tx({ en: 'Team (optional)', ru: 'Бригада / команда (необязательно)', kk: 'Бригада (міндетті емес)' })}</span>
        <input list="aktau-teams" value={team} onChange={(e) => setTeam(e.target.value)} placeholder={tx({ en: 'e.g. Emergency crew 2', ru: 'напр. Аварийная бригада №2', kk: 'мыс. №2 апаттық бригада' })} className="h-11 rounded-[13px] bg-bg px-3 t-body text-text outline-none hairline placeholder:text-faint" />
        <datalist id="aktau-teams">{teams.map((t) => <option key={t} value={t} />)}{d.session ? <option value="Demo IT Team" /> : null}</datalist>
      </label>
      <Button style="beam" disabled={busy || !org} onClick={() => void act({ action: 'route', org, team: team.trim() || null }, tx({ en: 'Assigned · residents notified', ru: 'Исполнитель назначен · жители уведомлены', kk: 'Тағайындалды · тұрғындарға хабарланды' }))}><Icon name="send" size={17} />{tx({ en: 'Assign', ru: 'Назначить', kk: 'Тағайындау' })}{team.trim() ? ` · ${team.trim()}` : ''}</Button>
    </section>
  )
}

/** The responsible team's commitment, work and completion (entered by 109 on its behalf, recorded as the team's). */
function TeamPanel({ d, busy, act }: { d: StaffDetail; busy: boolean; act: (b: unknown, m?: string) => Promise<boolean> }) {
  const { lang, tx } = useApp()
  const [finish, setFinish] = useState<string>('')
  const [start, setStart] = useState<string>('')
  const [withStart, setWithStart] = useState(false)
  const [reason, setReason] = useState('')
  const committed = !!d.commit_finish_at
  const quick: Array<{ l: string; at: () => Date }> = [
    { l: tx({ en: '+10 min', ru: '+10 мин', kk: '+10 мин' }), at: () => new Date(Date.now() + 10 * 60_000) },
    { l: tx({ en: '+30 min', ru: '+30 мин', kk: '+30 мин' }), at: () => new Date(Date.now() + 30 * 60_000) },
    { l: tx({ en: '+1 h', ru: '+1 ч', kk: '+1 сағ' }), at: () => new Date(Date.now() + 60 * 60_000) },
    { l: tx({ en: '+2 h', ru: '+2 ч', kk: '+2 сағ' }), at: () => new Date(Date.now() + 120 * 60_000) },
    { l: tx({ en: '+4 h', ru: '+4 ч', kk: '+4 сағ' }), at: () => new Date(Date.now() + 240 * 60_000) },
    { l: tx({ en: 'today 18:00', ru: 'сегодня 18:00', kk: 'бүгін 18:00' }), at: () => aqtauAt(18, 0, 0) },
    { l: tx({ en: 'tomorrow 10:00', ru: 'завтра 10:00', kk: 'ертең 10:00' }), at: () => aqtauAt(10, 0, 1) },
  ].filter((q) => q.at().getTime() > Date.now())
  const commit = async (at: Date) => {
    const ok = await act({ action: 'commit', finish_at: at.toISOString(), start_at: withStart && start ? new Date(start).toISOString() : null, reason: committed ? reason.trim() : null },
      committed ? tx({ en: 'Deadline changed · residents notified with the reason', ru: 'Срок изменён · жители уведомлены с причиной', kk: 'Мерзім өзгерді' }) : tx({ en: 'Accepted with a deadline · residents notified', ru: 'Работа принята со сроком · жители уведомлены', kk: 'Мерзіммен қабылданды' }))
    if (ok) { setReason(''); setFinish('') }
  }
  return (
    <section className="flex flex-col gap-4 rounded-[22px] bg-surface p-5 hairline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-row text-text">{tx({ en: 'Responsible team', ru: 'Исполнитель', kk: 'Орындаушы' })} · {d.team ?? d.responsible_org}</h2>
        <span className="t-label text-faint">{tx({ en: 'entered by 109 for the team', ru: 'вносит 109 от имени исполнителя', kk: '109 орындаушы атынан енгізеді' })}</span>
      </div>
      <div className="flex flex-col gap-2">
        <p className="t-sub text-text" suppressHydrationWarning>{committed ? <>{etaLine(lang, d.commit_finish_at)} · <span className="text-secondary">{tx({ en: 'change it:', ru: 'изменить:', kk: 'өзгерту:' })}</span></> : tx({ en: 'Accept and commit to a finish time:', ru: 'Принять работу и назвать срок завершения:', kk: 'Жұмысты қабылдап, мерзімін атаңыз:' })}</p>
        {committed ? (
          <div className="flex flex-col gap-2 rounded-[14px] bg-amber-soft p-3">
            <span className="t-meta font-bold text-amber">{tx({ en: 'Residents see the reason for a new deadline', ru: 'Жители увидят причину переноса срока', kk: 'Тұрғындар себебін көреді' })}</span>
            <div className="flex flex-wrap gap-1.5">{REASONS_DEADLINE.map((r) => <button key={r.ru} type="button" onClick={() => setReason(tx(r))} className={`tap h-8 rounded-full px-3 text-[12px] font-bold ${reason === tx(r) ? 'bg-text text-bg' : 'bg-surface text-secondary hairline'}`}>{tx(r)}</button>)}</div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx({ en: 'Reason', ru: 'Причина', kk: 'Себебі' })} className="h-10 rounded-[12px] bg-surface px-3 t-body text-text outline-none hairline placeholder:text-faint" />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => <button key={q.l} type="button" disabled={busy || (committed && reason.trim().length < 2)} onClick={() => void commit(q.at())} className="tap h-9 rounded-full bg-bg px-3.5 text-[12.5px] font-bold text-text hairline disabled:opacity-40">{q.l}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="datetime-local" value={finish} min={toLocalInput(new Date())} onChange={(e) => setFinish(e.target.value)} aria-label={tx({ en: 'Expected finish', ru: 'Ожидаемое завершение', kk: 'Күтілетін аяқталу' })} className="h-10 rounded-[12px] bg-bg px-3 t-body text-text outline-none hairline" />
          <Button size="sm" full={false} style="outline" disabled={busy || !finish || (committed && reason.trim().length < 2)} onClick={() => void commit(new Date(finish))}>{committed ? tx({ en: 'Change deadline', ru: 'Изменить срок', kk: 'Мерзімді өзгерту' }) : tx({ en: 'Set deadline', ru: 'Назначить срок', kk: 'Мерзім белгілеу' })}</Button>
          {!committed ? <label className="flex items-center gap-1.5 t-meta text-secondary"><input type="checkbox" checked={withStart} onChange={(e) => setWithStart(e.target.checked)} />{tx({ en: 'with a start time', ru: 'со временем начала', kk: 'басталу уақытымен' })}</label> : null}
          {withStart && !committed ? <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} aria-label={tx({ en: 'Start', ru: 'Начало', kk: 'Басталуы' })} className="h-10 rounded-[12px] bg-bg px-3 t-body text-text outline-none hairline" /> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {d.status !== 'IN_PROGRESS' ? <Button full={false} disabled={busy} onClick={() => void act({ action: 'dispatch', message: 'Work started' }, tx({ en: 'Work started · residents notified', ru: 'Работы начались · жители уведомлены', kk: 'Жұмыс басталды' }))}><Icon name="bus" size={17} />{tx({ en: 'Work started', ru: 'Работы начались', kk: 'Жұмыс басталды' })}</Button> : null}
        <Button full={false} style="outline" disabled={busy} onClick={() => void act({ action: 'request_evidence' }, tx({ en: 'Evidence requested', ru: 'Запрошены доказательства', kk: 'Дәлел сұралды' }))}><Icon name="camera" size={16} />{tx({ en: 'Request evidence', ru: 'Запросить доказательства', kk: 'Дәлел сұрау' })}</Button>
        {d.evidence_requested_at ? <span className="self-center t-meta text-amber">{tx({ en: 'Evidence requested', ru: 'Доказательства запрошены', kk: 'Дәлел сұралды' })}</span> : null}
      </div>
      <CompletionForm d={d} busy={busy} act={act} />
    </section>
  )
}

/** "Done" is not enough: what was done, when, and (for a visible fix) an after photo. */
function CompletionForm({ d, busy, act }: { d: StaffDetail; busy: boolean; act: (b: unknown, m?: string) => Promise<boolean> }) {
  const { tx } = useApp()
  const [note, setNote] = useState('')
  const [cause, setCause] = useState('')
  const [photos, setPhotos] = useState<EvidencePhoto[]>([])
  const pick = async (kind: 'before' | 'after', files: FileList | null) => {
    if (!files?.[0]) return
    // Demo incidents may borrow the incident location when the laptop is not in Aktau.
    const p = await photoFromFile(files[0], kind, d.is_demo && d.lat != null && d.lon != null ? { lat: d.lat, lon: d.lon } : null)
    setPhotos((xs) => [...xs.filter((x) => x.kind !== kind), p])
  }
  const hasAfter = photos.some((p) => p.kind === 'after') || d.evidence.some((p) => p.kind === 'after')
  const blocked = note.trim().length < 5 || (d.needs_after_photo && !hasAfter)
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex items-center justify-between"><h3 className="t-row text-text">{tx({ en: 'Report completion', ru: 'Отчёт о выполнении', kk: 'Орындалу есебі' })}</h3><span className="t-meta text-faint">{d.needs_after_photo ? tx({ en: '“After” photo required', ru: 'Нужно фото «после»', kk: '«Кейін» фотосы керек' }) : tx({ en: 'Photo optional for outages', ru: 'Для отключений фото необязательно', kk: 'Фото міндетті емес' })}</span></div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={tx({ en: 'What was done, e.g. Replaced the damaged pipe section', ru: 'Выполненные работы, напр. Заменён повреждённый участок трубы', kk: 'Не істелді' })} className="w-full resize-none rounded-[14px] bg-bg p-3 t-body text-text outline-none hairline placeholder:text-faint" />
      <input value={cause} onChange={(e) => setCause(e.target.value)} placeholder={tx({ en: 'Cause, if the team states it (optional)', ru: 'Причина со слов исполнителя (необязательно)', kk: 'Себебі (міндетті емес)' })} className="h-10 rounded-[12px] bg-bg px-3 t-body text-text outline-none hairline placeholder:text-faint" />
      <div className="grid grid-cols-2 gap-2">
        {(['before', 'after'] as const).map((k) => {
          const ph = photos.find((x) => x.kind === k) ?? d.evidence.find((x) => x.kind === k)
          return (
            <label key={k} className="tap relative flex aspect-[5/3] cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[14px] bg-bg text-secondary hairline hover:text-text">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {ph?.image ? <img src={ph.image} alt={k} className="absolute inset-0 h-full w-full object-cover" /> : <><Icon name="camera" size={20} /><span className="t-meta font-bold">{k === 'before' ? tx({ en: 'Before (if available)', ru: 'До (если есть)', kk: 'Дейін' }) : tx({ en: 'After', ru: 'После', kk: 'Кейін' })}</span></>}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void pick(k, e.target.files)} />
            </label>
          )
        })}
      </div>
      <Button style="primary" disabled={busy || blocked} onClick={async () => { const ok = await act({ action: 'complete', note: note.trim(), photos, cause: cause.trim() || null }, tx({ en: 'Completion sent · affected residents asked to verify', ru: 'Отчёт отправлен · затронутых жителей попросили проверить', kk: 'Есеп жіберілді' })); if (ok) { setNote(''); setCause(''); setPhotos([]) } }}>
        <Icon name="check" size={17} />{tx({ en: 'Submit completion', ru: 'Сообщить о выполнении', kk: 'Орындалғанын хабарлау' })}
      </Button>
      <p className="t-meta text-faint">{tx({ en: 'The residents who reported or confirmed it are asked whether it is really fixed; their answers close or reopen it. The photo check only advises.', ru: 'Жителей, которые сообщили или подтвердили проблему, спросят, действительно ли она решена; их ответы закроют или откроют заявку снова. Проверка фото только подсказывает.', kk: 'Хабарлаған не растаған тұрғындардан сұралады; олардың жауабы шешеді.' })}</p>
    </div>
  )
}

/** Everything else an operator may need: escalate, merge a duplicate, set the affected area, reassign, reject with a reason. */
function MorePanel({ d, all, busy, act }: { d: StaffDetail; all: IncidentDTO[]; busy: boolean; act: (b: unknown, m?: string) => Promise<boolean> }) {
  const { lang, tx } = useApp()
  const [reason, setReason] = useState('')
  const [into, setInto] = useState('')
  const [kind, setKind] = useState<'radius' | 'buildings' | 'area' | 'city'>(d.scope_kind === 'buildings' || d.scope_kind === 'building' ? 'buildings' : d.scope_kind === 'area' || d.scope_kind === 'areas' ? 'area' : d.scope_kind === 'city' ? 'city' : 'radius')
  const [radius, setRadius] = useState(d.scope_radius_m ?? 150)
  const [houses, setHouses] = useState(d.scope_houses.join(', '))
  const [areas, setAreas] = useState(d.scope_areas.join(', ') || d.designator || '')
  const [title, setTitle] = useState(d.public_title ?? '')
  const [open, setOpen] = useState<'escalate' | 'merge' | 'scope' | 'title' | 'reject' | 'reassign' | null>(null)
  const candidates = all.filter((i) => i.id !== d.id && !['RESOLVED', 'VERIFIED', 'REJECTED'].includes(i.status) && (i.demo_session_id ?? null) === (d.demo_session_id ?? null) && (i.service === d.service || i.area_id === d.area_id)).slice(0, 6)
  const closedish = ['RESOLVED', 'VERIFIED', 'EVIDENCE_SUBMITTED'].includes(d.status)
  const tab = (k: NonNullable<typeof open>, l: { en: string; ru: string; kk: string }, icon: IconName) => (
    <button type="button" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k} className={`tap inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold ${open === k ? 'bg-text text-bg' : 'bg-bg text-secondary hairline'}`}><Icon name={icon} size={14} />{tx(l)}</button>
  )
  return (
    <section className="flex flex-col gap-3 rounded-[22px] bg-surface p-4 hairline">
      <div className="flex flex-wrap gap-2">
        {tab('scope', { en: 'Affected area', ru: 'Зона затрагивания', kk: 'Аумақ' }, 'pin')}
        {!closedish ? tab('escalate', { en: 'Escalate', ru: 'Эскалировать', kk: 'Эскалация' }, 'alert') : null}
        {!closedish ? tab('merge', { en: 'Merge duplicate', ru: 'Объединить дубликат', kk: 'Біріктіру' }, 'merge') : null}
        {d.status !== 'NEW' && !closedish ? tab('reassign', { en: 'Reassign', ru: 'Переназначить', kk: 'Қайта тағайындау' }, 'route') : null}
        {tab('title', { en: 'Public title', ru: 'Заголовок', kk: 'Тақырып' }, 'sparkle')}
        {d.status === 'NEW' ? tab('reject', { en: 'Reject with a reason', ru: 'Отклонить с причиной', kk: 'Себеппен бас тарту' }, 'x') : null}
      </div>
      {open === 'scope' ? (
        <div className="flex flex-col gap-2.5">
          <p className="t-meta text-secondary">{tx({ en: 'Now', ru: 'Сейчас', kk: 'Қазір' })}: {scopeText(lang, d)}</p>
          <div className="flex flex-wrap gap-1.5">{(['radius', 'buildings', 'area', 'city'] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={`tap h-8 rounded-full px-3 text-[12px] font-bold ${kind === k ? 'bg-text text-bg' : 'bg-bg text-secondary hairline'}`}>{tx({ radius: { en: 'Radius', ru: 'Радиус', kk: 'Радиус' }, buildings: { en: 'Houses', ru: 'Дома', kk: 'Үйлер' }, area: { en: 'Microdistricts', ru: 'Микрорайоны', kk: 'Шағын аудандар' }, city: { en: 'Whole city', ru: 'Весь город', kk: 'Бүкіл қала' } }[k])}</button>)}</div>
          {kind === 'radius' ? <label className="flex items-center gap-3 t-sub text-text"><input type="range" min={50} max={2000} step={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="flex-1" /><span className="t-mono w-16 text-right">{radius} m</span></label> : null}
          {kind === 'buildings' ? <input value={houses} onChange={(e) => setHouses(e.target.value)} placeholder={tx({ en: `Houses in ${d.designator ?? ''} mkr: 37, 38, 40`, ru: `Дома в ${d.designator ?? ''} мкр: 37, 38, 40`, kk: 'Үйлер: 37, 38, 40' })} className="h-10 rounded-[12px] bg-bg px-3 t-body text-text outline-none hairline placeholder:text-faint" /> : null}
          {kind === 'area' ? <input value={areas} onChange={(e) => setAreas(e.target.value)} placeholder={tx({ en: 'Microdistricts: 14, 15', ru: 'Микрорайоны: 14, 15', kk: 'Шағын аудандар: 14, 15' })} className="h-10 rounded-[12px] bg-bg px-3 t-body text-text outline-none hairline placeholder:text-faint" /> : null}
          <Button size="sm" full={false} disabled={busy} onClick={() => void act({ action: 'scope', scope: kind === 'radius' ? { kind, radius_m: radius } : kind === 'buildings' ? { kind, houses: houses.split(/[,\s]+/).filter(Boolean) } : kind === 'area' ? { kind: 'areas', designators: areas.split(/[,\s]+/).filter(Boolean) } : { kind: 'city' } }, tx({ en: 'Affected area updated', ru: 'Зона обновлена', kk: 'Аумақ жаңартылды' }))}>{tx({ en: 'Apply', ru: 'Применить', kk: 'Қолдану' })}</Button>
        </div>
      ) : null}
      {open === 'escalate' || open === 'reject' ? (
        <div className="flex flex-wrap gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={open === 'reject' ? tx({ en: 'Why this is not a city incident', ru: 'Почему это не городской инцидент', kk: 'Неге бұл қала оқиғасы емес' }) : tx({ en: 'Why it needs escalation', ru: 'Почему нужна эскалация', kk: 'Неге эскалация керек' })} className="h-11 min-w-[220px] flex-1 rounded-[13px] bg-bg px-3 t-body text-text outline-none hairline placeholder:text-faint" />
          <Button full={false} size="sm" style={open === 'reject' ? 'danger' : 'secondary'} disabled={busy || reason.trim().length < 2} onClick={async () => { const ok = await act(open === 'reject' ? { action: 'close_rejected', reason: reason.trim() } : { action: 'escalate', reason: reason.trim() }, open === 'reject' ? tx({ en: 'Rejected · residents told why', ru: 'Отклонено · жителям сообщена причина', kk: 'Бас тартылды' }) : tx({ en: 'Escalated', ru: 'Эскалировано', kk: 'Эскалацияланды' })); if (ok) { setReason(''); setOpen(null) } }}>{open === 'reject' ? tx({ en: 'Reject', ru: 'Отклонить', kk: 'Бас тарту' }) : tx({ en: 'Escalate', ru: 'Эскалировать', kk: 'Эскалация' })}</Button>
        </div>
      ) : null}
      {open === 'merge' ? (
        <div className="flex flex-col gap-2">
          <p className="t-meta text-secondary">{tx({ en: 'Move this incident’s reports and confirmations into another one. Nobody is counted twice.', ru: 'Перенести обращения и подтверждения в другой инцидент. Никто не будет учтён дважды.', kk: 'Өтініштер мен растауларды басқа оқиғаға көшіру.' })}</p>
          {candidates.map((c) => <button key={c.id} type="button" onClick={() => setInto(c.code)} className={`tap flex items-center justify-between gap-2 rounded-[12px] px-3 py-2 text-left ${into === c.code ? 'bg-beam-soft beam-edge' : 'bg-bg hairline'}`}><span className="t-sub text-text">{c.code} · {incidentHeading(lang, c)} · {placeText(lang, c)}</span><span className="t-mono text-[11px] text-faint">{c.residents}</span></button>)}
          <div className="flex gap-2">
            <input value={into} onChange={(e) => setInto(e.target.value)} placeholder="INC-1042" className="h-10 flex-1 rounded-[12px] bg-bg px-3 t-body text-text outline-none hairline placeholder:text-faint" />
            <Button size="sm" full={false} disabled={busy || !/^INC-\d+$/i.test(into.trim())} onClick={() => void act({ action: 'merge', into: into.trim().toUpperCase() }, tx({ en: 'Merged', ru: 'Объединено', kk: 'Біріктірілді' }))}><Icon name="merge" size={15} />{tx({ en: 'Merge into', ru: 'Объединить с', kk: 'Біріктіру' })} {into.trim().toUpperCase()}</Button>
          </div>
        </div>
      ) : null}
      {open === 'reassign' ? <AssignPanel d={d} all={all} busy={busy} act={act} /> : null}
      {open === 'title' ? (
        <div className="flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={incidentHeading(lang, { ...d, public_title: null })} className="h-10 flex-1 rounded-[12px] bg-bg px-3 t-body text-text outline-none hairline placeholder:text-faint" />
          <Button size="sm" full={false} disabled={busy} onClick={() => void act({ action: 'title', title: title.trim() }, tx({ en: 'Title saved', ru: 'Заголовок сохранён', kk: 'Сақталды' }))}>{tx({ en: 'Save', ru: 'Сохранить', kk: 'Сақтау' })}</Button>
        </div>
      ) : null}
    </section>
  )
}

/** What the affected residents answered, live; the aggregate closes or reopens. The operator can step in. */
function VerificationPanel({ d, busy, act }: { d: StaffDetail; busy: boolean; act: (b: unknown, m?: string) => Promise<boolean> }) {
  const { tx } = useApp()
  const [reason, setReason] = useState('')
  const [formal, setFormal] = useState(false)
  const v = d.verification
  if (v.round < 1 && !['EVIDENCE_SUBMITTED', 'RESOLVED', 'VERIFIED'].includes(d.status)) return null
  const n = v.yes + v.partial + v.no
  const q = checkResponse(d.response_text ?? '', { lang: 'ru', service: d.service, designator: d.designator, hasEvidence: d.evidence.length > 0, needsEvidence: true })
  return (
    <section className={`flex flex-col gap-4 rounded-[22px] p-5 ${d.status === 'VERIFIED' ? 'bg-green-soft' : d.status === 'DISPUTED' ? 'bg-red-soft' : 'bg-surface hairline'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-row text-text">{tx({ en: 'Residents’ verification', ru: 'Проверка жителями', kk: 'Тұрғындар тексеруі' })}{v.round > 1 ? ` · ${tx({ en: 'round', ru: 'раунд', kk: 'кезең' })} ${v.round}` : ''}</h2>
        <span className="t-meta text-secondary">{tx({ en: 'eligible', ru: 'могут ответить', kk: 'жауап бере алады' })}: {v.eligible} · {tx({ en: 'quorum', ru: 'кворум', kk: 'кворум' })}: {v.quorum}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Tile v={n} l={tx({ en: 'answers', ru: 'ответов', kk: 'жауап' })} />
        <Tile v={v.yes} l={tx({ en: 'yes, fully', ru: 'да, полностью', kk: 'иә' })} />
        <Tile v={v.partial} l={tx({ en: 'partly', ru: 'частично', kk: 'ішінара' })} />
        <Tile v={v.no} l={tx({ en: 'no', ru: 'нет', kk: 'жоқ' })} red={v.no > 0} />
      </div>
      {n ? <div className="flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden><span className="bg-green transition-[width] duration-700" style={{ width: `${(v.yes / n) * 100}%` }} /><span className="bg-amber transition-[width] duration-700" style={{ width: `${(v.partial / n) * 100}%` }} /><span className="bg-red transition-[width] duration-700" style={{ width: `${(v.no / n) * 100}%` }} /></div> : null}
      <p className="t-card text-text">{n ? `${v.pct}% ${tx({ en: 'confirmed it is fixed', ru: 'подтвердили устранение', kk: 'шешілгенін растады' })} · ` : ''}{tx(
        v.outcome === 'verified' || d.status === 'VERIFIED' ? { en: 'Closed as verified by residents', ru: 'Закрыто: подтверждено жителями', kk: 'Тұрғындар растады' }
        : d.status === 'DISPUTED' ? { en: 'Reopened after residents checked', ru: 'Повторно открыто после проверки жителей', kk: 'Қайта ашылды' }
        : v.outcome === 'review' ? { en: 'Mixed answers: your decision', ru: 'Ответы разошлись: решает оператор', kk: 'Жауаптар әртүрлі: оператор шешеді' }
        : { en: 'Waiting for answers', ru: 'Ждём ответов', kk: 'Жауап күтудеміз' })}</p>
      {v.quality != null || v.speed != null ? <p className="t-meta text-secondary">{v.quality != null ? `${tx({ en: 'Quality', ru: 'Качество', kk: 'Сапа' })} ${v.quality.toFixed(1)}/5` : ''}{v.speed != null ? ` · ${tx({ en: 'Speed', ru: 'Скорость', kk: 'Жылдамдық' })} ${v.speed.toFixed(1)}/5` : ''}</p> : null}
      {d.status !== 'DISPUTED' ? (
        <div className="flex flex-wrap gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx({ en: 'Reason (shown to residents)', ru: 'Причина (увидят жители)', kk: 'Себебі' })} className="h-10 min-w-[200px] flex-1 rounded-[12px] bg-bg px-3 t-body text-text outline-none hairline placeholder:text-faint" />
          {d.status === 'EVIDENCE_SUBMITTED' ? <Button size="sm" full={false} style="outline" disabled={busy || reason.trim().length < 2} onClick={async () => { if (await act({ action: 'resolve', force: true, reason: reason.trim() }, tx({ en: 'Closed by 109', ru: 'Закрыто оператором', kk: '109 жапты' }))) setReason('') }}>{tx({ en: 'Close without waiting', ru: 'Закрыть, не дожидаясь', kk: 'Күтпей жабу' })}</Button> : null}
          <Button size="sm" full={false} style="danger" disabled={busy || reason.trim().length < 2} onClick={async () => { if (await act({ action: 'reopen', reason: reason.trim() }, tx({ en: 'Reopened · residents notified', ru: 'Открыто снова · жители уведомлены', kk: 'Қайта ашылды' }))) setReason('') }}>{tx({ en: 'Back to work', ru: 'Вернуть в работу', kk: 'Жұмысқа қайтару' })}</Button>
        </div>
      ) : null}
      <button type="button" onClick={() => setFormal(!formal)} className="tap self-start t-meta font-bold text-secondary">{formal ? '−' : '+'} {tx({ en: 'Formal answer to the applicant (109 regulation)', ru: 'Официальный ответ заявителю (регламент 109)', kk: 'Өтініш берушіге ресми жауап' })}{d.response_text ? ` · ${Math.round(q.score * 100)}%` : ''}</button>
      {formal ? <FormalAnswer d={d} busy={busy} act={act} /> : null}
    </section>
  )
}

function FormalAnswer({ d, busy, act }: { d: StaffDetail; busy: boolean; act: (b: unknown, m?: string) => Promise<boolean> }) {
  const { tx } = useApp()
  const [text, setText] = useState(d.response_text ?? '')
  const q = checkResponse(text, { lang: 'ru', service: d.service, designator: d.designator, hasEvidence: d.evidence.length > 0, needsEvidence: true })
  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] bg-surface p-4 hairline">
      <div className="flex items-center justify-between"><span className="t-row text-text">{tx({ en: 'Answer', ru: 'Ответ', kk: 'Жауап' })}</span><CopilotTag>{tx({ en: 'Quality', ru: 'Качество', kk: 'Сапа' })} {Math.round(q.score * 100)}%</CopilotTag></div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="23 сентября в 10:40 …" className="w-full resize-none rounded-[14px] bg-bg p-3 t-body text-text outline-none hairline placeholder:text-faint" />
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">{q.checks.map((c) => <li key={c.key} className={`flex items-center gap-1.5 t-meta ${c.ok ? 'text-secondary' : 'text-red'}`}><Icon name={c.ok ? 'check' : 'x'} size={13} className={c.ok ? 'text-green' : 'text-red'} />{tx(CHECK[c.key] ?? { en: c.key, ru: c.key })}</li>)}</ul>
      <Button size="sm" style={q.verdict === 'good' ? 'primary' : 'outline'} disabled={busy || text.trim().length < 2} onClick={() => void act({ action: 'respond', text: text.trim() }, tx({ en: 'Answer saved', ru: 'Ответ сохранён', kk: 'Жауап сақталды' }))}><Icon name="send" size={15} />{tx({ en: 'Save answer', ru: 'Сохранить ответ', kk: 'Жауапты сақтау' })}</Button>
    </div>
  )
}

const CONTEXT: Record<string, { en: string; ru: string; kk: string }> = {
  home_in_scope: { en: 'home in the area', ru: 'дом в зоне', kk: 'үйі аймақта' }, home_nearby: { en: 'home nearby', ru: 'дом рядом', kk: 'үйі жақын' },
  here: { en: 'on the spot', ru: 'на месте', kk: 'орнында' }, session: { en: 'demo session', ru: 'демо-сессия', kk: 'демо-сессия' },
  elsewhere: { en: 'outside the area', ru: 'вне зоны', kk: 'аймақтан тыс' }, unknown: { en: 'no saved home', ru: 'дом не указан', kk: 'үй көрсетілмеген' },
}

/** Every confirmation is a record: who (anonymous), where they stood, what they added. */
function Confirmations({ d }: { d: StaffDetail }) {
  const { tx } = useApp()
  if (!d.confirmations.length) return null
  const yes = d.confirmations.filter((c) => c.state === 'confirmed')
  const no = d.confirmations.filter((c) => c.state === 'not_affected')
  return (
    <section className="flex flex-col gap-2 rounded-[22px] bg-surface p-5 hairline">
      <h2 className="t-row mb-1 text-text">{tx({ en: 'Confirmations', ru: 'Подтверждения', kk: 'Растаулар' })} · {yes.length}{no.length ? <span className="t-meta text-faint"> · {no.length} {tx({ en: 'said it does not affect them', ru: 'ответили «не затрагивает»', kk: 'қатысы жоқ деді' })}</span> : null}</h2>
      <div className="flex flex-col gap-1.5">
        {yes.slice(0, 40).map((c) => (
          <div key={c.id} className="flex items-start gap-3 rounded-[12px] bg-bg px-3 py-2 hairline">
            <Icon name="people" size={14} className="mt-0.5 text-blue" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="t-meta text-text" suppressHydrationWarning>{fmtTime(new Date(c.created_at))} · {tx(CONTEXT[c.context] ?? CONTEXT.unknown!)}{c.distance_m != null ? ` · ${c.distance_m} m` : ''}{c.designator ? ` · ${c.designator}/${c.house ?? '–'}` : ''}</span>
              {c.note ? <span className="t-sub text-secondary">{c.note}</span> : null}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {c.photo ? <a href={c.photo} target="_blank" rel="noreferrer"><img src={c.photo} alt="" className="size-12 rounded-[10px] object-cover" /></a> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

type SignalCheck = { outcome: string; flags: string[]; reasons: string[]; sent_anyway?: boolean; ai: { verdict: string; photo: string; photo_note: string; engine: string } | null }
const FLAG: Record<string, { en: string; ru: string; kk: string }> = {
  ai_suspicious: { en: 'AI: doubtful', ru: 'ИИ: сомнительно', kk: 'ЖИ: күмәнді' }, ai_spam: { en: 'AI: not a city problem', ru: 'ИИ: не городская проблема', kk: 'ЖИ: қала мәселесі емес' },
  photo_mismatch: { en: 'photo does not match', ru: 'фото не совпадает', kk: 'фото сәйкес емес' }, photo_reused: { en: 'photo sent before from another phone', ru: 'фото уже присылали с другого телефона', kk: 'фото басқа телефоннан жіберілген' },
  link: { en: 'contains a link', ru: 'есть ссылка', kk: 'сілтеме бар' }, burst: { en: 'many reports in an hour', ru: 'много обращений за час', kk: 'бір сағатта көп өтініш' },
  ai_unavailable: { en: 'AI check unavailable', ru: 'ИИ-проверка недоступна', kk: 'ЖИ тексеруі қолжетімсіз' },
  gibberish: { en: 'unreadable text', ru: 'непонятный текст', kk: 'түсініксіз мәтін' }, advert: { en: 'advert', ru: 'реклама', kk: 'жарнама' }, duplicate: { en: 'resent', ru: 'повтор', kk: 'қайталау' },
}

/** The report check as the operator sees it: passed, or what to look at. Advice only; the operator decides. */
function CheckChip({ c }: { c: SignalCheck }) {
  const { tx } = useApp()
  const doubts = c.flags.filter((f) => f !== 'ai_unavailable')
  const ok = !doubts.length && !c.sent_anyway
  return (
    <div className={`mt-1 flex flex-col gap-1 rounded-[12px] px-3 py-2 ${ok ? 'bg-green-soft' : 'bg-amber-soft'}`}>
      <span className={`flex flex-wrap items-center gap-1.5 t-meta font-bold ${ok ? 'text-green' : 'text-amber'}`}>
        <Icon name={ok ? 'check' : 'alert'} size={13} />
        {ok ? tx({ en: 'Spam check passed', ru: 'Проверка на спам пройдена', kk: 'Спам тексеруі өтті' }) : tx({ en: 'Spam check: take a look', ru: 'Проверка на спам: посмотрите', kk: 'Спам тексеруі: қараңыз' })}
        {c.sent_anyway ? <span className="font-semibold">· {tx({ en: 'resident sent anyway', ru: 'житель отправил несмотря на предупреждение', kk: 'тұрғын бәрібір жіберді' })}</span> : null}
      </span>
      {c.flags.length ? <span className="t-meta text-secondary">{c.flags.map((f) => tx(FLAG[f] ?? { en: f, ru: f, kk: f })).join(' · ')}</span> : null}
      {c.reasons.length ? <span className="t-meta text-secondary">{c.reasons.join('; ')}</span> : null}
      {c.ai ? <span className="t-mono text-[10px] text-faint">{c.ai.engine} · {c.ai.verdict}{c.ai.photo !== 'none' ? ` · photo ${c.ai.photo}` : ''}</span> : null}
    </div>
  )
}

async function photoFromFile(file: File, kind: 'before' | 'after', fallback: { lat: number; lon: number } | null): Promise<EvidencePhoto> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 520 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const image = c.toDataURL('image/jpeg', 0.72)
  // 8×8 average hash + mean brightness: what the evidence check compares.
  const h = document.createElement('canvas'); h.width = h.height = 8
  const g = h.getContext('2d')!; g.drawImage(bmp, 0, 0, 8, 8)
  const px = g.getImageData(0, 0, 8, 8).data
  const lum: number[] = []
  for (let i = 0; i < 64; i++) lum.push(0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!)
  const mean = lum.reduce((a, b) => a + b, 0) / 64
  let bits = ''
  for (const l of lum) bits += l >= mean ? '1' : '0'
  const hash = Array.from({ length: 16 }, (_, i) => parseInt(bits.slice(i * 4, i * 4 + 4), 2).toString(16)).join('')
  const geo = await new Promise<{ lat: number; lon: number } | null>((res) => {
    if (!navigator.geolocation) return res(null)
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null), { timeout: 3000 })
  })
  const at = geo && geo.lat > 43 && geo.lat < 44.5 ? geo : fallback
  return { kind, lat: at?.lat ?? null, lon: at?.lon ?? null, captured_at: new Date(file.lastModified || Date.now()).toISOString(), hash, brightness: Number((mean / 255).toFixed(2)), image }
}

/** Live demo sessions: an audience joins by QR, the same pipeline runs. */
function LiveSessions() {
  const { tx } = useApp()
  const [list, setList] = useState<Array<{ id: string; code: string; title: string; venue: string; status: string; members: number; incidents: number }> | null>(null)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('Smart City Aktau Hackathon')
  const [venue, setVenue] = useState('Mangystau Hub')
  const load = useCallback(async () => { try { setList((await api<{ sessions: NonNullable<typeof list> }>('/api/ops/live')).sessions) } catch { setList([]) } }, [])
  useEffect(() => { void load() }, [load])
  useRealtime(() => void load(), ['incidents'], { wait: 800, filter: (e) => e.kind === 'session_member' || e.kind === 'session_ended' })
  return (
    <section className="flex flex-col gap-3 rounded-[20px] bg-demo-soft p-4">
      <div className="flex items-center justify-between"><p className="t-label text-demo">{tx({ en: 'Live demo sessions', ru: 'Живые демо-сессии', kk: 'Тірі демо-сессиялар' })}</p><Icon name="people" size={15} className="text-demo" /></div>
      <p className="t-meta text-secondary">{tx({ en: 'The audience scans a QR code (no sign-up, no GPS) and becomes the affected residents of one place. The same incident pipeline runs.', ru: 'Зрители сканируют QR-код (без регистрации и GPS) и становятся жителями одной локации. Работает тот же конвейер инцидентов.', kk: 'Көрермендер QR-кодты сканерлейді және бір орынның тұрғындары болады.' })}</p>
      <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 rounded-[11px] bg-surface px-3 t-sub text-text outline-none hairline" aria-label="Title" />
      <input value={venue} onChange={(e) => setVenue(e.target.value)} className="h-9 rounded-[11px] bg-surface px-3 t-sub text-text outline-none hairline" aria-label="Venue" />
      <Button size="sm" style="outline" disabled={busy || title.trim().length < 2 || venue.trim().length < 2} onClick={async () => {
        setBusy(true)
        try { const r = await api<{ code: string }>('/api/ops/live', { title: title.trim(), venue: venue.trim() }); window.open(`/live/${r.code}/present`, '_blank') ; void load() } finally { setBusy(false) }
      }}><Icon name="plus" size={15} />{tx({ en: 'Create a session', ru: 'Создать сессию', kk: 'Сессия құру' })}</Button>
      {list?.filter((x) => x.status === 'active').slice(0, 4).map((x) => (
        <Link key={x.id} href={`/live/${x.code}/present`} target="_blank" className="tap flex items-center justify-between gap-2 rounded-[12px] bg-surface px-3 py-2 hairline">
          <span className="flex min-w-0 flex-col"><span className="t-row truncate text-text">{x.title}</span><span className="t-meta text-secondary">/live/{x.code} · {x.members} {tx({ en: 'connected', ru: 'подключено', kk: 'қосылды' })}</span></span>
          <Icon name="external" size={14} className="text-faint" />
        </Link>
      ))}
    </section>
  )
}

function DemoControls({ onDone }: { onDone: () => void }) {
  const { tx } = useApp()
  const [busy, setBusy] = useState(false)
  return (
    <section className="flex flex-col gap-2 rounded-[20px] bg-demo-soft p-4">
      <p className="t-label text-demo">Demo</p>
      <p className="t-meta text-secondary">{tx({ en: 'A labelled 109 scenario through the real engine: 10 incidents, 43 reports, every stage.', ru: 'Помеченный сценарий 109 через настоящий движок: 10 инцидентов, 43 обращения, все стадии.', kk: 'Нақты қозғалтқыш арқылы белгіленген 109 сценарийі.' })}</p>
      <Button size="sm" style="outline" disabled={busy} onClick={async () => { setBusy(true); try { await api('/api/ops/demo', {}); onDone() } finally { setBusy(false) } }}>{tx({ en: 'Reload demo scenario', ru: 'Перезагрузить сценарий', kk: 'Сценарийді қайта жүктеу' })}</Button>
      <Link href="/demo" className="tap t-meta font-bold text-demo">{tx({ en: 'Open the split-screen jury demo →', ru: 'Открыть демо для жюри (два экрана) →', kk: 'Қазылар демосы →' })}</Link>
      <Link href="/copilot/pilot" className="tap t-meta font-bold text-demo">{tx({ en: 'Pilot simulation: 10 000 messages →', ru: 'Симуляция пилота: 10 000 обращений →', kk: 'Пилот симуляциясы: 10 000 өтініш →' })}</Link>
    </section>
  )
}

export type { IconName }
