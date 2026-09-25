'use client'
// Jury demo: the resident's phone on the left, the 109 operator console on
// the right — two real pages, one database, updating each other live.
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useApp, useRealtime } from './app'
import { Button, Icon, Logo } from './primitives'
import type { IncidentLite } from './incident-ui'

const SCRIPT = [
  { en: 'Resident (left) says: “14 микрорайон, 21 дом. Воды нет со вчерашнего вечера.”', ru: 'Житель (слева) говорит: «14 микрорайон, 21 дом. Воды нет со вчерашнего вечера.»' },
  { en: 'Copilot: water · 14 mkr · house 21 · since yesterday evening, and “already known to 109”. Tap “I have this too”.', ru: 'Copilot: вода · 14 мкр · дом 21 · со вчерашнего вечера — и «уже известно 109». Нажмите «У меня тоже».' },
  { en: 'Operator (right): the Kazakh message “14 ш/а 23 үйде су жоқ” in the queue → Attach. No new request.', ru: 'Оператор (справа): казахское сообщение «14 ш/а 23 үйде су жоқ» в очереди → «Присоединить». Новой заявки нет.' },
  { en: 'Operator: Dispatch crew → every resident who reported gets the same update at once.', ru: 'Оператор: «Отправить бригаду» → все сообщившие получают одно обновление одновременно.' },
  { en: 'Executor: before/after photos + an answer. The copilot checks both before closing.', ru: 'Исполнитель: фото «до/после» и ответ. Copilot проверяет их до закрытия.' },
  { en: 'Resident: “Is it actually fixed?” → Yes → VERIFIED by residents.', ru: 'Житель: «Действительно исправлено?» → «Да» → подтверждено жителями.' },
]

export function DemoView() {
  const { tx } = useApp()
  const [main, setMain] = useState<IncidentLite | null>(null)
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)
  const load = useCallback(async () => {
    const d = (await (await fetch('/api/incidents', { cache: 'no-store' })).json()) as { incidents: IncidentLite[] }
    setMain(d.incidents.filter((i) => i.service === 'water' && i.designator === '14').sort((a, b) => b.signal_count - a.signal_count)[0] ?? null)
  }, [])
  useEffect(() => { void load() }, [load])
  useRealtime(() => void load(), ['incidents'])
  const n = main?.signal_count ?? 0
  return (
    <div className="dark-scope flex min-h-dvh flex-col bg-bg text-text">
      <header className="flex h-14 flex-none items-center gap-4 border-b border-line px-5">
        <Link href="/welcome" className="flex items-center gap-2.5"><Logo size={28} /><span className="font-[family-name:var(--font-display)] text-[16px] font-semibold tracking-[-0.03em]">Aktau</span></Link>
        <span className="t-label text-faint">{tx({ en: 'Live demo · resident ↔ 109', ru: 'Живое демо · житель ↔ 109', kk: 'Тірі демо · тұрғын ↔ 109' })}</span>
        <div className="flex-1" />
        <Button size="sm" full={false} style="outline" disabled={busy} onClick={async () => {
          setBusy(true)
          try { await fetch('/api/ops/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); setNonce((x) => x + 1); await load() } finally { setBusy(false) }
        }}><Icon name="timer" size={15} />{tx({ en: 'Reset scenario', ru: 'Сбросить сценарий', kk: 'Сценарийді қалпына келтіру' })}</Button>
      </header>
      <div className="grid flex-1 gap-6 p-5 xl:grid-cols-[400px_1fr]">
        <div className="flex flex-col items-center gap-4">
          <p className="t-label text-secondary">{tx({ en: 'Resident · Aktau app', ru: 'Житель · приложение Aktau', kk: 'Тұрғын · Aktau қосымшасы' })}</p>
          <div className="relative h-[780px] w-[370px] overflow-hidden rounded-[52px] bg-[#020a0f] p-[12px] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
            <div className="absolute left-1/2 top-3.5 z-10 h-7 w-28 -translate-x-1/2 rounded-full bg-[#020a0f]" />
            <iframe key={`r${nonce}`} src="/report" title="Resident" className="h-full w-full rounded-[40px] border-0 bg-bg" allow="microphone; geolocation" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <p className="t-label text-secondary">{tx({ en: '109 operator · Copilot console', ru: 'Оператор 109 · консоль Copilot', kk: '109 операторы · Copilot консолі' })}</p>
          <div className="flex h-[780px] flex-col overflow-hidden rounded-[22px] bg-surface card-shadow">
            <div className="flex h-9 flex-none items-center gap-2 border-b border-line px-3"><span className="size-2.5 rounded-full bg-red/70" /><span className="size-2.5 rounded-full bg-amber/70" /><span className="size-2.5 rounded-full bg-green/70" /><span className="ml-2 t-mono text-[10.5px] text-faint">/copilot</span></div>
            <iframe key={`o${nonce}`} src="/copilot?embed=1" title="109 Copilot" className="w-full flex-1 border-0" allow="microphone; camera; geolocation" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 border-t border-line p-5 lg:grid-cols-[1fr_1fr_1.2fr]">
        <div className="flex flex-col gap-2 rounded-[20px] bg-surface p-5 hairline">
          <p className="t-label text-faint">{tx({ en: 'Traditional flow', ru: 'Как сейчас', kk: 'Қазіргі' })}</p>
          <p className="t-hero !text-[20px] text-text"><span className="t-num">{n}</span> {tx({ en: 'residents', ru: 'жителей', kk: 'тұрғын' })} → <span className="t-num">{n}</span> {tx({ en: 'interactions', ru: 'обращений', kk: 'өтініш' })}</p>
          <p className="t-sub text-secondary">{tx({ en: 'repeated explanations · repeated status requests · each routed separately', ru: 'повторные объяснения · повторные «ну что там?» · каждое маршрутизируется отдельно', kk: 'қайта түсіндіру · қайта сұрау' })}</p>
        </div>
        <div className="beam-edge flex flex-col gap-2 rounded-[20px] bg-surface p-5">
          <p className="t-label text-beam">Aktau{main ? ` · ${main.code}` : ''}</p>
          <p className="t-hero !text-[20px] text-text"><span className="t-num beam-text">{n}</span> {tx({ en: 'signals', ru: 'сигналов', kk: 'сигнал' })} → <span className="t-num">1</span> {tx({ en: 'incident', ru: 'инцидент', kk: 'оқиға' })} → <span className="t-num">1</span> {tx({ en: 'route', ru: 'маршрут', kk: 'бағыт' })}</p>
          <p className="t-sub text-secondary">→ 1 {tx({ en: 'update', ru: 'обновление', kk: 'жаңалық' })} → <b className="text-text">{n}</b> {tx({ en: 'informed residents', ru: 'жителей в курсе', kk: 'тұрғын хабардар' })}</p>
        </div>
        <ol className="flex flex-col gap-1.5 rounded-[20px] bg-surface p-5 hairline">
          {SCRIPT.map((s, i) => <li key={i} className="flex gap-2.5 t-meta text-secondary"><span className="t-mono text-beam">{i + 1}</span>{tx(s)}</li>)}
        </ol>
      </div>
    </div>
  )
}
