'use client'
// Start · the first launch. The logo comes alive (the tower rises out of the
// sea, the lamp lights, the beams sweep like a turning lamp), then five short
// steps fill in what Aktau needs: language, a name to greet you by, your home
// (microdistrict + house, shown on the facade plaque as you type), what to be
// told about, and location. Every step but language can be skipped. At the end
// the beams flare and the light carries you into the app.
//
// Motion: CSS only (globals.css "Entrance"). Rare, first-time surface, so this
// is where the app spends its delight budget; prefers-reduced-motion keeps the
// fades and drops the movement.
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { AlertPreferences, Lang } from '@aktau/types'
import { Icon, Plaque, Toggle, type IconName } from './primitives'

type L3 = { en: string; ru: string; kk: string }
type Hit = { kind: string; id: string; label: string; sublabel: string; designator?: string | null }
type Home = { kind: 'building' | 'area'; id: string; designator: string; house: string | null; label: string } | null
type Step = 'lang' | 'name' | 'home' | 'alerts' | 'location'
const STEPS: Step[] = ['lang', 'name', 'home', 'alerts', 'location']

const setCookie = (n: string, v: string) => { document.cookie = `${n}=${encodeURIComponent(v)}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax` }

const LANGS: Array<{ id: Lang; name: string; hello: string }> = [
  { id: 'kk', name: 'Қазақша', hello: 'Сәлем, Ақтау' },
  { id: 'ru', name: 'Русский', hello: 'Привет, Актау' },
  { id: 'en', name: 'English', hello: 'Hello, Aktau' },
]

const ALERTS: Array<{ key: keyof AlertPreferences; icon: IconName; label: L3 }> = [
  { key: 'water', icon: 'water', label: { en: 'Water', ru: 'Вода', kk: 'Су' } },
  { key: 'electricity', icon: 'power', label: { en: 'Electricity', ru: 'Свет', kk: 'Жарық' } },
  { key: 'heating', icon: 'flame', label: { en: 'Heating', ru: 'Отопление', kk: 'Жылу' } },
  { key: 'road', icon: 'roads', label: { en: 'Roads', ru: 'Дороги', kk: 'Жолдар' } },
  { key: 'weather', icon: 'wind', label: { en: 'Storms & weather', ru: 'Шторм и погода', kk: 'Дауыл мен ауа райы' } },
  { key: 'events', icon: 'calendar', label: { en: 'City events', ru: 'События в городе', kk: 'Қала шаралары' } },
]

/** The logo, traced as SVG so each part can move: beams, lantern glow, tower, sea. */
export function LighthouseArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="170 255 915 740" className={className} aria-hidden>
      <defs>
        <linearGradient id="lh-beam-l" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0.95" /><stop offset="1" stopColor="#fff" stopOpacity="0.28" /></linearGradient>
        <linearGradient id="lh-beam-r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0.95" /><stop offset="1" stopColor="#fff" stopOpacity="0.28" /></linearGradient>
        <linearGradient id="lh-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#d7e9fb" /></linearGradient>
        <radialGradient id="lh-halo"><stop offset="0" stopColor="#fff" stopOpacity="0.9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      </defs>
      <g className="lh-beam lh-beam-l"><path d="M520 432 L262 342 C200 322 186 372 186 444 C186 516 200 566 262 546 L520 458 C532 454 532 436 520 432 Z" fill="url(#lh-beam-l)" /></g>
      <g className="lh-beam lh-beam-r"><path d="M736 432 L994 342 C1056 322 1070 372 1070 444 C1070 516 1056 566 994 546 L736 458 C724 454 724 436 736 432 Z" fill="url(#lh-beam-r)" /></g>
      <circle className="lh-halo" cx="628" cy="446" r="150" fill="url(#lh-halo)" />
      <g className="lh-tower">
        <rect x="611" y="272" width="32" height="70" rx="16" fill="#fff" />
        <path d="M556 392 C556 356 588 336 627 336 C666 336 698 356 698 392 Z" fill="#fff" />
        <rect x="512" y="384" width="230" height="40" rx="20" fill="#fff" />
        <path d="M536 418 L720 418 L706 508 L550 508 Z" fill="#fff" />
        <path className="lh-lamp" d="M556 430 L578 430 L588 494 L565 494 Z M598 424 L656 424 L650 490 L604 490 Z M676 430 L698 430 L689 494 L666 494 Z" fill="#2c8ef8" />
        <rect x="516" y="502" width="224" height="42" rx="21" fill="#fff" />
        <path d="M546 548 L574 544 L682 544 L708 548 L746 930 L512 930 Z" fill="url(#lh-body)" />
      </g>
      <path className="lh-wave" d="M278 972 C360 900 440 858 510 852 C600 846 680 894 760 930 C830 958 910 948 986 908 C930 960 860 988 770 986 C690 984 620 950 540 918 C460 890 380 912 278 972 Z" fill="#fff" />
    </svg>
  )
}

export function StartView({ initialLang }: { initialLang: Lang }) {
  const router = useRouter()
  const [lang, setLang] = useState<Lang>(initialLang)
  const tx = (s: L3) => s[lang]
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState<'next' | 'back'>('next')
  const [finishing, setFinishing] = useState(false)
  const [name, setName] = useState('')
  const [home, setHome] = useState<Home>(null)
  const [prefs, setPrefs] = useState<Record<string, boolean>>({ water: true, electricity: true, heating: true, road: true, weather: true, events: false })
  const [located, setLocated] = useState<'idle' | 'asking' | 'ok' | 'denied'>('idle')
  const [busy, setBusy] = useState(false)
  // The long first-launch stagger plays once; coming back to a step is instant.
  const [intro, setIntro] = useState(true)
  useEffect(() => { const id = setTimeout(() => setIntro(false), 2200); return () => clearTimeout(id) }, [])
  const current = STEPS[step]!
  const splash = step === 0 && !finishing

  const go = (to: number) => { setDir(to > step ? 'next' : 'back'); setStep(to) }

  const chooseLang = (l: Lang) => {
    setLang(l)
    setCookie('aktau_lang', l)
    const iid = document.cookie.match(/aktau_iid=([^;]+)/)?.[1]
    if (iid) void fetch('/api/device/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installation_id: iid, platform: 'web', language: l }) }).catch(() => {})
    go(1)
  }

  const saveHome = async () => {
    if (!home) return go(3)
    setBusy(true)
    await fetch('/api/me/locations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Home', type: 'HOME', ...(home.kind === 'building' ? { building_id: home.id } : { area_id: home.id }) }) }).catch(() => {})
    setBusy(false)
    go(3)
  }

  const saveAlerts = async () => {
    setBusy(true)
    await fetch('/api/me/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...prefs, transport: false, emergency: true, affects_me_only: true, minimum_severity: 'MINOR' }) }).catch(() => {})
    setBusy(false)
    go(4)
  }

  const askLocation = () => {
    if (!('geolocation' in navigator)) { setLocated('denied'); return }
    setLocated('asking')
    navigator.geolocation.getCurrentPosition(() => setLocated('ok'), () => setLocated('denied'), { timeout: 12_000 })
  }

  const finish = () => {
    if (name.trim()) setCookie('aktau_name', name.trim().slice(0, 40))
    setCookie('aktau_onboarded', '1')
    setCookie('aktau_welcomed', '1')
    setFinishing(true)
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    setTimeout(() => { router.replace('/'); router.refresh() }, reduce ? 350 : 1500)
  }

  return (
    <div className={`start relative h-dvh w-full overflow-hidden text-white ${splash ? 'is-splash' : ''} ${finishing ? 'is-finishing' : ''}`}>
      <div className="start-sky absolute inset-0" aria-hidden />

      {/* The lighthouse: big on the splash, a guiding header during the steps, back in the centre at the end. */}
      <div className="start-hero pointer-events-none absolute inset-x-0 top-[max(env(safe-area-inset-top),20px)] flex flex-col items-center">
        <LighthouseArt className="lh w-[min(66vw,300px)] drop-shadow-[0_18px_40px_rgb(0_40_120/0.25)]" />
        <div className="start-word mt-5 flex flex-col items-center gap-1.5 text-center">
          <span className="font-[family-name:var(--font-display)] text-[46px] font-semibold leading-none tracking-[-0.04em]">{lang === 'kk' ? 'Ақтау' : lang === 'ru' ? 'Актау' : 'Aktau'}</span>
          <span className="start-tag text-[15px] font-medium text-white/85">{tx({ en: 'Your city, in one place', ru: 'Ваш город в одном месте', kk: 'Қалаңыз бір жерде' })}</span>
        </div>
        <span className="start-final pointer-events-none mt-5 text-center font-[family-name:var(--font-display)] text-[28px] font-semibold leading-tight tracking-[-0.03em]">
          {name.trim() ? tx({ en: `Welcome, ${name.trim()}`, ru: `Добро пожаловать, ${name.trim()}`, kk: `Қош келдіңіз, ${name.trim()}` }) : tx({ en: 'Welcome to Aktau', ru: 'Добро пожаловать в Актау', kk: 'Ақтауға қош келдіңіз' })}
        </span>
      </div>

      {/* The sheet with the steps. Outer wrapper moves between splash / steps / finish; inner one slides up once on arrival. */}
      <div className="start-sheet-pos absolute inset-x-0 bottom-0">
        <div className="start-sheet mx-auto flex h-[74dvh] max-w-[560px] flex-col rounded-t-[32px] bg-surface text-text shadow-[0_-20px_60px_-20px_rgb(0_30_90/0.45)]">
          <div className="flex items-center gap-3 px-5 pt-4">
            {step > 0 ? (
              <button type="button" onClick={() => go(step - 1)} aria-label={tx({ en: 'Back', ru: 'Назад', kk: 'Артқа' })} className="tap -ml-1.5 grid size-9 place-items-center rounded-full text-secondary hover:bg-surface-2"><Icon name="back" size={18} /></button>
            ) : <span className="size-9" />}
            <div className="flex flex-1 gap-1.5" aria-label={`${step + 1} / ${STEPS.length}`}>
              {STEPS.map((s, i) => <span key={s} className="h-1 flex-1 overflow-hidden rounded-full bg-border"><span className="start-progress block h-full rounded-full bg-blue" style={{ transform: `scaleX(${i < step ? 1 : i === step ? 0.5 : 0})` }} /></span>)}
            </div>
            {step > 0 && step < STEPS.length - 1 ? (
              <button type="button" onClick={() => go(step + 1)} className="tap h-9 rounded-full px-2 text-[13px] font-semibold text-secondary hover:text-text">{tx({ en: 'Skip', ru: 'Пропустить', kk: 'Өткізу' })}</button>
            ) : <span className="w-9" />}
          </div>

          <div key={current} className={`start-step flex min-h-0 flex-1 flex-col px-6 pb-[max(env(safe-area-inset-bottom),20px)] pt-5 ${dir === 'back' ? 'from-back' : ''}`}>
            {current === 'lang' ? (
              <>
                <h1 className="t-title text-text">{tx({ en: 'Choose your language', ru: 'Выберите язык', kk: 'Тілді таңдаңыз' })}</h1>
                <div className="mt-5 flex flex-col gap-2.5">
                  {LANGS.map((l, i) => (
                    <button key={l.id} type="button" onClick={() => chooseLang(l.id)} style={{ animationDelay: `${intro ? 1350 + i * 70 : i * 50}ms` }}
                      className={`start-item tap flex h-[64px] items-center gap-4 rounded-[18px] px-4 text-left ${l.id === lang ? 'bg-soft ring-2 ring-blue' : 'bg-surface-2 hairline'}`}>
                      <span className="flex flex-1 flex-col"><span className="text-[17px] font-semibold text-text">{l.name}</span><span className="t-meta text-secondary">{l.hello}</span></span>
                      <Icon name="arrow" size={18} className="text-blue" />
                    </button>
                  ))}
                </div>
              </>
            ) : current === 'name' ? (
              <>
                <h1 className="t-title text-text">{tx({ en: 'What should we call you?', ru: 'Как к вам обращаться?', kk: 'Сізге қалай жүгінейік?' })}</h1>
                <p className="mt-2 t-sub text-secondary">{tx({ en: 'Only to greet you. It stays on this phone.', ru: 'Только чтобы здороваться. Имя остаётся на этом телефоне.', kk: 'Тек амандасу үшін. Есім осы телефонда қалады.' })}</p>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" enterKeyHint="next"
                  onKeyDown={(e) => { if (e.key === 'Enter') go(2) }}
                  placeholder={tx({ en: 'Your name', ru: 'Ваше имя', kk: 'Есіміңіз' })}
                  className="mt-6 h-[60px] rounded-[18px] bg-surface-2 px-5 text-[20px] font-semibold text-text outline-none hairline placeholder:font-medium placeholder:text-faint focus:ring-2 focus:ring-blue" />
                <div className="flex-1" />
                <Primary onClick={() => go(2)}>{tx({ en: 'Continue', ru: 'Дальше', kk: 'Әрі қарай' })}</Primary>
              </>
            ) : current === 'home' ? (
              <HomeStep lang={lang} tx={tx} home={home} setHome={setHome} busy={busy} onNext={() => void saveHome()} />
            ) : current === 'alerts' ? (
              <>
                <h1 className="t-title text-text">{tx({ en: 'What should we tell you about?', ru: 'О чём сообщать?', kk: 'Не туралы хабарлайық?' })}</h1>
                <p className="mt-2 t-sub text-secondary">{tx({ en: 'Only what affects your home. Emergencies always come through.', ru: 'Только то, что касается вашего дома. Экстренное — всегда.', kk: 'Тек үйіңізге қатыстысы. Төтенше жағдай әрқашан келеді.' })}</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {ALERTS.map((a, i) => (
                    <label key={a.key} style={{ animationDelay: `${80 + i * 45}ms` }} className={`start-item flex cursor-pointer flex-col gap-2.5 rounded-[18px] p-3 transition-colors duration-200 ${prefs[a.key] ? 'bg-soft' : 'bg-surface-2 hairline'}`}>
                      <span className="flex items-center justify-between">
                        <span className={`grid size-9 place-items-center rounded-[12px] ${prefs[a.key] ? 'bg-blue text-on-blue' : 'bg-surface text-secondary hairline'}`}><Icon name={a.icon} size={18} /></span>
                        <Toggle checked={!!prefs[a.key]} onChange={(v) => setPrefs((p) => ({ ...p, [a.key]: v }))} label={tx(a.label)} />
                      </span>
                      <span className="t-row text-text">{tx(a.label)}</span>
                    </label>
                  ))}
                </div>
                <div className="flex-1" />
                <Primary disabled={busy} onClick={() => void saveAlerts()}>{tx({ en: 'Continue', ru: 'Дальше', kk: 'Әрі қарай' })}</Primary>
              </>
            ) : (
              <>
                <h1 className="t-title text-text">{tx({ en: 'Use your location?', ru: 'Использовать геолокацию?', kk: 'Геолокацияны қолданайық па?' })}</h1>
                <p className="mt-2 t-sub text-secondary">{tx({ en: 'For "near me" answers, the nearest open pharmacy, and "can I swim here?" on the coast. Used for the answer, never stored.', ru: 'Для ответов «рядом со мной», ближайшей открытой аптеки и «можно ли здесь купаться?». Только для ответа, не сохраняется.', kk: '«Маған жақын» жауаптары, ең жақын ашық дәріхана және «мұнда шомылуға бола ма?» үшін. Тек жауап үшін, сақталмайды.' })}</p>
                <div className="flex flex-1 items-center justify-center">
                  <span className={`start-pin relative grid size-24 place-items-center rounded-full ${located === 'ok' ? 'bg-green-soft text-green' : 'bg-soft text-blue'}`}>
                    {located !== 'ok' ? <span className="start-pin-ring absolute inset-0 rounded-full border-2 border-blue" /> : null}
                    <Icon name={located === 'ok' ? 'check' : 'pin'} size={38} />
                  </span>
                </div>
                {located === 'denied' ? <p className="mb-3 text-center t-sub text-secondary">{tx({ en: 'No problem. You can turn it on later in the browser settings.', ru: 'Ничего страшного. Можно включить позже в настройках браузера.', kk: 'Ештеңе етпейді. Кейін браузер баптауларынан қосуға болады.' })}</p> : null}
                {located === 'ok' || located === 'denied'
                  ? <Primary onClick={finish}>{tx({ en: 'Open Aktau', ru: 'Открыть Актау', kk: 'Ақтауды ашу' })}</Primary>
                  : (
                    <div className="flex flex-col gap-2">
                      <Primary disabled={located === 'asking'} onClick={askLocation}>{located === 'asking' ? tx({ en: 'Waiting for permission…', ru: 'Ждём разрешения…', kk: 'Рұқсат күтілуде…' }) : tx({ en: 'Allow location', ru: 'Разрешить', kk: 'Рұқсат беру' })}</Primary>
                      <button type="button" onClick={finish} className="tap h-12 rounded-[16px] text-[15px] font-semibold text-secondary hover:text-text">{tx({ en: 'Not now', ru: 'Не сейчас', kk: 'Қазір емес' })}</button>
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="start-flash pointer-events-none absolute inset-0" aria-hidden />
    </div>
  )
}

function Primary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="tap inline-flex h-[54px] w-full items-center justify-center gap-2 rounded-[18px] bg-blue text-[16px] font-bold text-on-blue shadow-[0_10px_24px_-12px_var(--blue)] disabled:opacity-50">
      {children}
    </button>
  )
}

function HomeStep({ lang, tx, home, setHome, busy, onNext }: { lang: Lang; tx: (s: L3) => string; home: Home; setHome: (h: Home) => void; busy: boolean; onNext: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [area, setArea] = useState<Hit | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const query = area ? `${area.designator ?? ''} ${q}` : q
    if (!query.trim() || home) { setHits([]); return }
    const ctl = new AbortController()
    const id = setTimeout(() => {
      fetch(`/api/areas/search?q=${encodeURIComponent(query.trim())}&lang=${lang}`, { signal: ctl.signal }).then((r) => r.json()).then((d) => setHits(d.results.slice(0, 5))).catch(() => {})
    }, 150)
    return () => { clearTimeout(id); ctl.abort() }
  }, [q, area, home, lang])

  // The plaque fills in as you type: "14 21" → 14 / 21, like the numbers painted on Aktau's facades.
  const typed = q.match(/^\s*(\d{1,2}[а-яa-zәғқңөұүһі]?)\s*(?:[ ,/-]\s*(\d{1,3}[а-яa-z]?))?\s*$/i)
  const district = home?.designator ?? area?.designator ?? typed?.[1]?.toUpperCase() ?? null
  const house = home ? home.house : area ? (q.trim() || null) : typed?.[2]?.toUpperCase() ?? null
  const pick = (h: Hit) => {
    if (h.kind === 'building') {
      // "14-й микрорайон, 21" → 14 / 21
      const m = h.label.match(/^(\d+[^\s,-]?)\D.*,\s*(\S+)$/)
      setHome({ kind: 'building', id: h.id, designator: area?.designator ?? m?.[1]?.toUpperCase() ?? typed?.[1]?.toUpperCase() ?? '', house: m?.[2] ?? null, label: h.label })
    } else { setArea(h); setQ(''); inputRef.current?.focus() }
  }
  return (
    <>
      <h1 className="t-title text-text">{tx({ en: 'Where do you live?', ru: 'Где вы живёте?', kk: 'Қай жерде тұрасыз?' })}</h1>
      <p className="mt-2 t-sub text-secondary">{tx({ en: 'Microdistrict and house, e.g. "14 21". Outages are announced house by house.', ru: 'Микрорайон и дом, например «14 21». Отключения объявляют по домам.', kk: 'Шағын аудан мен үй, мысалы «14 21». Өшірулер үй бойынша жарияланады.' })}</p>
      <div className="mt-4 flex h-[104px] items-center justify-center rounded-[22px] bg-surface-2 hairline panel-seams">
        {district ? <span key={`${district}/${house ?? ''}`} className="start-plaque"><Plaque district={district} house={house || '··'} size={58} /></span>
          : <span className="plaque text-[58px] text-faint/60">?? / ??</span>}
      </div>
      {home ? (
        <div className="start-item mt-3 flex items-center gap-3 rounded-[16px] bg-soft px-4 py-3">
          <Icon name="check" size={18} className="text-blue" />
          <span className="flex-1 t-row text-text">{home.label}</span>
          <button type="button" className="t-meta font-bold text-blue" onClick={() => { setHome(null); setArea(null); setQ('') }}>{tx({ en: 'Change', ru: 'Изменить', kk: 'Өзгерту' })}</button>
        </div>
      ) : (
        <>
          <label className="mt-3 flex h-[56px] items-center gap-3 rounded-[18px] bg-surface-2 px-4 hairline focus-within:ring-2 focus-within:ring-blue">
            <Icon name="search" size={19} className="text-secondary" />
            {area ? <span className="rounded-full bg-soft px-2.5 py-1 text-[13px] font-bold text-blue-strong">{area.designator} {lang === 'en' ? 'mkr' : lang === 'kk' ? 'ш/а' : 'мкр'}</span> : null}
            <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} inputMode={area ? 'numeric' : 'text'}
              placeholder={area ? tx({ en: 'House number', ru: 'Номер дома', kk: 'Үй нөмірі' }) : '14 21'}
              className="h-full min-w-0 flex-1 bg-transparent text-[17px] font-semibold text-text outline-none placeholder:font-medium placeholder:text-faint" />
          </label>
          <div className="mt-2 flex min-h-0 flex-col gap-1.5 overflow-y-auto">
            {hits.map((h, i) => (
              <button key={`${h.kind}-${h.id}`} type="button" onClick={() => pick(h)} style={{ animationDelay: `${i * 35}ms` }}
                className="start-item tap flex min-h-[52px] items-center gap-3 rounded-[14px] px-3 text-left hover:bg-surface-2">
                <Icon name={h.kind === 'building' ? 'building' : 'pin'} size={18} className="text-blue" />
                <span className="flex min-w-0 flex-1 flex-col"><span className="t-row truncate text-text">{h.label}</span><span className="t-meta truncate text-secondary">{h.sublabel}</span></span>
              </button>
            ))}
            {area && !hits.length ? (
              <button type="button" onClick={() => setHome({ kind: 'area', id: area.id, designator: area.designator ?? '', house: null, label: area.label })} className="tap mt-1 h-11 rounded-[14px] text-[14px] font-semibold text-blue hover:bg-surface-2">
                {tx({ en: 'Use the whole microdistrict', ru: 'Весь микрорайон', kk: 'Бүкіл шағын аудан' })}
              </button>
            ) : null}
          </div>
        </>
      )}
      <div className="flex-1" />
      <Primary disabled={busy} onClick={onNext}>{home ? tx({ en: 'Save my home', ru: 'Сохранить дом', kk: 'Үйді сақтау' }) : tx({ en: 'Continue', ru: 'Дальше', kk: 'Әрі қарай' })}</Primary>
    </>
  )
}
