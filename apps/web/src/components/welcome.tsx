'use client'
// Welcome — the entrance to Aktau. One idea, told in order:
// the city is made of incidents, not tickets; here is how a resident's words
// become one routed, checked, verified incident; here is how it plugs into 109.
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { SignalPreview } from '@aktau/server'
import type { Lang } from '@aktau/types'
import { useApp } from './app'
import { LighthouseMap } from './lighthouse'
import { Badge, CopilotTag, Icon, Logo, Meter, type IconName } from './primitives'
import { PHOTOS } from '@/lib/photos'
import { REASON, SERVICE_ICON, incidentName, placeText, serviceName } from './incident-ui'

type Pulse = { open: number; signals: number; merged: number; verified: number; areas: number }

const setCookie = (n: string, v: string) => { document.cookie = `${n}=${v}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax` }

export function WelcomeView({ pulse }: { pulse: Pulse }) {
  const { tx, lang } = useApp()
  useEffect(() => { setCookie('aktau_welcomed', '1') }, [])
  return (
    <div className="dark-scope min-h-dvh bg-bg text-text">
      <Nav />
      <Hero pulse={pulse} />
      <Problem />
      <Engine />
      <TryIt />
      <Screens />
      <OpsPreview />
      <Honest />
      <Plugs />
      <Trust />
      <footer className="border-t border-line px-5 py-12 sm:px-10">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-8 lg:flex-row lg:justify-between">
          <div className="flex max-w-[420px] flex-col gap-3">
            <div className="flex items-center gap-3"><Logo size={36} /><span className="font-[family-name:var(--font-display)] text-[20px] font-semibold tracking-[-0.03em]">Aktau</span></div>
            <p className="t-sub text-secondary">{tx({ en: 'Built for the city on the Caspian. Calm when clear, honest when uncertain.', ru: 'Сделано для города на Каспии. Спокойно, когда всё хорошо, честно, когда неясно.', kk: 'Каспий жағасындағы қала үшін жасалған.' })}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 t-meta text-secondary sm:grid-cols-2 lg:max-w-[600px]">
            <a className="hover:text-text" href="https://www.gov.kz/memleket/entities/mangystau/press/news/details/1239493?lang=ru" target="_blank" rel="noreferrer">↗ gov.kz · 109 load, Mangystau region (2025–2026)</a>
            <a className="hover:text-text" href="https://adilet.kz/laws/109/" target="_blank" rel="noreferrer">↗ Adilet · 109 unified contact-centre regulation</a>
            <a className="hover:text-text" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">↗ Map & places © OpenStreetMap contributors</a>
            <span>Weather: Open-Meteo · Observations: RSE Kazhydromet (WMO WIS2)</span>
            <span>{lang === 'en' ? 'Demo incidents are labelled DEMO everywhere.' : 'Демонстрационные инциденты везде помечены DEMO.'}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function LangSwitch() {
  const { lang } = useApp()
  const order: Lang[] = ['ru', 'kk', 'en']
  return (
    <div className="flex rounded-full bg-surface p-0.5 hairline">
      {order.map((l) => (
        <button key={l} type="button" onClick={() => { setCookie('aktau_lang', l); location.reload() }}
          className={`tap h-8 rounded-full px-2.5 text-[11px] font-bold uppercase ${l === lang ? 'bg-text text-bg' : 'text-secondary hover:text-text'}`}>{l === 'kk' ? 'ҚАЗ' : l === 'ru' ? 'РУС' : 'ENG'}</button>
      ))}
    </div>
  )
}

function Nav() {
  const { tx } = useApp()
  return (
    <header className="glass fixed inset-x-0 top-0 z-40 border-b border-line">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-6 px-5 sm:px-10">
        <Link href="/welcome" className="flex items-center gap-2.5"><Logo size={32} /><span className="font-[family-name:var(--font-display)] text-[18px] font-semibold tracking-[-0.03em]">Aktau</span></Link>
        <nav className="hidden items-center gap-6 t-sub font-semibold text-secondary md:flex">
          <a href="#engine" className="hover:text-text">{tx({ en: 'How it works', ru: 'Как это работает', kk: 'Қалай жұмыс істейді' })}</a>
          <a href="#try" className="hover:text-text">{tx({ en: 'Try the copilot', ru: 'Попробовать', kk: 'Байқап көру' })}</a>
          <a href="#ops" className="hover:text-text">{tx({ en: 'For 109', ru: 'Для 109', kk: '109 үшін' })}</a>
          <a href="#trust" className="hover:text-text">{tx({ en: 'Trust', ru: 'Доверие', kk: 'Сенім' })}</a>
        </nav>
        <div className="flex-1" />
        <LangSwitch />
        <Link href="/" className="tap hidden h-10 items-center rounded-full bg-text px-4 text-[13px] font-bold text-bg sm:inline-flex">{tx({ en: 'Open Aktau', ru: 'Открыть Aktau', kk: 'Aktau ашу' })}</Link>
      </div>
    </header>
  )
}

function Hero({ pulse }: { pulse: Pulse }) {
  const { tx } = useApp()
  const [live, setLive] = useState(pulse)
  useEffect(() => {
    const id = setInterval(() => { fetch('/api/pulse').then((r) => r.json()).then(setLive).catch(() => {}) }, 15000)
    return () => clearInterval(id)
  }, [])
  return (
    <section className="relative flex flex-col overflow-hidden pt-16 lg:min-h-[100svh]">
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_70%_40%,#0b2f3d_0%,#06141c_60%)]" aria-hidden />
      <LighthouseMap className="absolute inset-0 hidden h-full w-full lg:block" />
      {/* Phones: the real coast instead of an abstract map in the empty top half. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={PHOTOS.night.src} alt="" className="absolute inset-x-0 top-0 h-[330px] w-full object-cover lg:hidden" />
      <div className="absolute inset-x-0 top-[170px] h-[160px] bg-gradient-to-b from-transparent to-bg lg:hidden" aria-hidden />
      <div className="absolute inset-y-0 left-0 hidden w-[60%] bg-gradient-to-r from-bg via-bg/75 to-transparent lg:block" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-bg via-bg/80 to-transparent lg:h-40 lg:via-transparent" aria-hidden />
      <div className="relative mx-auto flex w-full max-w-[1180px] flex-1 flex-col justify-start gap-8 px-5 pb-10 pt-[250px] sm:px-10 lg:justify-center lg:pb-24 lg:pt-8">
        <div className="flex max-w-[640px] flex-col gap-6">
          <p className="rise t-label text-secondary">{tx({ en: 'Aktau · Caspian coast · 43.65°N 51.16°E', ru: 'Актау · побережье Каспия · 43.65°N 51.16°E', kk: 'Ақтау · Каспий жағалауы · 43.65°N 51.16°E' })}</p>
          <h1 className="rise rise-1 t-display text-text [text-wrap:balance]">
            {tx({ en: '173 calls.', ru: '173 звонка.', kk: '173 қоңырау.' })}<br />
            <span className="beam-text">{tx({ en: 'One burst pipe.', ru: 'Одна прорванная труба.', kk: 'Бір жарылған құбыр.' })}</span>
          </h1>
          <p className="rise rise-2 max-w-[54ch] text-[16px] leading-relaxed text-secondary sm:text-[17px]">
            {tx({
              en: 'Aktau gathers what residents tell 109, by phone, WhatsApp, Instagram or this app, into one live picture of the city. And gives 109 an AI layer that sees incidents, not tickets.',
              ru: 'Aktau собирает всё, что жители сообщают в 109 — по телефону, в WhatsApp, Instagram или в приложении — в одну живую картину города. И даёт 109 AI-слой, который видит инциденты, а не заявки.',
              kk: 'Aktau тұрғындардың 109-ға айтқанының бәрін — телефон, WhatsApp, Instagram не қосымша арқылы — қаланың бір тірі бейнесіне жинайды. Ал 109-ға өтініштерді емес, оқиғаларды көретін AI қабатын береді.',
            })}
          </p>
          <div className="rise rise-3 flex flex-wrap gap-3">
            <Link href="/" className="tap beam-fill beam-glow inline-flex h-[52px] items-center gap-2 rounded-[16px] px-6 text-[15px] font-bold">{tx({ en: 'Open Aktau', ru: 'Открыть Aktau', kk: 'Aktau ашу' })}<Icon name="arrow" size={18} /></Link>
            <Link href="/report" className="tap inline-flex h-[52px] items-center gap-2 rounded-[16px] bg-surface px-5 text-[15px] font-bold text-text hairline"><Icon name="report" size={18} />{tx({ en: 'Report a problem', ru: 'Сообщить о проблеме', kk: 'Мәселе туралы хабарлау' })}</Link>
            <Link href="/demo" className="tap inline-flex h-[52px] items-center gap-2 rounded-[16px] px-3 text-[15px] font-bold text-secondary hover:text-text">{tx({ en: 'Watch the live demo', ru: 'Живое демо', kk: 'Тірі демо' })} →</Link>
          </div>
        </div>
        <div className="rise rise-4 glass flex w-full max-w-[640px] flex-wrap items-center gap-x-5 gap-y-2 rounded-[18px] px-4 py-3 hairline">
          <span className="flex items-center gap-2 t-label text-green"><span className="beacon text-green" data-live="true" />{tx({ en: 'Live', ru: 'Сейчас', kk: 'Қазір' })}</span>
          <span className="t-sub text-text"><b className="t-num text-[17px]">{live.open}</b> <span className="text-secondary">{tx({ en: 'open incidents', ru: 'открытых инцидентов', kk: 'ашық оқиға' })}</span></span>
          <span className="t-sub text-text"><b className="t-num text-[17px] beam-text">{live.merged}</b> <span className="text-secondary">{tx({ en: 'repeat reports merged', ru: 'повторов объединено', kk: 'қайталау біріктірілді' })}</span></span>
          <span className="t-sub text-text"><b className="t-num text-[17px]">{live.verified}</b> <span className="text-secondary">{tx({ en: 'verified by residents', ru: 'подтверждено жителями', kk: 'тұрғындар растады' })}</span></span>
        </div>
      </div>
    </section>
  )
}

function SectionHeader({ id, eyebrow, title, sub }: { id?: string; eyebrow: string; title: React.ReactNode; sub?: string }) {
  return (
    <div id={id} className="flex max-w-[760px] scroll-mt-24 flex-col gap-4">
      <p className="t-label text-beam">{eyebrow}</p>
      <h2 className="font-[family-name:var(--font-display)] text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-text [text-wrap:balance] sm:text-[42px]">{title}</h2>
      {sub ? <p className="max-w-[60ch] text-[16px] leading-relaxed text-secondary">{sub}</p> : null}
    </div>
  )
}

// ── The problem: appeals vs incidents ───────────────────────────────────────
function Problem() {
  const { tx } = useApp()
  const [merged, setMerged] = useState(false)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setMerged((m) => !m), 3200)
    return () => clearInterval(id)
  }, [])
  const N = 18
  return (
    <section className="px-5 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-14">
        <SectionHeader eyebrow={tx({ en: 'The problem', ru: 'Проблема', kk: 'Мәселе' })}
          title={tx({ en: '109 thinks in appeals. The city is made of incidents.', ru: '109 думает обращениями. Город состоит из инцидентов.', kk: '109 өтініштермен ойлайды. Қала оқиғалардан тұрады.' })}
          sub={tx({ en: 'When a water main breaks, a hundred neighbours call. Each call becomes its own card, its own routing, its own status question. The regulation already says repeat reports about an incident being handled should not be registered again, nobody has the tools to do it at speed.', ru: 'Когда прорывает водовод, звонят сто соседей. Каждый звонок — отдельная карточка, отдельная маршрутизация, отдельный вопрос «ну что там?». Регламент уже требует не регистрировать повторные сообщения об обрабатываемом инциденте — но инструментов делать это быстро нет.', kk: 'Су құбыры жарылғанда жүз көрші қоңырау шалады. Әр қоңырау — жеке карточка, жеке бағыт, жеке сұрақ.' })} />
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-8">
            <div className="flex flex-col gap-2"><dt className="order-2 t-sub text-secondary">{tx({ en: 'appeals to 109 in Mangystau region in 2025', ru: 'обращений в 109 по Мангистауской области за 2025 год', kk: '2025 жылы Маңғыстау облысы бойынша 109-ға өтініш' })}</dt><dd className="t-num whitespace-nowrap text-[38px] font-semibold leading-none text-text sm:text-[44px]">43 000+</dd></div>
            <div className="flex flex-col gap-2"><dt className="order-2 t-sub text-secondary">{tx({ en: 'already by 11 June 2026', ru: 'уже к 11 июня 2026 года', kk: '2026 жылдың 11 маусымына дейін' })}</dt><dd className="t-num whitespace-nowrap text-[38px] font-semibold leading-none text-text sm:text-[44px]">16.7k</dd></div>
            <div className="flex flex-col gap-2"><dt className="order-2 t-sub text-secondary">{tx({ en: 'minutes an executor may take just to accept or reject, then a wrong route goes back to line two', ru: 'минут у исполнителя только на принятие или отклонение — а неверный маршрут возвращается на вторую линию', kk: 'минут орындаушыда тек қабылдау не бас тартуға' })}</dt><dd className="t-num whitespace-nowrap text-[38px] font-semibold leading-none text-text sm:text-[44px]">120</dd></div>
            <div className="flex flex-col gap-2"><dt className="order-2 t-sub text-secondary">{tx({ en: 'lines every appeal travels: intake → dispatch → executor → back', ru: 'линии проходит каждое обращение: приём → распределение → исполнитель → обратно', kk: 'желі: қабылдау → бөлу → орындаушы → кері' })}</dt><dd className="t-num whitespace-nowrap text-[38px] font-semibold leading-none text-text sm:text-[44px]">3</dd></div>
            <p className="col-span-2 t-meta text-faint">{tx({ en: 'Sources: gov.kz (Mangystau akimat press service); 109 contact-centre regulation, 2025. Most appeals concern housing and utilities.', ru: 'Источники: gov.kz (пресс-служба акимата Мангистауской области); регламент единого контакт-центра 109, 2025. Большая часть обращений — ЖКХ.', kk: 'Дереккөздер: gov.kz; 109 регламенті, 2025.' })}</p>
          </dl>
          <div className="flex flex-col gap-5 rounded-[28px] bg-surface p-6 card-shadow sm:p-8" aria-live="polite">
            <div className="flex items-center justify-between">
              <p className="t-label text-secondary">{merged ? tx({ en: 'With Aktau', ru: 'С Aktau', kk: 'Aktau-мен' }) : tx({ en: 'Today', ru: 'Сегодня', kk: 'Бүгін' })}</p>
              <button type="button" onClick={() => setMerged((m) => !m)} className="tap rounded-full bg-surface-2 px-3 py-1.5 text-[12px] font-bold text-text hairline">{merged ? tx({ en: 'Show today', ru: 'Как сейчас', kk: 'Қазіргі' }) : tx({ en: 'Show with Aktau', ru: 'Как с Aktau', kk: 'Aktau-мен' })}</button>
            </div>
            <div className="relative h-[220px]">
              {Array.from({ length: N }, (_, i) => {
                const col = i % 6, row = Math.floor(i / 6)
                const x = merged ? 50 : 8 + col * 16.8
                const y = merged ? 50 : 14 + row * 36
                return (
                  <span key={i} className="absolute grid size-8 place-items-center rounded-full transition-all duration-[1100ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                    style={{ left: `calc(${x}% - 16px)`, top: `calc(${y}% - 16px)`, transitionDelay: `${i * 25}ms`, background: merged ? 'transparent' : 'var(--surface-2)', boxShadow: merged ? 'none' : 'inset 0 0 0 1px var(--line)' }}>
                    <Icon name="phone" size={14} className={`transition-opacity duration-500 ${merged ? 'opacity-0' : 'text-secondary'}`} />
                  </span>
                )
              })}
              <span className={`absolute left-1/2 top-1/2 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full beam-fill beam-glow transition-all duration-700 ${merged ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>
                <span className="flex flex-col items-center"><span className="t-num text-[30px] font-bold leading-none">18</span><span className="text-[10px] font-bold uppercase tracking-wider">signals</span></span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-5">
              <div className="flex flex-col gap-1.5">
                <p className="t-label text-faint">{tx({ en: 'Traditional flow', ru: 'Как сейчас', kk: 'Қазіргі' })}</p>
                <p className="t-sub text-secondary">18 {tx({ en: 'residents', ru: 'жителей', kk: 'тұрғын' })} → <b className="text-text">18</b> {tx({ en: 'interactions', ru: 'обращений', kk: 'өтініш' })} → {tx({ en: 'repeated explanations, repeated “any news?”', ru: 'повторные объяснения и «ну что там?»', kk: 'қайта-қайта түсіндіру' })}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="t-label text-beam">Aktau</p>
                <p className="t-sub text-secondary">18 {tx({ en: 'signals', ru: 'сигналов', kk: 'сигнал' })} → <b className="text-text">1</b> {tx({ en: 'incident', ru: 'инцидент', kk: 'оқиға' })} → <b className="text-text">1</b> {tx({ en: 'route', ru: 'маршрут', kk: 'бағыт' })} → <b className="text-text">1</b> {tx({ en: 'update', ru: 'обновление', kk: 'жаңалық' })} → 18 {tx({ en: 'informed', ru: 'в курсе', kk: 'хабардар' })}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── The engine: seven real steps ────────────────────────────────────────────
const STEPS: Array<{ icon: IconName; title: { en: string; ru: string; kk?: string }; body: { en: string; ru: string; kk?: string }; ai: boolean }> = [
  { icon: 'mic', ai: true, title: { en: 'Intake', ru: 'Приём', kk: 'Қабылдау' }, body: { en: 'Speech or text in Russian, Kazakh or English → service, address, start time, scope, risk, and what is still missing. The operator confirms instead of typing.', ru: 'Речь или текст на русском, казахском или английском → служба, адрес, время начала, масштаб, риск и чего не хватает. Оператор подтверждает, а не печатает.' } },
  { icon: 'merge', ai: true, title: { en: 'Match', ru: 'Сопоставление', kk: 'Сәйкестендіру' }, body: { en: 'Same service, same or neighbouring district, overlapping time → “likely duplicate, 97%”. One tap attaches the signal instead of opening a new card.', ru: 'Та же служба, тот же или соседний микрорайон, совпадающее время → «вероятный дубликат, 97%». Одно нажатие — и сигнал присоединён, новая карточка не нужна.' } },
  { icon: 'route', ai: true, title: { en: 'Route', ru: 'Маршрут', kk: 'Бағыт' }, body: { en: 'A responsibility graph, object → system → balance holder → service company → contractor, plus what worked here before. Ambiguous cases go to a human.', ru: 'Граф ответственности — объект → система → балансодержатель → обслуживающая → подрядчик — плюс то, что срабатывало здесь раньше. Спорное — человеку.' } },
  { icon: 'people', ai: false, title: { en: 'Confirm', ru: 'Подтверждение', kk: 'Растау' }, body: { en: 'A 109 operator confirms. The copilot proposes; people decide. Nothing official is decided by a model.', ru: 'Оператор 109 подтверждает. Copilot предлагает — решают люди. Ни одно официальное решение не принимает модель.' } },
  { icon: 'timer', ai: true, title: { en: 'SLA guardian', ru: 'Контроль сроков', kk: 'Мерзім бақылауы' }, body: { en: 'Not accepted in 120 minutes, returned before, no evidence near the deadline → “7 requests need intervention now”, instead of a monthly report.', ru: 'Не принято за 120 минут, уже возвращалось, нет доказательств у дедлайна → «7 заявок требуют вмешательства сейчас», а не ежемесячная справка.' } },
  { icon: 'camera', ai: true, title: { en: 'Proof', ru: 'Доказательство', kk: 'Дәлел' }, body: { en: 'Before/after photos with location and time. The copilot checks they match the place, differ, and actually show the fix, a daytime photo can’t prove a street light works.', ru: 'Фото «до/после» с геопозицией и временем. Copilot проверяет место, разницу и что исправление видно — дневное фото не докажет, что фонарь горит.' } },
  { icon: 'thumb', ai: false, title: { en: 'Reality check', ru: 'Проверка жителями', kk: 'Тұрғындар тексеруі' }, body: { en: '“109 marked it resolved, is it actually fixed?” A “no” returns it to the executor. Resolved means residents agree.', ru: '«109 отметила как решённое — действительно исправлено?» Ответ «нет» возвращает заявку исполнителю. Решено — значит жители согласны.' } },
]

function Engine() {
  const { tx } = useApp()
  const [active, setActive] = useState(0)
  return (
    <section className="relative px-5 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-12">
        <SectionHeader id="engine" eyebrow={tx({ en: 'The 109 incident engine', ru: 'Инцидентный движок 109', kk: '109 оқиғалар қозғалтқышы' })}
          title={tx({ en: 'From a resident’s words to a verified fix.', ru: 'От слов жителя до подтверждённого решения.', kk: 'Тұрғын сөзінен расталған шешімге дейін.' })}
          sub={tx({ en: 'Seven steps that 109 already has on paper. Aktau makes each one fast, visible and checkable. The glowing ones are where the copilot helps.', ru: 'Семь шагов, которые у 109 уже есть в регламенте. Aktau делает каждый быстрым, видимым и проверяемым. Светящиеся — там помогает Copilot.', kk: '109-да қағаз жүзінде бар жеті қадам.' })} />
        <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
          <ol className="flex flex-col gap-1">
            {STEPS.map((s, i) => (
              <li key={i}>
                <button type="button" onClick={() => setActive(i)} aria-current={i === active ? 'step' : undefined}
                  className={`tap flex w-full items-center gap-4 rounded-[18px] p-3 text-left ${i === active ? 'bg-surface card-shadow' : 'hover:bg-surface/60'}`}>
                  <span className={`grid size-11 flex-none place-items-center rounded-[14px] ${s.ai ? 'beam-fill' : 'bg-surface-2 text-text hairline'}`}><Icon name={s.icon} size={20} className={s.ai ? 'text-on-blue' : ''} /></span>
                  <span className="flex flex-col">
                    <span className="t-mono text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                    <span className="t-card text-text">{tx(s.title)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-6 rounded-[28px] bg-surface p-6 card-shadow sm:p-8">
            <div className="flex items-center gap-3">{STEPS[active]!.ai ? <CopilotTag /> : <Badge tone="neutral">{tx({ en: 'People decide', ru: 'Решают люди', kk: 'Адамдар шешеді' })}</Badge>}<span className="t-mono text-[12px] text-faint">{active + 1} / 7</span></div>
            <h3 className="t-title text-text">{tx(STEPS[active]!.title)}</h3>
            <p className="max-w-[58ch] text-[16px] leading-relaxed text-secondary">{tx(STEPS[active]!.body)}</p>
            <Specimen step={active} />
          </div>
        </div>
      </div>
    </section>
  )
}

/** A small piece of the real interface for each step. */
function Specimen({ step }: { step: number }) {
  const { tx, lang } = useApp()
  const frame = 'rounded-[20px] bg-bg p-5 hairline'
  if (step === 0) return (
    <div className={`${frame} flex flex-col gap-3`}>
      <p className="t-mono text-[12px] text-secondary">“{tx({ en: 'Hello, 14 microdistrict, house 21, no water since morning, neighbours too.', ru: 'Алло, 14 микрорайон, 21 дом, уже с утра воды нет, соседи тоже говорят нет.', kk: 'Алло, 14 шағын аудан, 21 үй, таңертеңнен су жоқ, көршілерде де жоқ.' })}”</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[[tx({ en: 'Category', ru: 'Категория' }), serviceName(lang, 'water')], [tx({ en: 'Location', ru: 'Адрес' }), '14 mkr · 21'], [tx({ en: 'Started', ru: 'Началось' }), tx({ en: 'this morning', ru: 'с утра' })], [tx({ en: 'Scope', ru: 'Масштаб' }), tx({ en: 'several homes', ru: 'несколько квартир' })]].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 rounded-[12px] bg-surface p-3 hairline"><span className="t-label !text-[9px] text-faint">{k}</span><span className="t-row text-text">{v}</span></div>
        ))}
      </div>
      <div className="flex items-center gap-3"><Meter value={0.98} tone="beam" /><span className="t-mono text-[11px] text-secondary">98%</span></div>
    </div>
  )
  if (step === 1) return (
    <div className={`${frame} flex flex-col gap-3`}>
      <div className="flex items-center justify-between"><span className="t-row text-text">{tx({ en: 'Likely duplicate', ru: 'Вероятный дубликат', kk: 'Ықтимал қайталау' })} — <span className="beam-text">97%</span></span><span className="t-mono text-[12px] text-faint">INC-1040</span></div>
      <p className="t-sub text-secondary">{incidentName(lang, 'water')} · 14–15 {lang === 'en' ? 'mkr' : 'мкр'} · 16 {tx({ en: 'reports', ru: 'обращений' })} · {tx({ en: 'started 08:14', ru: 'началось 08:14' })}</p>
      <p className="flex flex-wrap gap-1.5">{['same_service', 'same_area', 'overlapping_time'].map((r) => <span key={r} className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-bold text-secondary hairline">{tx(REASON[r]!)}</span>)}</p>
      <div className="grid grid-cols-2 gap-2"><span className="beam-fill grid h-10 place-items-center rounded-[12px] text-[13px] font-bold">{tx({ en: 'Attach signal', ru: 'Присоединить', kk: 'Қосу' })}</span><span className="grid h-10 place-items-center rounded-[12px] bg-surface text-[13px] font-bold text-text hairline">{tx({ en: 'Create separately', ru: 'Создать отдельно', kk: 'Бөлек ашу' })}</span></div>
    </div>
  )
  if (step === 2) return (
    <div className={`${frame} flex flex-col gap-2.5`}>
      {[['object', '14 mkr, house 20'], ['system', tx({ en: 'Facade & external units', ru: 'Фасад и внешние блоки' })], ['balance_holder', tx({ en: 'Owner / apartment owners', ru: 'Собственник / жильцы' })], ['service_company', 'OSI / KSK'], ['escalation', tx({ en: 'Police · 102, imminent danger', ru: 'Полиция · 102 — прямая опасность' })]].map(([l = '', n], i) => (
        <div key={i} className="flex items-center gap-3"><span className={`size-3 flex-none rounded-full ${l === 'service_company' ? 'beam-fill' : l === 'escalation' ? 'bg-red' : 'bg-surface-2 hairline'}`} /><span className="t-label w-32 flex-none !text-[9.5px] text-faint">{l.replace('_', ' ')}</span><span className="t-row text-text">{n}</span></div>
      ))}
      <p className="t-meta pt-1 text-amber">⚠ {tx({ en: 'Possible responsibility ambiguity, human review required.', ru: 'Возможна неоднозначность ответственности — нужна проверка человеком.' })}</p>
    </div>
  )
  if (step === 3) return (
    <div className={`${frame} flex items-center justify-between gap-4`}>
      <div className="flex flex-col"><span className="t-row text-text">{tx({ en: 'Route to KZhSA?', ru: 'Направить в КЖСА?' })}</span><span className="t-meta text-secondary">{tx({ en: 'Copilot 86% · 3 similar incidents resolved there', ru: 'Copilot 86% · 3 похожих инцидента решены там' })}</span></div>
      <span className="grid h-10 flex-none place-items-center rounded-[12px] bg-blue px-4 text-[13px] font-bold text-on-blue">{tx({ en: 'Confirm', ru: 'Подтвердить' })}</span>
    </div>
  )
  if (step === 4) return (
    <div className={`${frame} flex flex-col gap-3`}>
      <p className="t-row text-text">{tx({ en: '7 requests need intervention now', ru: '7 заявок требуют вмешательства сейчас' })}</p>
      {[['INC-1041', tx({ en: 'Street lights · 15 mkr', ru: 'Освещение · 15 мкр' }), tx({ en: 'Overdue 4 d', ru: 'Просрочено 4 д' }), 'bg-red text-bg'], ['INC-1046', tx({ en: 'Road · 27 mkr', ru: 'Дорога · 27 мкр' }), tx({ en: 'Executor silent', ru: 'Исполнитель молчит' }), 'bg-red-soft text-red'], ['INC-1049', tx({ en: 'Water · 7 mkr', ru: 'Вода · 7 мкр' }), tx({ en: 'Residents dispute', ru: 'Жители оспаривают' }), 'bg-amber-soft text-amber']].map(([c, t, s, cls]) => (
        <div key={c} className="flex items-center gap-3 rounded-[12px] bg-surface p-3 hairline"><span className="t-mono text-[11px] text-faint">{c}</span><span className="t-row flex-1 text-text">{t}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{s}</span></div>
      ))}
    </div>
  )
  if (step === 5) return (
    <div className={`${frame} flex flex-col gap-2`}>
      <p className="t-row text-text">{tx({ en: 'Complaint: street light doesn’t work', ru: 'Жалоба: не горит фонарь' })}</p>
      <p className="flex items-center gap-2 t-sub text-red"><Icon name="x" size={16} />{tx({ en: 'Cannot verify: photo taken at 13:10, daylight cannot show a working lamp.', ru: 'Нельзя подтвердить: фото сделано в 13:10 — днём не видно, что фонарь работает.' })}</p>
      <p className="flex items-center gap-2 t-sub text-green"><Icon name="check" size={16} />{tx({ en: 'Location matches · 18 m from the incident', ru: 'Геопозиция совпадает · 18 м от места' })}</p>
      <p className="flex items-center gap-2 t-sub text-green"><Icon name="check" size={16} />{tx({ en: 'Taken after the report', ru: 'Снято после обращения' })}</p>
    </div>
  )
  return (
    <div className={`${frame} flex flex-col gap-3`}>
      <p className="t-row text-text">{tx({ en: '109 marked your issue as resolved. Is it actually fixed?', ru: '109 отметила проблему как решённую. Действительно исправлено?' })}</p>
      <div className="grid grid-cols-2 gap-2"><span className="grid h-10 place-items-center rounded-[12px] bg-green text-[13px] font-bold text-bg">✓ {tx({ en: 'Yes', ru: 'Да' })}</span><span className="grid h-10 place-items-center rounded-[12px] bg-red-soft text-[13px] font-bold text-red">{tx({ en: 'No, return it', ru: 'Нет — вернуть' })}</span></div>
    </div>
  )
}

// ── Try the copilot, live ───────────────────────────────────────────────────
const SAMPLES: Record<Lang, string[]> = {
  ru: ['Алло, 14 микрорайон, 21 дом, уже с утра воды нет, соседи тоже', 'В 14 мкр возле дома 20 висит блок кондиционера, может упасть', 'Пахнет газом в подъезде, 27 мкр дом 14'],
  kk: ['14 ш/а 23 үйде су жоқ', '15 шағын аудан 7 үй жанында шамдар жанбайды', '12 ш/а 44 үй қоқыс шығарылмаған'],
  en: ['No water since yesterday evening, 14 mkr house 21', 'AC unit hanging over the entrance, 14 mkr house 20', 'Street lights out near house 7, 15 mkr, kids walk there'],
}

function TryIt() {
  const { tx, lang } = useApp()
  const [text, setText] = useState(SAMPLES[lang][0]!)
  const [p, setP] = useState<SignalPreview | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (text.trim().length < 4) { setP(null); return }
    const ctl = new AbortController()
    setBusy(true)
    const id = setTimeout(() => {
      fetch('/api/incidents/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: ctl.signal })
        .then((r) => r.json()).then(setP).catch(() => {}).finally(() => setBusy(false))
    }, 350)
    return () => { clearTimeout(id); ctl.abort() }
  }, [text])
  const i = p?.intake
  const m = p?.matches[0]
  return (
    <section className="px-5 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-12">
        <SectionHeader id="try" eyebrow={tx({ en: 'Try it, this is live', ru: 'Попробуйте — это живое', kk: 'Байқап көріңіз — бұл тірі' })}
          title={tx({ en: 'Type like a resident would.', ru: 'Напишите, как написал бы житель.', kk: 'Тұрғын сияқты жазыңыз.' })}
          sub={tx({ en: 'This runs the real copilot against Aktau’s real districts, buildings and open incidents. Deterministic, grounded in your words, in tens of milliseconds.', ru: 'Здесь работает настоящий Copilot — по реальным микрорайонам, домам и открытым инцидентам Актау. Детерминированно, опираясь на ваши слова, за десятки миллисекунд.', kk: 'Мұнда нағыз Copilot жұмыс істейді — Ақтаудың нақты аудандары мен үйлері бойынша.' })} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className={`flex min-w-0 flex-col gap-4 rounded-[28px] bg-surface p-6 card-shadow ${busy ? 'beam-edge' : ''}`}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={600}
              className="w-full resize-none bg-transparent text-[20px] font-semibold leading-snug text-text outline-none" aria-label="Message" />
            <div className="flex flex-wrap gap-2">
              {[...SAMPLES[lang], ...(lang !== 'kk' ? [SAMPLES.kk[0]!] : [])].map((s) => (
                <button key={s} type="button" onClick={() => setText(s)} className="tap max-w-full truncate rounded-full bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-secondary hairline hover:text-text">{s}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4 rounded-[28px] bg-surface p-6 card-shadow">
            <div className="flex items-center justify-between"><CopilotTag>{tx({ en: 'AI intake', ru: 'AI-приём', kk: 'AI қабылдау' })}</CopilotTag><span className="t-mono text-[11px] text-faint">{p ? `${p.ms} ms · ${i!.lang.toUpperCase()} · ${Math.round(i!.confidence * 100)}%` : '…'}</span></div>
            {i ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="grid size-12 place-items-center rounded-[14px] beam-fill"><Icon name={SERVICE_ICON[i.service]} size={22} className="text-on-blue" /></span>
                  <div className="flex flex-col"><span className="t-hero !text-[22px] text-text">{incidentName(lang, i.service)}</span><span className="t-sub text-secondary">{i.designator ? placeText(lang, { designator: i.designator, house: i.house }) : tx({ en: 'address missing', ru: 'нет адреса', kk: 'мекенжай жоқ' })}</span></div>
                </div>
                <dl className="grid grid-cols-2 gap-2">
                  {[
                    [tx({ en: 'Priority', ru: 'Приоритет', kk: 'Басымдық' }), i.priority],
                    [tx({ en: 'Risk', ru: 'Риск', kk: 'Қауіп' }), i.risk_flags.length ? i.risk_flags.map((f) => tx(REASON[f] ?? { en: f, ru: f })).join(', ') : tx({ en: 'none detected', ru: 'не выявлен', kk: 'анықталмады' })],
                    [tx({ en: 'Started', ru: 'Началось', kk: 'Басталды' }), i.started_text ?? '-'],
                    [tx({ en: 'Route', ru: 'Маршрут', kk: 'Бағыт' }), p!.route.org],
                  ].map(([k, v]) => <div key={k} className="flex flex-col gap-0.5 rounded-[12px] bg-surface-2 p-3 hairline"><dt className="t-label !text-[9px] text-faint">{k}</dt><dd className="t-row text-text">{v}</dd></div>)}
                </dl>
                {i.missing.length ? <p className="t-sub text-secondary">{tx({ en: 'Still missing:', ru: 'Не хватает:', kk: 'Жетпейді:' })} {i.missing.map((x) => tx(REASON[x] ?? { en: x, ru: x })).join(' · ')}</p> : null}
                {m ? (
                  <div className={`flex items-center justify-between gap-3 rounded-[16px] p-4 ${m.likely ? 'bg-beam-soft' : 'bg-surface-2 hairline'}`}>
                    <div className="flex flex-col"><span className="t-row text-text">{m.likely ? tx({ en: 'Already known to 109', ru: 'Уже известно 109', kk: '109-ға белгілі' }) : tx({ en: 'Similar incident', ru: 'Похожий инцидент', kk: 'Ұқсас оқиға' })} · {m.code}</span><span className="t-meta text-secondary">{m.signal_count} {tx({ en: 'reports', ru: 'обращений', kk: 'өтініш' })} · {m.reasons.map((r) => tx(REASON[r] ?? { en: r, ru: r })).join(', ')}</span></div>
                    <span className="t-num text-[24px] font-semibold beam-text">{Math.round(m.score * 100)}%</span>
                  </div>
                ) : <p className="t-sub text-secondary">{tx({ en: 'No open incident like this, it would open a new one.', ru: 'Похожего открытого инцидента нет — будет создан новый.', kk: 'Мұндай ашық оқиға жоқ — жаңасы ашылады.' })}</p>}
              </>
            ) : <div className="h-48 rounded-[16px] shimmer" />}
          </div>
        </div>
      </div>
    </section>
  )
}

// ── The resident app, live in phone frames ──────────────────────────────────
function Phone({ src, label }: { src: string; label: string }) {
  return (
    <figure className="flex flex-col items-center gap-4">
      <div className="relative h-[600px] w-[288px] overflow-hidden rounded-[44px] bg-[#020a0f] p-[10px] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
        <div className="absolute left-1/2 top-3 z-10 h-6 w-24 -translate-x-1/2 rounded-full bg-[#020a0f]" />
        <div className="h-full w-full overflow-hidden rounded-[34px] bg-bg">
          <iframe src={src} title={label} loading="lazy" className="h-[844px] w-[390px] origin-top-left scale-[0.689] border-0" />
        </div>
      </div>
      <figcaption className="t-sub font-semibold text-secondary">{label}</figcaption>
    </figure>
  )
}

function Screens() {
  const { tx } = useApp()
  return (
    <section className="overflow-hidden px-5 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-14">
        <SectionHeader eyebrow={tx({ en: 'For residents', ru: 'Для жителей', kk: 'Тұрғындар үшін' })}
          title={tx({ en: 'Your building, your city, one glance.', ru: 'Ваш дом, ваш город — одним взглядом.', kk: 'Үйіңіз, қалаңыз — бір қарағанда.' })}
          sub={tx({ en: 'Home shows your address the way Aktau paints it on its blocks, and only what affects you. The map shows official notices and what residents report. Report takes one sentence.', ru: 'Главная показывает ваш адрес так, как Актау пишет его на домах, и только то, что касается вас. Карта — официальные уведомления и обращения жителей. Сообщить — одно предложение.', kk: 'Басты бет мекенжайыңызды Ақтау үйлерге жазғандай көрсетеді.' })} />
        <div className="no-scrollbar -mx-5 flex gap-8 overflow-x-auto px-5 pb-4 sm:justify-center">
          <Phone src="/" label={tx({ en: 'Home', ru: 'Главная', kk: 'Басты' })} />
          <Phone src="/map?layer=109" label={tx({ en: 'Map · 109 incidents', ru: 'Карта · обращения 109', kk: 'Карта · 109' })} />
          <Phone src="/incident/INC-1040" label={tx({ en: 'One incident, 16 residents', ru: 'Один инцидент, 16 жителей', kk: 'Бір оқиға, 16 тұрғын' })} />
        </div>
      </div>
    </section>
  )
}

// ── For 109: the operator console ───────────────────────────────────────────
function OpsPreview() {
  const { tx } = useApp()
  return (
    <section className="px-5 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-12">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <SectionHeader id="ops" eyebrow={tx({ en: 'For 109 operators', ru: 'Для операторов 109', kk: '109 операторлары үшін' })}
            title={tx({ en: 'A console that thinks in incidents.', ru: 'Консоль, которая думает инцидентами.', kk: 'Оқиғалармен ойлайтын консоль.' })}
            sub={tx({ en: 'Incoming signals from every channel, the copilot’s reading of each, the duplicates, the route, the deadlines about to slip, and the evidence and answers checked before anything is closed.', ru: 'Сигналы со всех каналов, разбор каждого, дубликаты, маршрут, сроки на грани — и проверка доказательств и ответов до закрытия.', kk: 'Барлық арналардан келетін сигналдар, көшірмелер, бағыт, мерзімдер.' })} />
          <Link href="/copilot" className="tap beam-fill beam-glow inline-flex h-[52px] flex-none items-center gap-2 self-start rounded-[16px] px-6 text-[15px] font-bold lg:self-auto"><Icon name="radar" size={18} />{tx({ en: 'Open 109 Copilot', ru: 'Открыть 109 Copilot', kk: '109 Copilot ашу' })}</Link>
        </div>
        <div className="overflow-hidden rounded-[28px] bg-surface card-shadow">
          <div className="flex h-11 items-center gap-2 border-b border-line px-4"><span className="size-3 rounded-full bg-red/70" /><span className="size-3 rounded-full bg-amber/70" /><span className="size-3 rounded-full bg-green/70" /><span className="ml-3 t-mono text-[11px] text-faint">aktau.kz/copilot · 109 Copilot</span></div>
          <div className="grid gap-px bg-line lg:grid-cols-[280px_1fr_300px]">
            <div className="flex flex-col gap-2 bg-surface p-4">
              <p className="t-label text-faint">{tx({ en: 'Incoming', ru: 'Входящие', kk: 'Кіріс' })}</p>
              {[['PHONE', '14 мкр 21 дом, воды нет с утра…', '97%'], ['KOMEK109', '14 ш/а 23 үйде су жоқ', '95%'], ['WHATSAPP', '8 мкр дом 12, затопило подвал…', 'new']].map(([c, t, s]) => (
                <div key={t} className="flex flex-col gap-1 rounded-[14px] bg-bg p-3 hairline"><span className="flex items-center justify-between t-mono text-[10px] text-faint">{c}<span className={s === 'new' ? 'text-beam' : 'text-green'}>{s === 'new' ? 'NEW' : `dup ${s}`}</span></span><span className="t-sub truncate text-text">{t}</span></div>
              ))}
            </div>
            <div className="flex flex-col gap-4 bg-surface p-5">
              <div className="flex items-center justify-between"><span className="t-mono text-[12px] text-faint">INC-1040 · WATER · HIGH</span><span className="rounded-full bg-green-soft px-2 py-0.5 text-[11px] font-bold text-green">SLA 21 h left</span></div>
              <p className="t-title !text-[24px] text-text">{tx({ en: 'No water · 14 mkr', ru: 'Нет воды · 14 мкр', kk: 'Су жоқ · 14 ш/а' })}</p>
              <div className="flex items-end gap-4"><span className="t-num text-[56px] font-semibold leading-none beam-text">17</span><span className="t-sub pb-2 text-secondary">{tx({ en: 'signals → 1 incident · 5 channels · houses 16–26', ru: 'сигналов → 1 инцидент · 5 каналов · дома 16–26', kk: 'сигнал → 1 оқиға' })}</span></div>
              <div className="flex gap-2">{['Accept', 'Dispatch', 'Update all 17'].map((b, k) => <span key={b} className={`rounded-[12px] px-3 py-2 text-[12px] font-bold ${k === 2 ? 'beam-fill' : 'bg-bg text-text hairline'}`}>{b}</span>)}</div>
            </div>
            <div className="flex flex-col gap-3 bg-surface p-4">
              <p className="t-label text-faint">SLA guardian</p>
              <p className="t-row text-red">3 {tx({ en: 'need intervention now', ru: 'требуют вмешательства', kk: 'араласуды қажет етеді' })}</p>
              <p className="t-label pt-2 text-faint">Call QA</p>
              <div className="flex items-center gap-3"><Meter value={0.94} tone="green" /><span className="t-mono text-[11px] text-secondary">94% ok</span></div>
              <p className="t-meta text-secondary">{tx({ en: '6% flagged for review, never an automatic penalty.', ru: '6% — на проверку. Никаких автоматических штрафов.', kk: '6% тексеруге.' })}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── What AI can and cannot do ───────────────────────────────────────────────
function Honest() {
  const { tx } = useApp()
  const can = [
    { en: 'Slow intake', ru: 'Медленный приём' }, { en: 'Wrong category', ru: 'Неверная категория' }, { en: 'Duplicates', ru: 'Дубликаты' },
    { en: 'Wrong routing', ru: 'Неверная маршрутизация' }, { en: 'Lost context', ru: 'Потеря контекста' }, { en: 'Weak feedback', ru: 'Слабая обратная связь' },
    { en: 'Empty answers', ru: 'Пустые ответы' }, { en: 'Late escalation', ru: 'Поздняя эскалация' }, { en: 'Monthly hindsight', ru: 'Анализ задним числом' },
  ]
  return (
    <section className="px-5 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-12">
        <SectionHeader eyebrow={tx({ en: 'Honest about limits', ru: 'Честно о границах', kk: 'Шектеулер туралы шын' })}
          title={tx({ en: 'AI won’t fix a pipe. It will stop the pipe from getting lost.', ru: 'AI не починит трубу. Но не даст ей потеряться.', kk: 'AI құбырды жөндемейді. Бірақ оны жоғалтпайды.' })} />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-5 rounded-[28px] bg-surface p-7 card-shadow">
            <CopilotTag>{tx({ en: 'What the copilot fixes', ru: 'Что исправляет Copilot', kk: 'Copilot нені түзейді' })}</CopilotTag>
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{can.map((c) => <li key={c.en} className="flex items-center gap-2.5 t-row text-text"><Icon name="check" size={16} className="text-green" />{tx(c)}</li>)}</ul>
          </div>
          <div className="flex flex-col gap-5 rounded-[28px] bg-surface p-7 card-shadow">
            <Badge tone="neutral" className="self-start">{tx({ en: 'What it cannot', ru: 'Чего он не может', kk: 'Не істей алмайды' })}</Badge>
            <p className="text-[16px] leading-relaxed text-secondary">{tx({ en: 'It will not repair a main, bring a contractor, or replace an electrician. When the bottleneck is execution, the answer is accountability, so every closure needs proof, and every “resolved” is checked by the people who reported it.', ru: 'Он не починит водовод, не заставит подрядчика приехать и не заменит электрика. Когда узкое место — исполнение, ответ — подотчётность: каждое закрытие требует доказательства, а каждое «решено» проверяют те, кто сообщил.', kk: 'Ол құбырды жөндемейді, мердігерді әкелмейді. Сондықтан әр жабылу дәлелді талап етеді.' })}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[16px] bg-bg p-4 hairline"><Icon name="camera" size={18} className="text-beam" /><p className="mt-2 t-row text-text">{tx({ en: 'Proof of resolution', ru: 'Доказательство решения', kk: 'Шешім дәлелі' })}</p></div>
              <div className="rounded-[16px] bg-bg p-4 hairline"><Icon name="thumb" size={18} className="text-green" /><p className="mt-2 t-row text-text">{tx({ en: 'Citizen reality check', ru: 'Проверка жителями', kk: 'Тұрғындар тексеруі' })}</p></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── How it plugs into 109 ───────────────────────────────────────────────────
function Plugs() {
  const { tx } = useApp()
  const channels: Array<[IconName, string]> = [['phone', '109'], ['chat', 'WhatsApp'], ['instagram', 'Instagram'], ['report', 'Komek 109'], ['lighthouse', 'Aktau']]
  const layer = [
    { en: 'Intake', ru: 'Приём' }, { en: 'Matching', ru: 'Дубликаты' }, { en: 'Routing', ru: 'Маршрут' },
    { en: 'SLA guardian', ru: 'Сроки' }, { en: 'Quality', ru: 'Качество' }, { en: 'Proof', ru: 'Доказательства' },
  ]
  return (
    <section className="px-5 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-12">
        <SectionHeader eyebrow={tx({ en: 'Implementation', ru: 'Внедрение', kk: 'Енгізу' })}
          title={tx({ en: 'We don’t replace 109. We put an AI layer in front of it and around it.', ru: 'Мы не заменяем 109. Мы ставим AI-слой перед ней и вокруг неё.', kk: 'Біз 109-ды алмастырмаймыз. Оның алдына және айналасына AI қабатын қоямыз.' })}
          sub={tx({ en: '109 already has the processes: three lines, classification, criticality, repeat-report rules, evidence, answer control. Aktau sits between the incoming signal and the execution, and gives residents the citizen interface to the same incident graph.', ru: 'У 109 уже есть процессы: три линии, классификация, критичность, правила повторных сообщений, доказательства, контроль ответа. Aktau встаёт между входящим сигналом и исполнением — и даёт жителям гражданский интерфейс к тому же графу инцидентов.', kk: '109-да процестер бар. Aktau кіріс сигнал мен орындаудың арасында тұрады.' })} />
        <div className="grid items-stretch gap-4 lg:grid-cols-[200px_1fr_220px]">
          <div className="flex flex-row flex-wrap gap-2 lg:flex-col">
            {channels.map(([ic, l]) => <div key={l} className="flex items-center gap-2.5 rounded-[14px] bg-surface px-3 py-2.5 card-shadow"><Icon name={ic} size={16} className="text-secondary" /><span className="t-row text-text">{l}</span></div>)}
          </div>
          <div className="beam-edge flex flex-col gap-4 rounded-[28px] bg-surface p-6 card-shadow">
            <div className="flex items-center justify-between"><CopilotTag>Aktau AI layer</CopilotTag><span className="t-mono text-[11px] text-faint">City Incident Graph</span></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{layer.map((l) => <div key={l.en} className="rounded-[14px] bg-bg px-3 py-3 t-row text-text hairline">{tx(l)}</div>)}</div>
            <p className="t-sub text-secondary">{tx({ en: 'signals + official notices + place + responsible organisation + history + evidence + statuses + residents’ confirmations, one object per real problem', ru: 'сигналы + официальные уведомления + место + ответственная организация + история + доказательства + статусы + подтверждения жителей — один объект на одну реальную проблему', kk: 'бір нақты мәселеге бір объект' })}</p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-1 flex-col justify-center gap-1 rounded-[20px] bg-surface p-4 card-shadow"><span className="t-label text-faint">{tx({ en: 'Existing', ru: 'Существующая', kk: 'Бар' })}</span><span className="t-card text-text">109 АИС</span><span className="t-meta text-secondary">{tx({ en: 'lines 1 · 2 · 3', ru: 'линии 1 · 2 · 3', kk: '1 · 2 · 3 желі' })}</span></div>
            <div className="flex flex-1 flex-col justify-center gap-1 rounded-[20px] bg-surface p-4 card-shadow"><span className="t-label text-faint">{tx({ en: 'Executors', ru: 'Исполнители', kk: 'Орындаушылар' })}</span><span className="t-card text-text">KZhSA · AUES · MAEK · OSI</span></div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Trust() {
  const { tx } = useApp()
  const items: Array<[IconName, { en: string; ru: string; kk?: string }, { en: string; ru: string; kk?: string }]> = [
    ['shield', { en: 'Every fact has a source', ru: 'У каждого факта есть источник', kk: 'Әр фактінің дереккөзі бар' }, { en: 'Tap any notice: source text → raw record → extracted fields → city event → updates.', ru: 'Любое уведомление: исходный текст → сырая запись → извлечённые поля → событие → обновления.' }],
    ['sparkle', { en: 'Deterministic first', ru: 'Сначала — правила', kk: 'Алдымен — ережелер' }, { en: 'The copilot works without a network or a model. A model can only phrase, never invent a time, house or organisation.', ru: 'Copilot работает без сети и без модели. Модель может лишь сформулировать — не придумать время, дом или организацию.' }],
    ['people', { en: 'People confirm', ru: 'Подтверждают люди', kk: 'Адамдар растайды' }, { en: 'Operators confirm routes, executors close, residents verify. The AI only proposes.', ru: 'Операторы подтверждают маршрут, исполнители закрывают, жители проверяют. AI только предлагает.' }],
    ['eye', { en: 'Private by default', ru: 'Приватно по умолчанию', kk: 'Әдепкі бойынша жеке' }, { en: 'No account needed. Residents’ own words are visible only to 109, never on the public map.', ru: 'Без аккаунта. Тексты обращений видит только 109 — на публичной карте их нет.' }],
  ]
  return (
    <section className="px-5 pb-28 pt-12 sm:px-10">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-12">
        <SectionHeader id="trust" eyebrow={tx({ en: 'Trust', ru: 'Доверие', kk: 'Сенім' })} title={tx({ en: 'Calm when clear. Honest when uncertain.', ru: 'Спокойно, когда ясно. Честно, когда неясно.', kk: 'Анық болса — тыныш. Белгісіз болса — адал.' })} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([ic, t, b]) => (
            <div key={t.en} className="flex flex-col gap-3 rounded-[24px] bg-surface p-6 card-shadow">
              <Icon name={ic} size={22} className="text-blue" />
              <p className="t-card text-text">{tx(t)}</p>
              <p className="t-sub text-secondary">{tx(b)}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center gap-5 rounded-[32px] bg-surface px-6 py-14 text-center card-shadow">
          <Logo size={56} />
          <p className="font-[family-name:var(--font-display)] text-[28px] font-semibold tracking-[-0.03em] text-text sm:text-[36px]">{tx({ en: 'Your city, in one place.', ru: 'Ваш город — в одном месте.', kk: 'Қалаңыз — бір жерде.' })}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/" className="tap beam-fill beam-glow inline-flex h-[52px] items-center gap-2 rounded-[16px] px-6 text-[15px] font-bold">{tx({ en: 'Open Aktau', ru: 'Открыть Aktau', kk: 'Aktau ашу' })}<Icon name="arrow" size={18} /></Link>
            <Link href="/you/home" className="tap inline-flex h-[52px] items-center gap-2 rounded-[16px] bg-bg px-5 text-[15px] font-bold text-text hairline"><Icon name="pin" size={18} />{tx({ en: 'Set my home', ru: 'Указать мой дом', kk: 'Үйімді көрсету' })}</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
