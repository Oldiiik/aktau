'use client'
// Pilot simulation · 109 Copilot. One button runs a generated week of resident
// messages (10 000 by default) through the 109 engine and shows, against the
// week's known ground truth: how many real problems there were and how many
// incidents 109 got, whether the right residents were told, what the spam gate
// stopped, whether danger came first, and every mistake with its reason.
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { IncidentService } from '@aktau/city-core'
import type { PilotResult } from '@aktau/server'
import { useApp, type L3 } from './app'
import { Badge, Button, Card, Icon, Meter } from './primitives'
import { REASON, SERVICE_ICON } from './incident-ui'

type Progress = { processed: number; total: number; incidents: number; joined: number; blocked: number; ms: number }
type Tx = (s: L3) => string

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ')
const pct = (x: number | null | undefined) => (x == null ? '–' : `${x.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`)

const PROBLEM: Record<string, L3> = {
  water_net: { en: 'No water (network)', ru: 'Нет воды (сеть)', kk: 'Су жоқ (желі)' },
  power_net: { en: 'Power outage (network)', ru: 'Нет света (сеть)', kk: 'Жарық жоқ (желі)' },
  hotwater_net: { en: 'No hot water', ru: 'Нет горячей воды', kk: 'Ыстық су жоқ' },
  heating_net: { en: 'No heating', ru: 'Нет отопления', kk: 'Жылу жоқ' },
  water_flat: { en: 'No water in one flat', ru: 'Нет воды в одной квартире', kk: 'Бір пәтерде су жоқ' },
  power_flat: { en: 'No power in one flat', ru: 'Нет света в одной квартире', kk: 'Бір пәтерде жарық жоқ' },
  leak: { en: 'Burst pipe / leak', ru: 'Прорыв трубы / течь', kk: 'Құбыр жарылды' },
  streetlight: { en: 'Street lights out', ru: 'Не горят фонари', kk: 'Шамдар жанбайды' },
  garbage: { en: 'Waste not collected', ru: 'Не вывозят мусор', kk: 'Қоқыс шығарылмаған' },
  road: { en: 'Pothole', ru: 'Яма на дороге', kk: 'Жолда шұңқыр' },
  elevator: { en: 'Elevator stopped', ru: 'Не работает лифт', kk: 'Лифт істемейді' },
  sewer: { en: 'Sewer blockage', ru: 'Засор канализации', kk: 'Кәріз бітелген' },
  yard: { en: 'Yard / playground', ru: 'Двор / площадка', kk: 'Аула / алаң' },
  transport: { en: 'Bus stop / route', ru: 'Остановка / маршрут', kk: 'Аялдама / бағыт' },
  manhole: { en: 'Open manhole', ru: 'Открытый люк', kk: 'Ашық люк' },
  gas: { en: 'Smell of gas', ru: 'Запах газа', kk: 'Газ иісі' },
  facade: { en: 'Facade hazard', ru: 'Опасность на фасаде', kk: 'Қасбет қауіпті' },
  wires: { en: 'Live wires', ru: 'Оголённые провода', kk: 'Ашық сымдар' },
}
const PROBLEM_ICON: Record<string, IncidentService> = {
  water_net: 'water', power_net: 'electricity', hotwater_net: 'hot_water', heating_net: 'heating', water_flat: 'water', power_flat: 'electricity', leak: 'water',
  streetlight: 'streetlight', garbage: 'garbage', road: 'road', elevator: 'elevator', sewer: 'sewer', yard: 'yard', transport: 'transport', manhole: 'sewer',
  gas: 'gas', facade: 'building_safety', wires: 'electricity',
}
const GROUP: Record<string, L3> = {
  outages: { en: 'Network outages (water, power, heat)', ru: 'Отключения сети (вода, свет, тепло)', kk: 'Желі ажыратулары' },
  street: { en: 'In the street (lights, waste, roads, leaks)', ru: 'На улице (фонари, мусор, дороги, течи)', kk: 'Көшеде' },
  dangers: { en: 'Dangers (gas, manholes, wires, facades)', ru: 'Опасности (газ, люки, провода, фасады)', kk: 'Қауіптер' },
  building: { en: 'One building or flat (elevator, sewer, a flat)', ru: 'Один дом или квартира (лифт, канализация, квартира)', kk: 'Бір үй немесе пәтер' },
  false_reports: { en: 'Fake reports, until 109 rejects them', ru: 'Ложные сообщения, пока 109 их не отклонит', kk: 'Жалған хабарлар' },
}
const CHANNEL: Record<string, L3> = {
  APP: { en: 'App', ru: 'Приложение', kk: 'Қосымша' }, PHONE: { en: 'Phone 109', ru: 'Звонок 109', kk: '109 қоңырау' }, WHATSAPP: { en: 'WhatsApp', ru: 'WhatsApp' },
  KOMEK109: { en: 'Komek 109', ru: 'Көмек 109' }, INSTAGRAM: { en: 'Instagram', ru: 'Instagram' },
}
const LANG: Record<string, L3> = { ru: { en: 'Russian', ru: 'Русский', kk: 'Орысша' }, kk: { en: 'Kazakh', ru: 'Казахский', kk: 'Қазақша' }, en: { en: 'English', ru: 'Английский', kk: 'Ағылшынша' }, mixed: { en: 'Mixed', ru: 'Смешанный', kk: 'Аралас' } }
const PRIORITY: Record<string, { label: L3; tone: 'active' | 'planned' | 'unknown' | 'neutral' }> = {
  CRITICAL: { label: { en: 'Critical', ru: 'Критический', kk: 'Сыни' }, tone: 'active' }, HIGH: { label: { en: 'High', ru: 'Высокий', kk: 'Жоғары' }, tone: 'planned' },
  NORMAL: { label: { en: 'Normal', ru: 'Обычный', kk: 'Қалыпты' }, tone: 'unknown' }, LOW: { label: { en: 'Low', ru: 'Низкий', kk: 'Төмен' }, tone: 'neutral' },
}
const SIZES = [1_000, 10_000, 25_000]

type Problem = { key: string; designator: string | null; house: string | null; buildings: number | null; zone: string }
const where = (tx: Tx, p: { designator: string | null; house: string | null }) =>
  p.designator ? `${/^\d/.test(p.designator) ? `${p.designator} ${tx({ en: 'mkr', ru: 'мкр', kk: 'ш/а' })}` : p.designator}${p.house ? `, ${tx({ en: 'house', ru: 'дом', kk: 'үй' })} ${p.house}` : ''}` : tx({ en: 'place unknown', ru: 'место неизвестно', kk: 'орны белгісіз' })
const orgShort = (org: string) => org.split(' · ')[0]!

export function PilotView({ initial }: { initial: PilotResult | null }) {
  const { tx } = useApp()
  const [result, setResult] = useState<PilotResult | null>(initial)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState(initial?.params.reports ?? 10_000)

  const run = useCallback(async (seed?: number) => {
    setRunning(true); setError(null); setProgress({ processed: 0, total: size, incidents: 0, joined: 0, blocked: 0, ms: 0 })
    try {
      const r = await fetch('/api/ops/pilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reports: size, ...(seed ? { seed } : {}) }) })
      if (!r.ok || !r.body) { const d = await r.json().catch(() => ({})); throw new Error(d.error?.message ?? `HTTP ${r.status}`) }
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (!line) continue
          const e = JSON.parse(line) as { type: string } & Record<string, unknown>
          if (e.type === 'progress') setProgress(e as unknown as Progress)
          else if (e.type === 'result') setResult(e.result as PilotResult)
          else if (e.type === 'error') throw new Error(String(e.message))
        }
      }
    } catch (e) { setError((e as Error).message) } finally { setRunning(false) }
  }, [size])

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <header className="rise flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/copilot" className="tap inline-flex h-8 items-center gap-1 rounded-full pr-2 t-sub font-semibold text-secondary hover:text-text"><Icon name="back" size={16} />109 Copilot</Link>
          <Badge tone="demo">{tx({ en: 'Simulation', ru: 'Симуляция', kk: 'Симуляция' })}</Badge>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="t-title text-text [text-wrap:balance]">{tx({ en: 'Pilot: a week of resident messages through the 109 engine', ru: 'Пилот: неделя обращений жителей через движок 109', kk: 'Пилот: тұрғындардың бір апталық өтініштері 109 қозғалтқышы арқылы' })}</h1>
          <p className="t-body max-w-[72ch] text-secondary">{tx({
            en: 'A generated week in Aktau with a known answer: which problems really happened, where, and who they affect. Residents write about them the way people do: Russian, Kazakh, English and a mix, by app, phone, WhatsApp, Instagram and Komek 109, with typos, repeats and spam. Every message goes through the same code as the live app, on the real city map. Every number below is checked against the ground truth.',
            ru: 'Сгенерированная неделя в Актау с известным ответом: какие проблемы были на самом деле, где и кого они касаются. Жители пишут о них так, как пишут люди: по-русски, по-казахски, по-английски и вперемешку, через приложение, звонок, WhatsApp, Instagram и «Көмек 109», с опечатками, повторами и спамом. Каждое сообщение проходит тот же код, что и в приложении, на настоящей карте города. Каждая цифра ниже сверена с правдой.',
            kk: 'Жауабы белгілі бір апта: қандай мәселелер болды, қайда және кімге әсер етті. Әр хабар қосымшадағы кодпен, қаланың нақты картасында өңделеді. Төмендегі әр сан шындықпен тексерілген.',
          })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-[14px] bg-surface p-1 card-shadow" role="radiogroup" aria-label={tx({ en: 'Messages in the week', ru: 'Сообщений за неделю', kk: 'Аптадағы хабарлар' })}>
            {SIZES.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={size === n} disabled={running} onClick={() => setSize(n)}
                className={`tap h-9 rounded-[11px] px-3.5 text-[13px] font-bold ${size === n ? 'bg-text text-bg' : 'text-secondary hover:text-text'}`}>{fmt(n)}</button>
            ))}
          </div>
          <Button full={false} disabled={running} onClick={() => void run()}>
            {running ? <><span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />{tx({ en: 'Simulating…', ru: 'Идёт симуляция…', kk: 'Симуляция жүріп жатыр…' })}</>
              : <><Icon name="radar" size={18} />{tx({ en: `Run: ${fmt(size)} messages`, ru: `Запустить: ${fmt(size)} обращений`, kk: `Іске қосу: ${fmt(size)} өтініш` })}</>}
          </Button>
          {result && !running ? (
            <Button full={false} style="outline" onClick={() => void run(result.params.seed)}>
              <Icon name="timer" size={16} />{tx({ en: `Replay week #${result.params.seed}`, ru: `Повторить неделю №${result.params.seed}`, kk: `№${result.params.seed} аптаны қайталау` })}
            </Button>
          ) : null}
        </div>
        {error ? <p className="t-sub text-red">{error}</p> : null}
      </header>

      {running && progress ? <Running p={progress} tx={tx} /> : null}
      {result && !running ? <Results r={result} tx={tx} /> : null}
      {!result && !running ? (
        <Card tone="soft" className="gap-2">
          <p className="t-row text-text">{tx({ en: 'No run yet', ru: 'Симуляция ещё не запускалась', kk: 'Симуляция әлі іске қосылмаған' })}</p>
          <p className="t-sub text-secondary">{tx({ en: 'Press Run: about two seconds for 10 000 messages on this computer.', ru: 'Нажмите «Запустить»: 10 000 обращений обрабатываются за пару секунд.', kk: '«Іске қосу» басыңыз: 10 000 өтініш бірнеше секундта.' })}</p>
        </Card>
      ) : null}
    </div>
  )
}

// ── While it runs ────────────────────────────────────────────────────────────
function Running({ p, tx }: { p: Progress; tx: Tx }) {
  return (
    <Card className="fade-in gap-5" padding={24}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="t-section text-text">{tx({ en: 'Messages go through the engine', ru: 'Сообщения идут через движок', kk: 'Хабарлар қозғалтқыштан өтуде' })}</p>
        <span className="t-mono t-meta text-secondary">{fmt(p.ms)} {tx({ en: 'ms of engine time', ru: 'мс работы движка', kk: 'мс' })}</span>
      </div>
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Big v={fmt(p.processed)} l={tx({ en: `of ${fmt(p.total)} processed`, ru: `из ${fmt(p.total)} обработано`, kk: `${fmt(p.total)} ішінен` })} />
        <Big v={fmt(p.joined)} l={tx({ en: 'joined a known problem', ru: 'присоединены к известной проблеме', kk: 'белгілі мәселеге қосылды' })} />
        <Big v={fmt(p.incidents)} l={tx({ en: 'incidents opened', ru: 'инцидентов открыто', kk: 'оқиға ашылды' })} accent />
        <Big v={fmt(p.blocked)} l={tx({ en: 'stopped before 109', ru: 'остановлено до 109', kk: '109-ға дейін тоқтатылды' })} />
      </div>
      <Meter value={p.total ? p.processed / p.total : 0} />
    </Card>
  )
}

function Big({ v, l, accent }: { v: ReactNode; l: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`font-[family-name:var(--font-display)] text-[34px] font-semibold leading-none tracking-[-0.03em] ${accent ? 'text-blue' : 'text-text'}`}>{v}</span>
      <span className="t-meta text-secondary">{l}</span>
    </div>
  )
}

// ── Results ──────────────────────────────────────────────────────────────────
function Results({ r, tx }: { r: PilotResult; tx: Tx }) {
  const d = r.dedup, n = r.notify
  const days = r.params.days
  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <p className="fade-in t-meta text-secondary">
        {tx({ en: `Week #${r.params.seed}: ${fmt(r.input.reports)} messages over ${days} days · ${fmt(r.city.buildings)} buildings in ${r.city.microdistricts} microdistricts · ${fmt(r.city.app_users)} residents with the app, ${fmt(r.city.with_saved_home)} of them with a saved home · engine time ${fmt(r.timing.engine_ms)} ms (${r.timing.per_report_ms} ms per message)`,
          ru: `Неделя №${r.params.seed}: ${fmt(r.input.reports)} обращений за ${days} дн. · ${fmt(r.city.buildings)} домов в ${r.city.microdistricts} микрорайонах · ${fmt(r.city.app_users)} жителей с приложением, ${fmt(r.city.with_saved_home)} из них указали дом · работа движка ${fmt(r.timing.engine_ms)} мс (${r.timing.per_report_ms} мс на обращение)`,
          kk: `№${r.params.seed} апта: ${fmt(r.input.reports)} өтініш · ${fmt(r.city.buildings)} үй · ${fmt(r.city.app_users)} тұрғын · ${fmt(r.timing.engine_ms)} мс` })}
      </p>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="blue" value={<>{fmt(r.input.reports)}<span className="px-1.5 text-faint">→</span>{fmt(d.incidents)}</>}
          label={tx({ en: 'messages → incidents for 109', ru: 'обращений → инцидентов для 109', kk: 'өтініш → 109 үшін оқиға' })}
          sub={tx({ en: `${d.problems} real problems in the week. The operator opens ${pct(d.cards_saved_pct)} fewer cards.`, ru: `Реальных проблем за неделю: ${d.problems}. Карточек у оператора на ${pct(d.cards_saved_pct)} меньше.`, kk: `Аптадағы нақты мәселелер: ${d.problems}.` })} />
        <Kpi value={pct(d.reports_placed_right)} label={tx({ en: 'of messages landed in their own problem’s incident', ru: 'сообщений попали в инцидент своей проблемы', kk: 'хабар өз мәселесінің оқиғасына түсті' })}
          sub={tx({ en: `${fmt(d.wrongly_merged_reports)} put with another problem · ${d.extra_incidents} extra incidents, ${d.extra_flagged_possible} of them shown to 109 as “possibly the same”`, ru: `${fmt(d.wrongly_merged_reports)} ошибочно объединены · ${d.extra_incidents} лишних инцидентов, ${d.extra_flagged_possible} из них Copilot показал оператору как «возможно, та же»`, kk: `${fmt(d.wrongly_merged_reports)} қате біріктірілді · ${d.extra_incidents} артық оқиға` })} />
        <Kpi value={<>{pct(n.precision)}<span className="px-1 text-[0.55em] font-medium text-faint">/</span>{pct(n.recall)}</>}
          label={tx({ en: 'residents told: right people / of those affected', ru: 'оповещения: точность / охват', kk: 'хабарландыру: дәлдік / қамту' })}
          sub={tx({ en: `${fmt(n.informed_residents)} residents told “this affects your home” or following their report. No one gets the same message twice.`, ru: `${fmt(n.informed_residents)} жителей узнали «это касается вашего дома» или следят за своим обращением. Одно сообщение одному человеку — один раз.`, kk: `${fmt(n.informed_residents)} тұрғын хабардар болды.` })} />
        <Kpi tone={r.safety.critical === r.safety.dangers ? 'green' : 'amber'} value={`${r.safety.critical} / ${r.safety.dangers}`}
          label={tx({ en: 'dangers got critical priority at once', ru: 'опасностей сразу получили критический приоритет', kk: 'қауіп бірден сыни басымдық алды' })}
          sub={tx({ en: `gas, open manholes, live wires, facades · none held back by the spam check (${r.safety.blocked})`, ru: `газ, открытые люки, провода, фасады · спам-фильтр не задержал ни одной (${r.safety.blocked})`, kk: `газ, люктер, сымдар, қасбеттер · спам-сүзгі ұстамады` })} />
      </section>

      <Flow r={r} tx={tx} />
      <Top r={r} tx={tx} />
      <Notify r={r} tx={tx} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Understanding r={r} tx={tx} />
        <Gate r={r} tx={tx} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Dangers r={r} tx={tx} />
        <Loop r={r} tx={tx} />
      </div>
      <Mistakes r={r} tx={tx} />
      <Method r={r} tx={tx} />
    </div>
  )
}

function Kpi({ value, label, sub, tone }: { value: ReactNode; label: string; sub: string; tone?: 'blue' | 'green' | 'amber' }) {
  return (
    <div className="rise flex flex-col gap-2 rounded-[22px] bg-surface p-5 card-shadow">
      <span className={`font-[family-name:var(--font-display)] text-[34px] font-semibold leading-none tracking-[-0.03em] ${tone === 'blue' ? 'text-blue' : tone === 'green' ? 'text-green' : tone === 'amber' ? 'text-amber' : 'text-text'}`}>{value}</span>
      <span className="t-row text-text">{label}</span>
      <span className="t-meta text-secondary">{sub}</span>
    </div>
  )
}

function Section({ title, sub, children, className = '' }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={`gap-4 ${className}`} padding={20}>
      <div className="flex flex-col gap-1">
        <h2 className="t-section text-text">{title}</h2>
        {sub ? <p className="t-sub max-w-[80ch] text-secondary">{sub}</p> : null}
      </div>
      {children}
    </Card>
  )
}

// ── The week's flow, hour by hour ────────────────────────────────────────────
function Flow({ r, tx }: { r: PilotResult; tx: Tx }) {
  const hours = r.input.per_hour
  const max = Math.max(1, ...hours.map((h) => h.reports))
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const start = new Date(r.params.start).getTime()
  const at = (i: number) => new Date(start + i * 3600_000)
  const local = (dt: Date) => new Date(dt.getTime() + 5 * 3600_000)
  const dayLabel = (dt: Date) => { const l = local(dt); return `${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][l.getUTCDay()]} ${l.getUTCDate()}` }
  const totals = hours.reduce((s, h) => ({ joined: s.joined + h.joined, incidents: s.incidents + h.incidents, blocked: s.blocked + h.blocked }), { joined: 0, incidents: 0, blocked: 0 })
  const W = 1000, Hh = 180, bw = W / hours.length
  const midnights = hours.map((_, i) => i).filter((i) => local(at(i)).getUTCHours() === 0)
  const h = hover != null ? hours[hover] : null
  const onMove = (e: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect()
    setHover(Math.max(0, Math.min(hours.length - 1, Math.floor(((e.clientX - rect.left) / rect.width) * hours.length))))
  }
  return (
    <Section title={tx({ en: 'The week, hour by hour', ru: 'Неделя по часам', kk: 'Апта сағат бойынша' })}
      sub={tx({ en: 'Each column is one hour of messages. Most join a problem 109 already knows about; only the blue part opens a new incident for an operator.', ru: 'Каждый столбец — один час обращений. Большинство присоединяется к проблеме, о которой 109 уже знает; новый инцидент для оператора открывает только синяя часть.', kk: 'Әр баған — бір сағаттық хабарлар. Көбі белгілі мәселеге қосылады; тек көк бөлігі жаңа оқиға ашады.' })}>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 t-meta text-secondary">
        <Key color="var(--blue)" label={tx({ en: `New incident · ${fmt(totals.incidents)}`, ru: `Новый инцидент · ${fmt(totals.incidents)}`, kk: `Жаңа оқиға · ${fmt(totals.incidents)}` })} />
        <Key color="color-mix(in srgb, var(--blue) 30%, var(--surface))" label={tx({ en: `Joined a known problem · ${fmt(totals.joined)}`, ru: `Присоединено к известной проблеме · ${fmt(totals.joined)}`, kk: `Белгілі мәселеге қосылды · ${fmt(totals.joined)}` })} />
        <Key color="var(--faint)" label={tx({ en: `Stopped (spam, no place) · ${fmt(totals.blocked)}`, ru: `Остановлено (спам, без места) · ${fmt(totals.blocked)}`, kk: `Тоқтатылды · ${fmt(totals.blocked)}` })} />
      </div>
      <div ref={box} className="relative select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" className="block h-[180px] w-full" role="img" aria-label={tx({ en: 'Messages per hour, split into new incidents, joined and stopped', ru: 'Обращения по часам: новые инциденты, присоединённые и остановленные', kk: 'Сағат сайынғы хабарлар' })}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={Hh - f * Hh} y2={Hh - f * Hh} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          {midnights.map((i) => <line key={i} x1={i * bw} x2={i * bw} y1={0} y2={Hh} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          {hours.map((x, i) => {
            const y = (v: number) => (v / max) * (Hh - 4)
            const hNew = y(x.incidents), hJoin = y(x.joined), hStop = y(x.blocked)
            const w = Math.max(1, bw - 1.2)
            return (
              <g key={i} opacity={hover == null || hover === i ? 1 : 0.55}>
                <rect x={i * bw + 0.6} y={Hh - hNew} width={w} height={hNew} fill="var(--blue)" />
                <rect x={i * bw + 0.6} y={Hh - hNew - hJoin} width={w} height={Math.max(0, hJoin - 0.8)} fill="color-mix(in srgb, var(--blue) 30%, var(--surface))" />
                <rect x={i * bw + 0.6} y={Hh - hNew - hJoin - hStop} width={w} height={Math.max(0, hStop - 0.8)} fill="var(--faint)" opacity={0.7} />
              </g>
            )
          })}
        </svg>
        {h && hover != null ? (
          <div className="pointer-events-none absolute top-0 z-10 flex min-w-[190px] flex-col gap-1 rounded-[14px] bg-surface p-3 card-shadow"
            style={{ left: `clamp(0px, calc(${((hover + 0.5) / hours.length) * 100}% - 95px), calc(100% - 190px))` }}>
            <span className="t-meta text-secondary">{dayLabel(at(hover))}, {String(local(at(hover)).getUTCHours()).padStart(2, '0')}:00–{String((local(at(hover)).getUTCHours() + 1) % 24).padStart(2, '0')}:00</span>
            <span className="t-row text-text">{fmt(h.reports)} {tx({ en: 'messages', ru: 'обращений', kk: 'хабар' })}</span>
            <TipRow color="var(--blue)" v={h.incidents} l={tx({ en: 'new incidents', ru: 'новых инцидентов', kk: 'жаңа оқиға' })} />
            <TipRow color="color-mix(in srgb, var(--blue) 30%, var(--surface))" v={h.joined} l={tx({ en: 'joined', ru: 'присоединено', kk: 'қосылды' })} />
            <TipRow color="var(--faint)" v={h.blocked} l={tx({ en: 'stopped', ru: 'остановлено', kk: 'тоқтатылды' })} />
          </div>
        ) : null}
        <div className="relative mt-1.5 h-4 t-meta text-faint">
          {midnights.map((i) => <span key={i} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${((i + 12) / hours.length) * 100}%` }}>{dayLabel(at(i))}</span>)}
        </div>
      </div>
      <details className="t-sub text-secondary">
        <summary className="tap cursor-pointer font-semibold text-blue">{tx({ en: 'Table: days', ru: 'Таблица по дням', kk: 'Күндер кестесі' })}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left t-mono">
            <thead className="t-meta text-secondary"><tr><th className="py-1 pr-3">{tx({ en: 'Day', ru: 'День', kk: 'Күн' })}</th><th className="pr-3">{tx({ en: 'Messages', ru: 'Обращений', kk: 'Хабар' })}</th><th className="pr-3">{tx({ en: 'New incidents', ru: 'Новых инцидентов', kk: 'Жаңа оқиға' })}</th><th className="pr-3">{tx({ en: 'Joined', ru: 'Присоединено', kk: 'Қосылды' })}</th><th>{tx({ en: 'Stopped', ru: 'Остановлено', kk: 'Тоқтатылды' })}</th></tr></thead>
            <tbody>{Array.from({ length: Math.ceil(hours.length / 24) }, (_, k) => {
              const s = hours.slice(k * 24, k * 24 + 24).reduce((a, x) => ({ r: a.r + x.reports, i: a.i + x.incidents, j: a.j + x.joined, b: a.b + x.blocked }), { r: 0, i: 0, j: 0, b: 0 })
              return <tr key={k} className="border-t border-border"><td className="py-1 pr-3 text-text">{dayLabel(at(k * 24 + 12))}</td><td className="pr-3">{fmt(s.r)}</td><td className="pr-3">{fmt(s.i)}</td><td className="pr-3">{fmt(s.j)}</td><td>{fmt(s.b)}</td></tr>
            })}</tbody>
          </table>
        </div>
      </details>
    </Section>
  )
}

function Key({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: color }} />{label}</span>
}
function TipRow({ color, v, l }: { color: string; v: number; l: string }) {
  return <span className="flex items-center gap-2 t-meta text-secondary"><span className="h-0.5 w-3 rounded-full" style={{ background: color }} /><b className="t-mono text-text">{fmt(v)}</b>{l}</span>
}

// ── The biggest incidents ────────────────────────────────────────────────────
function Top({ r, tx }: { r: PilotResult; tx: Tx }) {
  const { lang } = useApp()
  return (
    <Section title={tx({ en: 'The largest incidents: hundreds of messages, one card', ru: 'Крупнейшие инциденты: сотни сообщений — одна карточка', kk: 'Ең үлкен оқиғалар: жүздеген хабар — бір карточка' })}
      sub={tx({ en: 'What the engine built, next to what really happened. “Captured” is the share of the real problem’s messages that ended up in this one incident.', ru: 'Что собрал движок — рядом с тем, что было на самом деле. «Собрано» — доля сообщений об этой реальной проблеме, попавших в один инцидент.', kk: 'Қозғалтқыш не құрастырды және шын мәнінде не болды.' })}>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[860px] text-left t-sub">
          <thead className="t-meta text-secondary">
            <tr>
              <th className="py-2 pr-3 font-medium">{tx({ en: 'Incident', ru: 'Инцидент', kk: 'Оқиға' })}</th>
              <th className="pr-3 font-medium">{tx({ en: 'Messages', ru: 'Сообщений', kk: 'Хабар' })}</th>
              <th className="pr-3 font-medium">{tx({ en: 'By channel', ru: 'Каналы', kk: 'Арналар' })}</th>
              <th className="pr-3 font-medium">{tx({ en: 'Residents told', ru: 'Оповещено', kk: 'Хабардар' })}</th>
              <th className="pr-3 font-medium">{tx({ en: 'Priority', ru: 'Приоритет', kk: 'Басымдық' })}</th>
              <th className="pr-3 font-medium">{tx({ en: 'Responsible', ru: 'Исполнитель', kk: 'Жауапты' })}</th>
              <th className="font-medium">{tx({ en: 'Captured', ru: 'Собрано', kk: 'Жиналды' })}</th>
            </tr>
          </thead>
          <tbody>
            {r.top.map((t) => {
              const ch = Object.entries(t.channels as Record<string, number>).sort((a, b) => b[1] - a[1])
              const total = ch.reduce((s, [, v]) => s + v, 0)
              return (
                <tr key={t.code} className="border-t border-border align-top">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-start gap-2.5">
                      <span className="grid size-8 flex-none place-items-center rounded-[10px] bg-surface-2 hairline"><Icon name={SERVICE_ICON[t.service as IncidentService]} size={15} /></span>
                      <span className="flex flex-col">
                        <span className="t-row text-text">{t.title[lang]}</span>
                        <span className="t-meta text-secondary"><span className="t-mono text-faint">{t.code}</span> · {where(tx, t)}{t.scope.buildings ? ` · ${t.scope.buildings} ${tx({ en: 'houses', ru: 'домов', kk: 'үй' })}` : ''}</span>
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3"><span className="t-num text-[17px] font-semibold text-text">{fmt(t.reports)}</span><span className="t-meta text-faint"> → 1</span>
                    <p className="t-meta text-secondary">{fmt(t.signals)} {tx({ en: 'reports', ru: 'обращ.', kk: 'өтініш' })} · {fmt(t.confirmations)} {tx({ en: 'confirm.', ru: 'подтв.', kk: 'раст.' })}</p></td>
                  <td className="py-2.5 pr-3">
                    <div className="flex h-2 w-32 overflow-hidden rounded-full bg-line">
                      {ch.map(([k, v], i) => <span key={k} title={`${tx(CHANNEL[k] ?? { en: k, ru: k })}: ${v}`} style={{ width: `${(v / total) * 100}%`, background: `color-mix(in srgb, var(--blue) ${100 - i * 18}%, var(--surface))` }} className="h-full border-r-2 border-surface last:border-r-0" />)}
                    </div>
                    <p className="mt-1 t-meta text-secondary">{ch.slice(0, 2).map(([k, v]) => `${tx(CHANNEL[k] ?? { en: k, ru: k })} ${Math.round((v / total) * 100)}%`).join(' · ')}</p>
                  </td>
                  <td className="py-2.5 pr-3 t-mono text-text">{fmt(t.notified)}</td>
                  <td className="py-2.5 pr-3"><Badge tone={PRIORITY[t.priority]?.tone ?? 'neutral'}>{tx(PRIORITY[t.priority]?.label ?? { en: t.priority, ru: t.priority })}</Badge></td>
                  <td className="py-2.5 pr-3"><span className="inline-flex items-center gap-1.5 text-text">{t.route_ok ? <Icon name="check" size={14} className="text-green" /> : <Icon name="x" size={14} className="text-amber" />}{orgShort(t.route)}</span></td>
                  <td className="py-2.5 t-mono text-text">{t.truth ? pct(t.truth.captured) : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ── Who was told ─────────────────────────────────────────────────────────────
function Notify({ r, tx }: { r: PilotResult; tx: Tx }) {
  const n = r.notify
  const groups = ['outages', 'street', 'dangers', 'building'] as const
  return (
    <Section title={tx({ en: 'Who was told: the residents in the affected zone', ru: 'Кого оповестили: жителей в зоне проблемы', kk: 'Кім хабардар болды: аймақтағы тұрғындар' })}
      sub={tx({ en: 'When an incident opens, residents whose saved home is inside its zone see it at once: “This affects your home. Do you have it too?” Right = the problem really reaches their home (for problems at a point: its radius ±60 m, since an address is only the nearest house). Covered = of all residents it really reaches, how many were told or follow their own report.', ru: 'Когда открывается инцидент, жители, чей сохранённый дом в его зоне, сразу видят его: «Это касается вашего дома. У вас тоже?» Точность — проблема действительно касается их дома (для проблем в точке — её радиус ±60 м: адрес — это лишь ближайший дом). Охват — из всех, кого проблема касается, сколько узнали или следят за своим обращением.', kk: 'Оқиға ашылғанда, үйі аймақта тұрғындар оны бірден көреді. Дәлдік — мәселе шынымен олардың үйіне қатысты. Қамту — қатысты тұрғындардың қаншасы білді.' })}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Mini v={pct(n.precision)} l={tx({ en: 'right people', ru: 'точность', kk: 'дәлдік' })} />
            <Mini v={pct(n.recall)} l={tx({ en: 'covered', ru: 'охват', kk: 'қамту' })} />
            <Mini v={`${n.max_per_resident}`} l={tx({ en: 'most incidents one resident was told about in the week', ru: 'максимум оповещений одному жителю за неделю', kk: 'бір тұрғынға ең көп хабар' })} />
          </div>
          <div className="flex flex-col gap-3">
            {groups.map((g) => {
              const p = (n.precision_by as Record<string, { n: number; precision: number | null }>)[g]
              const c = (n.recall_by as Record<string, { n: number; recall: number | null }>)[g]
              if (!p && !c) return null
              return (
                <div key={g} className="flex flex-col gap-1.5">
                  <p className="t-row text-text">{tx(GROUP[g]!)}</p>
                  <MeterRow l={tx({ en: 'right people', ru: 'точность', kk: 'дәлдік' })} v={p?.precision ?? null} n={p?.n ?? 0} />
                  <MeterRow l={tx({ en: 'covered', ru: 'охват', kk: 'қамту' })} v={c?.recall ?? null} n={c?.n ?? 0} />
                </div>
              )
            })}
            {(n.precision_by as Record<string, { n: number }>).false_reports ? (
              <p className="t-meta text-secondary">{tx({ en: `${fmt((n.precision_by as Record<string, { n: number }>).false_reports!.n)} of ${fmt(n.notified_pairs)} notifications came from fake reports that looked real, shown to neighbours until an operator rejected them. Reports the copilot could not classify are not shown to neighbours at all.`, ru: `${fmt((n.precision_by as Record<string, { n: number }>).false_reports!.n)} из ${fmt(n.notified_pairs)} оповещений — от ложных сообщений, похожих на настоящие: соседи видят их, пока оператор не отклонит. Нераспознанные сообщения соседям не показываются вовсе.`, kk: `${fmt((n.precision_by as Record<string, { n: number }>).false_reports!.n)} хабарландыру жалған хабарлардан.` })}</p>
            ) : null}
          </div>
        </div>
        <CityMap r={r} tx={tx} />
      </div>
    </Section>
  )
}

function Mini({ v, l }: { v: ReactNode; l: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[16px] bg-surface-2 p-3 hairline">
      <span className="whitespace-nowrap font-[family-name:var(--font-display)] text-[22px] font-semibold leading-none tracking-[-0.02em] text-text">{v}</span>
      <span className="t-meta leading-tight text-secondary [hyphens:auto] [overflow-wrap:anywhere]">{l}</span>
    </div>
  )
}
function MeterRow({ l, v, n }: { l: string; v: number | null; n: number }) {
  return (
    <div className="grid grid-cols-[88px_1fr_58px] items-center gap-3">
      <span className="t-meta text-secondary">{l}</span>
      <Meter value={(v ?? 0) / 100} tone={v == null ? 'blue' : v >= 90 ? 'green' : v >= 75 ? 'blue' : 'amber'} />
      <span className="t-mono text-right t-meta text-text" title={`n = ${n}`}>{pct(v)}</span>
    </div>
  )
}

/** Every building as a dot; where someone was told correctly, told needlessly, or missed. */
function CityMap({ r, tx }: { r: PilotResult; tx: Tx }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const totals = useMemo(() => r.map.buildings.reduce((s, b) => ({ right: s.right + (b[2] as number), wrong: s.wrong + (b[3] as number), missed: s.missed + (b[4] as number) }), { right: 0, wrong: 0, missed: 0 }), [r])
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const c = ref.current
    if (!c || !w) return
    const dots = r.map.city
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
    for (let i = 0; i < dots.length; i += 2) { minLat = Math.min(minLat, dots[i]!); maxLat = Math.max(maxLat, dots[i]!); minLon = Math.min(minLon, dots[i + 1]!); maxLon = Math.max(maxLon, dots[i + 1]!) }
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
    const spanX = (maxLon - minLon) * kx, spanY = maxLat - minLat
    const h = Math.round(Math.min(520, (w * spanY) / spanX))
    const dpr = window.devicePixelRatio || 1
    c.width = w * dpr; c.height = h * dpr; c.style.height = `${h}px`
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    const css = getComputedStyle(c)
    const col = (v: string) => css.getPropertyValue(v).trim() || '#888'
    const pad = 8
    const sc = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY)
    const ox = (w - spanX * sc) / 2, oy = (h - spanY * sc) / 2
    const X = (lon: number) => ox + (lon - minLon) * kx * sc, Y = (lat: number) => h - oy - (lat - minLat) * sc
    g.clearRect(0, 0, w, h)
    g.fillStyle = col('--faint'); g.globalAlpha = 0.35
    for (let i = 0; i < dots.length; i += 2) g.fillRect(X(dots[i + 1]!) - 0.8, Y(dots[i]!) - 0.8, 1.6, 1.6)
    g.globalAlpha = 1
    const dot = (lat: number, lon: number, rad: number, fill: string) => { g.beginPath(); g.arc(X(lon), Y(lat), rad, 0, Math.PI * 2); g.fillStyle = fill; g.fill() }
    // One dot per building, in the colour of what happened to most of its residents
    // (the legend keeps the exact per-person counts); drawn so the rarer outcomes stay on top.
    const ring = col('--surface')
    const fills = [col('--green'), col('--amber'), col('--red')]
    const marks = r.map.buildings.map((b) => {
      const v = [b[2] as number, b[3] as number, b[4] as number]
      return { lat: b[0] as number, lon: b[1] as number, k: v.indexOf(Math.max(...v)), n: v[0]! + v[1]! + v[2]! }
    })
    for (const k of [0, 1, 2]) {
      for (const m of marks) {
        if (m.k !== k) continue
        const rad = Math.min(4, 1.5 + Math.sqrt(m.n) * 0.4)
        dot(m.lat, m.lon, rad + 1, ring)
        dot(m.lat, m.lon, rad, fills[k]!)
      }
    }
  }, [r, w])
  return (
    <div className="flex flex-col gap-2">
      <div ref={wrap} className="w-full overflow-hidden rounded-[16px] bg-surface-2 hairline">
        <canvas ref={ref} className="block w-full" role="img" aria-label={tx({ en: 'Map of Aktau buildings: told correctly, told needlessly, missed', ru: 'Карта домов Актау: оповещены верно, лишний раз, пропущены', kk: 'Ақтау үйлерінің картасы' })} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 t-meta text-secondary">
        <Key color="var(--green)" label={tx({ en: `Told, and affected · ${fmt(totals.right)}`, ru: `Оповещены и затронуты · ${fmt(totals.right)}`, kk: `Хабардар, қатысты · ${fmt(totals.right)}` })} />
        <Key color="var(--amber)" label={tx({ en: `Told, not affected · ${fmt(totals.wrong)}`, ru: `Оповещены, но не затронуты · ${fmt(totals.wrong)}`, kk: `Хабардар, қатыссыз · ${fmt(totals.wrong)}` })} />
        <Key color="var(--red)" label={tx({ en: `Affected, not told · ${fmt(totals.missed)}`, ru: `Затронуты, но не оповещены · ${fmt(totals.missed)}`, kk: `Қатысты, хабарсыз · ${fmt(totals.missed)}` })} />
      </div>
      <p className="t-meta text-faint">{tx({ en: 'Grey dots are buildings from OpenStreetMap. A coloured dot shows what happened to most residents of that building; counts are per resident.', ru: 'Серые точки — дома из OpenStreetMap. Цвет точки — что случилось с большинством жителей дома; в подписи — число людей.', kk: 'Сұр нүктелер — OpenStreetMap үйлері. Түс — үй тұрғындарының көпшілігіне не болғаны.' })}</p>
    </div>
  )
}

// ── Understanding the words ──────────────────────────────────────────────────
function Understanding({ r, tx }: { r: PilotResult; tx: Tx }) {
  const u = r.understanding
  const langs = Object.entries(u.by_lang as Record<string, { n: number; service_ok: number | null; place_ok: number | null }>).sort((a, b) => b[1].n - a[1].n)
  const ch = Object.entries(r.input.by_channel as Record<string, number>).sort((a, b) => b[1] - a[1])
  return (
    <Section title={tx({ en: 'Understanding the words', ru: 'Понимание сообщений', kk: 'Хабарды түсіну' })}
      sub={tx({ en: `Read as sent, before anyone adds an address: what the problem is and where. Messages with only a shared location are left out here (${fmt(r.input.genuine - u.reports)}).`, ru: `Как написано, до того как кто-то добавит адрес: что за проблема и где. Сообщения только с геолокацией здесь не считаются (${fmt(r.input.genuine - u.reports)}).`, kk: 'Жазылғандай: қандай мәселе және қайда.' })}>
      <div className="grid grid-cols-3 gap-3">
        <Mini v={pct(u.service_ok)} l={tx({ en: 'problem type right', ru: 'тип проблемы верно', kk: 'мәселе түрі дұрыс' })} />
        <Mini v={pct(u.place_ok)} l={tx({ en: 'microdistrict right', ru: 'микрорайон верно', kk: 'шағын аудан дұрыс' })} />
        <Mini v={pct(u.house_ok)} l={tx({ en: 'exact house found', ru: 'дом найден точно', kk: 'үй дәл табылды' })} />
      </div>
      <div className="flex flex-col gap-2.5">
        {langs.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between"><span className="t-row text-text">{tx(LANG[k] ?? { en: k, ru: k })}</span><span className="t-meta text-secondary">{fmt(v.n)} {tx({ en: 'messages', ru: 'сообщ.', kk: 'хабар' })}</span></div>
            <MeterRow l={tx({ en: 'type', ru: 'тип', kk: 'түрі' })} v={v.service_ok} n={v.n} />
            <MeterRow l={tx({ en: 'place', ru: 'место', kk: 'орны' })} v={v.place_ok} n={v.n} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 t-meta text-secondary">{ch.map(([k, v]) => <span key={k}><b className="t-mono text-text">{fmt(v)}</b> {tx(CHANNEL[k] ?? { en: k, ru: k })}</span>)}</div>
    </Section>
  )
}

// ── The gate in front of 109 ─────────────────────────────────────────────────
function Gate({ r, tx }: { r: PilotResult; tx: Tx }) {
  const g = r.gate
  const k = g.by_kind as Record<string, { n: number; stopped: number; flagged: number }>
  const kinds: Array<[string, L3]> = [
    ['advert', { en: 'Adverts with a phone or link', ru: 'Реклама с телефоном или ссылкой', kk: 'Жарнама' }],
    ['gibberish', { en: 'Gibberish, “test”', ru: 'Бессмыслица, «тест»', kk: 'Мағынасыз мәтін' }],
    ['chatter', { en: 'Not a problem (“hello”, “thanks”)', ru: 'Не проблема («привет», «спасибо»)', kk: 'Мәселе емес' }],
    ['troll', { en: 'Made-up reports from one phone', ru: 'Выдуманные сообщения с одного телефона', kk: 'Ойдан шығарылған хабарлар' }],
  ]
  return (
    <Section title={tx({ en: 'Spam and repeats', ru: 'Спам и повторы', kk: 'Спам және қайталау' })}
      sub={tx({ en: 'The app asks for a place before sending; then the rules check it. The AI review is not called in the simulation: whatever the rules let through reaches an operator, flagged.', ru: 'Приложение не отправит обращение без места; затем его проверяют правила. ИИ-проверка в симуляции не вызывается: всё, что пропустили правила, попадает к оператору с пометкой.', kk: 'Қосымша орынсыз жібермейді; кейін ережелер тексереді. ЖИ симуляцияда шақырылмайды.' })}>
      <div className="grid grid-cols-3 gap-3">
        <Mini v={`${fmt(g.stopped_no_address + g.blocked_by_rules)} / ${fmt(g.spam)}`} l={tx({ en: 'spam stopped before 109', ru: 'спама остановлено до 109', kk: 'спам тоқтатылды' })} />
        <Mini v={fmt(g.genuine_blocked)} l={tx({ en: 'real reports blocked', ru: 'настоящих жалоб заблокировано', kk: 'нақты өтініш бұғатталды' })} />
        <Mini v={`${fmt(g.resends_absorbed)} / ${fmt(g.resends)}`} l={tx({ en: 'repeats counted once', ru: 'повторов учтено один раз', kk: 'қайталау бір рет' })} />
      </div>
      <table className="w-full text-left t-sub">
        <thead className="t-meta text-secondary"><tr><th className="py-1 pr-3 font-medium">{tx({ en: 'Kind', ru: 'Вид', kk: 'Түрі' })}</th><th className="pr-3 font-medium">{tx({ en: 'Sent', ru: 'Отправлено', kk: 'Жіберілді' })}</th><th className="font-medium">{tx({ en: 'Stopped', ru: 'Остановлено', kk: 'Тоқтатылды' })}</th></tr></thead>
        <tbody>{kinds.map(([key, label]) => k[key] ? (
          <tr key={key} className="border-t border-border"><td className="py-1.5 pr-3 text-text">{tx(label)}</td><td className="pr-3 t-mono">{fmt(k[key]!.n)}</td><td className="t-mono">{fmt(k[key]!.stopped)}{k[key]!.flagged ? <span className="t-meta text-secondary"> · {k[key]!.flagged} {tx({ en: 'flagged', ru: 'с пометкой', kk: 'белгімен' })}</span> : null}</td></tr>
        ) : null)}</tbody>
      </table>
      <p className="t-meta text-secondary">{tx({ en: `${fmt(g.reached_109)} spam messages reached 109 (made-up reports that look real, or “hello” with a shared location); an operator rejects them. ${fmt(g.genuine_retried)} real messages lacked a place and were completed with the “At my home” button or a shared location.`, ru: `${fmt(g.reached_109)} спам-сообщений дошли до 109 (выдуманные, но правдоподобные, или «привет» с геолокацией); их отклоняет оператор. ${fmt(g.genuine_retried)} настоящих обращений без места дополнены кнопкой «У меня дома» или геолокацией.`, kk: `${fmt(g.reached_109)} спам 109-ға жетті; оператор қабылдамайды.` })}</p>
    </Section>
  )
}

// ── Danger first ─────────────────────────────────────────────────────────────
function Dangers({ r, tx }: { r: PilotResult; tx: Tx }) {
  const s = r.safety
  return (
    <Section title={tx({ en: 'Danger first', ru: 'Опасное — первым', kk: 'Қауіпті — бірінші' })}
      sub={tx({ en: 'A crowd cannot outrank a hazard: an open manhole with one report is above overflowing bins with forty. Danger is never held by the spam check.', ru: 'Толпа не перевешивает опасность: открытый люк с одним сообщением выше переполненных баков с сорока. Опасное никогда не задерживается спам-фильтром.', kk: 'Қауіп ешқашан спам-сүзгіде ұсталмайды.' })}>
      <div className="grid grid-cols-3 gap-3">
        <Mini v={`${s.critical} / ${s.dangers}`} l={tx({ en: 'critical at once', ru: 'сразу критические', kk: 'бірден сыни' })} />
        <Mini v={`${s.detected_in_text} / ${s.dangers}`} l={tx({ en: 'danger read from the words', ru: 'опасность понята из текста', kk: 'қауіп мәтіннен танылды' })} />
        <Mini v={fmt(s.warned_residents)} l={tx({ en: 'residents warned when 109 confirmed', ru: 'жителей предупреждены после подтверждения 109', kk: 'тұрғын ескертілді' })} />
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {s.list.map((x, i) => (
          <li key={i} className="flex items-center gap-3 py-2">
            <Icon name={SERVICE_ICON[PROBLEM_ICON[x.key] ?? 'other']} size={16} className={x.critical ? 'text-red' : 'text-amber'} />
            <span className="flex min-w-0 flex-1 flex-col"><span className="t-row truncate text-text">{tx(PROBLEM[x.key] ?? { en: x.key, ru: x.key })}</span><span className="t-meta text-secondary">{where(tx, x)} · {x.reports} {tx({ en: 'messages', ru: 'сообщ.', kk: 'хабар' })}</span></span>
            {x.priority ? <Badge tone={PRIORITY[x.priority]?.tone ?? 'neutral'}>{tx(PRIORITY[x.priority]?.label ?? { en: x.priority, ru: x.priority })}</Badge> : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ── After the fix: the team, then the residents ──────────────────────────────
function Loop({ r, tx }: { r: PilotResult; tx: Tx }) {
  const l = r.lifecycle, ro = r.routing, rc = r.recurrence
  return (
    <Section title={tx({ en: 'The right team, and the residents check the fix', ru: 'Нужный исполнитель, а жители проверяют работу', kk: 'Дұрыс орындаушы, тұрғындар тексереді' })}
      sub={tx({ en: 'The team is suggested from the service and the evidence; as reports arrive from more houses, an outage moves from the building to the network. When a team says “done”, the people who reported it are asked: fixed, partly, or not.', ru: 'Исполнитель предлагается по службе и по фактам; когда сообщения приходят из нескольких домов, отключение переходит от ОСИ дома к сетям. Когда исполнитель пишет «готово», тех, кто сообщал, спрашивают: решено, частично или нет.', kk: 'Орындаушы қызмет пен фактілер бойынша ұсынылады. «Дайын» дегенде, хабарлағандардан сұралады.' })}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Mini v={pct(ro.correct)} l={tx({ en: 'right team suggested', ru: 'верный исполнитель', kk: 'дұрыс орындаушы' })} />
        <Mini v={fmt(ro.rerouted)} l={tx({ en: 'moved to the network as reports came in', ru: 'переназначены на сети по мере сообщений', kk: 'желіге ауыстырылды' })} />
        <Mini v={`${rc.linked_to_previous} / ${rc.returned}`} l={tx({ en: 'returns linked to the earlier repair', ru: 'повторных поломок связаны с прошлым ремонтом', kk: 'қайталанулар байланысты' })} />
        <Mini v={fmt(l.verified)} l={tx({ en: 'closed by residents’ “yes”', ru: 'закрыты по «да» жителей', kk: 'тұрғындар «иә» деп жапты' })} />
        <Mini v={`${l.fake_caught} / ${l.fake}`} l={tx({ en: 'false “done” sent back by residents', ru: 'ложных «готово» вернули жители', kk: 'жалған «дайын» қайтарылды' })} />
        <Mini v={fmt(l.messages.followers)} l={tx({ en: 'updates sent, one per person per step', ru: 'обновлений: одно на человека за шаг', kk: 'жаңалық, бір адамға бір рет' })} />
      </div>
      <p className="t-meta text-secondary">{tx({ en: `${l.resolved_by_operator} completions nobody answered were closed by 109 after 24 h; ${l.still_open} incidents are still open at the end of the week (problems that last longer than the week).`, ru: `${l.resolved_by_operator} завершений без ответов закрыла 109 через 24 ч; ${l.still_open} инцидентов открыты на конец недели (проблемы длиннее недели).`, kk: `${l.resolved_by_operator} аяқталуды 109 жапты; ${l.still_open} оқиға ашық.` })}</p>
    </Section>
  )
}

// ── Every mistake, with its reason ───────────────────────────────────────────
type Err = Record<string, unknown> & { type: string }
function Mistakes({ r, tx }: { r: PilotResult; tx: Tx }) {
  const [tab, setTab] = useState<'merged' | 'split' | 'route' | 'danger_missed' | 'blocked'>('merged')
  const errs = r.errors as Err[]
  const counts = r.error_counts as Record<string, number>
  const tabs: Array<[typeof tab, L3]> = [
    ['merged', { en: 'Put together, but different', ru: 'Объединены, но разные', kk: 'Біріктірілді, бірақ әртүрлі' }],
    ['split', { en: 'One problem, two incidents', ru: 'Одна проблема — два инцидента', kk: 'Бір мәселе — екі оқиға' }],
    ['route', { en: 'Wrong team suggested', ru: 'Не тот исполнитель', kk: 'Басқа орындаушы' }],
    ['danger_missed', { en: 'Danger not critical', ru: 'Опасность не критическая', kk: 'Қауіп сыни емес' }],
    ['blocked', { en: 'Real report blocked', ru: 'Настоящее заблокировано', kk: 'Нақты бұғатталды' }],
  ]
  const shown = errs.filter((e) => e.type === tab)
  const P = (p: unknown) => { const x = p as Problem; return `${tx(PROBLEM[x.key] ?? { en: x.key, ru: x.key })} · ${where(tx, x)}` }
  const reasons = (xs: unknown) => ((xs as string[]) ?? []).map((k) => tx(REASON[k] ?? { en: k, ru: k })).join(', ')
  return (
    <Section title={tx({ en: 'Every mistake, with its reason', ru: 'Все ошибки — с причиной', kk: 'Барлық қателер — себебімен' })}
      sub={tx({ en: 'The engine decided everything alone here: it attaches a message at 80% similarity and opens a new incident below that. In the pilot, residents and operators confirm these calls; an operator merges two incidents in one click.', ru: 'Здесь всё решал движок без людей: присоединяет при сходстве от 80% и открывает новый инцидент ниже. В пилоте эти решения подтверждают жители и операторы; оператор объединяет два инцидента в один клик.', kk: 'Мұнда барлығын қозғалтқыш өзі шешті: 80%-дан жоғары қосады. Пилотта оны адамдар растайды.' })}>
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
            className={`tap inline-flex h-9 flex-none items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold ${tab === k ? 'bg-text text-bg' : 'bg-surface-2 text-secondary hairline'}`}>
            {tx(l)}<span className="t-mono opacity-70">{counts[k] ?? 0}</span>
          </button>
        ))}
      </div>
      {!shown.length ? <p className="t-sub text-secondary">{tx({ en: 'None in this week.', ru: 'В эту неделю таких нет.', kk: 'Бұл аптада жоқ.' })}</p> : (
        <ul className="flex flex-col divide-y divide-border">
          {shown.slice(0, 12).map((e, i) => (
            <li key={i} className="flex flex-col gap-1.5 py-3">
              <p className="t-row text-text">
                {e.type === 'merged' ? tx({ en: `${e.incident}: ${e.reports} messages about “${P(e.other)}” joined “${P(e.into)}”`, ru: `${e.incident}: ${e.reports} сообщ. о «${P(e.other)}» попали в «${P(e.into)}»`, kk: `${e.incident}: «${P(e.other)}» → «${P(e.into)}»` })
                  : e.type === 'split' ? tx({ en: `${e.incident} opened next to ${e.of}: the same “${P(e.problem)}”`, ru: `${e.incident} открыт рядом с ${e.of}: та же «${P(e.problem)}»`, kk: `${e.incident} ${e.of} жанында ашылды` })
                  : e.type === 'route' ? tx({ en: `${e.incident}: suggested ${orgShort(String(e.suggested))}, should be ${orgShort(String(e.expected))} (${e.reports} messages)`, ru: `${e.incident}: предложен ${orgShort(String(e.suggested))}, верно — ${orgShort(String(e.expected))} (${e.reports} сообщ.)`, kk: `${e.incident}: ${orgShort(String(e.suggested))} → ${orgShort(String(e.expected))}` })
                  : e.type === 'danger_missed' ? tx({ en: `“${P(e.problem)}” got ${String(e.priority ?? '–').toLowerCase()} priority (${e.incident})`, ru: `«${P(e.problem)}» получила приоритет ${tx(PRIORITY[String(e.priority)]?.label ?? { en: '–', ru: '–' }).toLowerCase()} (${e.incident})`, kk: `«${P(e.problem)}» сыни емес` })
                  : tx({ en: `A real report about “${P(e.problem)}” was blocked (${e.code})`, ru: `Настоящее сообщение о «${P(e.problem)}» заблокировано (${e.code})`, kk: `Нақты хабар бұғатталды (${e.code})` })}
              </p>
              {e.type === 'merged' ? <p className="t-meta text-secondary">{tx({ en: `Why: ${reasons(e.reasons)} → ${Math.round(Number(e.score) * 100)}%`, ru: `Почему: ${reasons(e.reasons)} → ${Math.round(Number(e.score) * 100)}%`, kk: `Себебі: ${reasons(e.reasons)}` })}</p> : null}
              {e.type === 'split' ? <p className="t-meta text-secondary">{e.possible
                ? tx({ en: `Shown to 109 as “possibly the same” (${Math.round(Number(e.score) * 100)}%: ${reasons(e.reasons)}): one click to merge.`, ru: `Copilot показал оператору «возможно, та же» (${Math.round(Number(e.score) * 100)}%: ${reasons(e.reasons)}): объединяется в один клик.`, kk: `Copilot «мүмкін сол» деп көрсетті.` })
                : e.score != null ? tx({ en: `Similarity ${Math.round(Number(e.score) * 100)}%: ${reasons(e.reasons)}.`, ru: `Сходство ${Math.round(Number(e.score) * 100)}%: ${reasons(e.reasons)}.`, kk: `Ұқсастық ${Math.round(Number(e.score) * 100)}%.` })
                : tx({ en: 'The message was read differently (type or place), so it looked like a new problem.', ru: 'Сообщение прочитано иначе (тип или место) — оно выглядело как новая проблема.', kk: 'Хабар басқаша оқылды.' })}</p> : null}
              {((e.samples as string[]) ?? []).slice(0, 2).map((s, k) => <p key={k} className="rounded-[10px] bg-surface-2 px-3 py-1.5 t-meta text-secondary hairline">“{s}”</p>)}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ── How it was measured ──────────────────────────────────────────────────────
function Method({ r, tx }: { r: PilotResult; tx: Tx }) {
  const items: L3[] = [
    { en: `The week: ${r.input.problems} real problems placed on the city’s ${fmt(r.city.buildings)} buildings (network outages in groups of houses or whole microdistricts, one-flat problems, street problems at a point, dangers). The answer key says which houses each one reaches and who is affected. Two problems nobody could tell apart from the messages (the same outage type next door at the same hours) are not generated.`, ru: `Неделя: ${r.input.problems} реальных проблем на ${fmt(r.city.buildings)} домах города (отключения сети на группах домов или целых микрорайонах, проблемы одной квартиры, проблемы на улице в точке, опасности). В ключе ответов — какие дома задеты и кого это касается. Две проблемы, которые нельзя различить по сообщениям (такое же отключение по соседству в те же часы), не генерируются.`, kk: `Апта: ${r.input.problems} нақты мәселе ${fmt(r.city.buildings)} үйде.` },
    { en: 'The messages come from templates with real variety (about 150 ways to say it in Russian, Kazakh and English, a dozen address formats, call transcripts, typos, Latin letters). Real messages vary more; the pilot’s numbers may differ.', ru: 'Сообщения — из шаблонов с настоящим разнообразием (около 150 формулировок на русском, казахском и английском, десяток форматов адреса, расшифровки звонков, опечатки, латиница). Реальные сообщения разнообразнее; цифры пилота могут отличаться.', kk: 'Хабарлар үлгілерден алынған; нақты хабарлар әртүрлірек.' },
    { en: 'The engine is the production code (packages/city-core): intake, the "already reported?" matcher, affected zone, priority, routing, the spam rules and residents’ verification. The database parts are mirrored rule for rule; an automated test replays the same messages through the real PostGIS database and gets the same incidents.', ru: 'Движок — рабочий код (packages/city-core): распознавание, поиск «уже сообщали?», зона затрагивания, приоритет, маршрутизация, спам-правила и проверка жителями. Части, которые делает база данных, повторены правило в правило; автотест прогоняет те же сообщения через настоящую базу PostGIS и получает те же инциденты.', kk: 'Қозғалтқыш — жұмыс коды; автотест нақты PostGIS базасы арқылы бірдей оқиғаларды алады.' },
    { en: 'Not simulated: the AI review of reports (rules only here), operators correcting the engine, residents answering “No, a different problem”. Every one of these would only reduce the mistakes above.', ru: 'Не моделируется: ИИ-проверка обращений (здесь только правила), исправления операторов, ответ жителя «Нет, это другая проблема». Каждое из этого только уменьшило бы ошибки выше.', kk: 'Модельденбейді: ЖИ тексеруі, оператор түзетулері.' },
    { en: 'Nothing here touches the city’s real incidents: the run happens in memory and only its summary is kept.', ru: 'Реальные инциденты города не затрагиваются: всё считается в памяти, сохраняется только итог.', kk: 'Қаланың нақты оқиғалары өзгермейді.' },
  ]
  return (
    <Section title={tx({ en: 'How it was measured', ru: 'Как считали', kk: 'Қалай есептелді' })}>
      <ul className="flex list-disc flex-col gap-2 pl-5 t-sub text-secondary">{items.map((x, i) => <li key={i}>{tx(x)}</li>)}</ul>
    </Section>
  )
}
