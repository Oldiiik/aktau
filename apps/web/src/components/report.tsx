'use client'
// Report · the resident's side of the 109 copilot.
// Speak or type in Russian, Kazakh or English → the copilot shows what it
// understood (grounded in your own words) → if 109 already knows, one tap
// adds you to that incident; otherwise a request opens with a suggested route.
// Visible problems (lights, waste, roads, yards, facades) need a photo; before
// a new request reaches 109 it passes an anti-spam check (rules + AI). Obvious
// spam is refused with the reason; doubts ask "send anyway?"; danger never waits.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { fmtTime } from '@aktau/normalization/time'
import type { SignalPreview } from '@aktau/server'
import { useApp, useRealtime } from './app'
import { Badge, Button, CopilotTag, Eyebrow, Icon, LinkButton, Meter, PageTitle } from './primitives'
import { ago } from '@aktau/i18n'
import { IncidentCard, REASON, SERVICE_ICON, STATUS, incidentHeading, incidentName, placeText, residentsText, serviceName, type IncidentLite } from './incident-ui'
import { preparePhoto, type PhotoUpload } from '@/lib/photo'
import { plural } from '@/lib/plural'

type L3 = { en: string; ru: string; kk: string }
type CheckReply = { code: string; reasons: string[]; duplicate_of?: string | null }
const CHECK_TEXT: Record<string, L3> = {
  photo_required: { en: 'Add a photo so the crew can see the problem.', ru: 'Добавьте фото, чтобы бригада увидела проблему.', kk: 'Бригада көруі үшін фото қосыңыз.' },
  gibberish: { en: 'We could not understand the report. Write what is wrong and where.', ru: 'Не удалось понять обращение. Напишите, что случилось и где.', kk: 'Өтініш түсініксіз. Не болғанын және қайда екенін жазыңыз.' },
  advert: { en: 'This looks like an advert, not a city problem.', ru: 'Похоже на рекламу, а не на городскую проблему.', kk: 'Бұл қала мәселесі емес, жарнамаға ұқсайды.' },
  duplicate: { en: 'You have already sent this report.', ru: 'Вы уже отправляли это обращение.', kk: 'Бұл өтінішті бұрын жібердіңіз.' },
  not_a_city_problem: { en: 'This does not look like a city problem 109 handles.', ru: 'Это не похоже на городскую проблему, которой занимается 109.', kk: 'Бұл 109 айналысатын қала мәселесіне ұқсамайды.' },
  photo_mismatch: { en: 'The photo does not seem to show the problem.', ru: 'Похоже, на фото не та проблема.', kk: 'Фотода мәселе көрінбейтін сияқты.' },
  suspicious: { en: 'Something in the report looks off.', ru: 'В обращении что-то не сходится.', kk: 'Өтініште бірдеңе сәйкес келмейді.' },
  already_confirmed: { en: 'You have already reported this incident.', ru: 'Вы уже сообщали об этом инциденте.', kk: 'Бұл оқиға туралы бұрын хабарладыңыз.' },
}

type Home = { designator: string | null; house: string | null } | null

const EXAMPLES = {
  ru: ['14 мкр, дом 21 — с утра нет воды, у соседей тоже', 'Во дворе 15 мкр не горят фонари, темно', 'В 14 мкр возле дома 20 висит блок кондиционера'],
  kk: ['14 ш/а 23 үйде су жоқ таңертеңнен', '15 шағын ауданда шамдар жанбайды', '12 ш/а 45 үй қоқыс шығарылмаған'],
  en: ['No water since morning, 14 mkr house 21, neighbours too', 'Street lights out in the 15 mkr yard', 'An AC unit is hanging over the entrance, 14 mkr house 20'],
}

type SpeechRec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null }

/** A live demo session the presenter reports into: the session is the location. */
export type ReportSession = { id: string; code: string; title: string; venue: string }

export function ReportView({ home, mine: initialMine, initialText = '', session = null }: { home: Home; mine: IncidentLite[]; initialText?: string; session?: ReportSession | null }) {
  const { lang, tx } = useApp()
  const router = useRouter()
  const [text, setText] = useState(initialText)
  const [p, setP] = useState<SignalPreview | null>(null)
  const [thinking, setThinking] = useState(false)
  const [listening, setListening] = useState(false)
  const [sent, setSent] = useState<{ incident_id: string; attached: boolean; n?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [separate, setSeparate] = useState(false)
  const [mine, setMine] = useState(initialMine)
  const recRef = useRef<SpeechRec | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [photo, setPhoto] = useState<{ image: PhotoUpload; thumb: string } | null>(null)
  const [blocked, setBlocked] = useState<CheckReply | null>(null)
  const [doubt, setDoubt] = useState<CheckReply | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pickPhoto = async (f: File | undefined) => {
    if (!f) return
    try { setPhoto(await preparePhoto(f)); setBlocked(null); setDoubt(null) } catch { setError(tx({ en: 'Could not read this photo.', ru: 'Не удалось прочитать фото.', kk: 'Фотоны оқу мүмкін болмады.' })) }
  }
  // Editing the report clears the last check's verdict.
  useEffect(() => { setBlocked(null); setDoubt(null) }, [text])

  // Live copilot preview while typing.
  useEffect(() => {
    if (text.trim().length < 4) { setP(null); return }
    const ctl = new AbortController()
    setThinking(true)
    const id = setTimeout(async () => {
      try {
        const r = await fetch('/api/incidents/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ...coords, session_id: session?.id ?? null }), signal: ctl.signal })
        if (r.ok) setP(await r.json())
      } catch { /* aborted */ } finally { setThinking(false) }
    }, 450)
    return () => { clearTimeout(id); ctl.abort() }
  }, [text, coords, session?.id])

  useRealtime(async () => {
    const d = await (await fetch('/api/me/incidents', { cache: 'no-store' })).json()
    setMine(d.incidents)
  }, ['incidents'])

  const [speechSupported, setSpeechSupported] = useState(false)
  useEffect(() => { setSpeechSupported('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) }, [])
  const toggleMic = () => {
    if (listening) { recRef.current?.stop(); return }
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
    const Rec = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Rec) return
    const rec = new Rec()
    rec.lang = lang === 'kk' ? 'kk-KZ' : lang === 'ru' ? 'ru-RU' : 'en-US'
    rec.interimResults = true
    rec.continuous = false
    const base = text ? `${text.trim()} ` : ''
    rec.onresult = (e) => setText(base + Array.from(e.results).map((r) => r[0]!.transcript).join(''))
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  // "Yes, it is the same problem": one more confirmation (the words and photo
  // go with it as evidence for 109), never a second incident.
  const confirmSame = async (id: string) => {
    setBusy(true); setError(null); setBlocked(null)
    try {
      const r = await fetch(`/api/incidents/${id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'confirmed', note: text.trim() || null, photo: photo?.image ?? null, ...coords }) })
      const d = await r.json()
      if (r.status === 409 && d.error?.code === 'already_reported') { setBlocked({ code: 'already_confirmed', reasons: [] }); return }
      if (!r.ok) throw new Error(d.error?.message ?? 'Failed')
      setSent({ incident_id: d.incident_id, attached: true, n: d.confirm_count })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const submit = async (attach: string | null, confirm = false) => {
    setBusy(true); setError(null); setBlocked(null); setDoubt(null)
    try {
      const r = await fetch('/api/incidents/signals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, attach_to: attach, ...coords, photo: photo?.image ?? null, confirm, session_id: session?.id ?? null }) })
      const d = await r.json()
      if (r.status === 422 && d.error?.check) { setBlocked(d.error.check); return }
      if (r.status === 409 && d.error?.check) { setDoubt(d.error.check); return }
      if (r.status === 409 && d.error?.code === 'already_confirmed') { setBlocked({ code: 'already_confirmed', reasons: [] }); return }
      if (!r.ok) throw new Error(d.error?.message ?? 'Failed')
      setSent({ incident_id: d.incident_id, attached: !!attach })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (sent) return <Sent id={sent.incident_id} attached={sent.attached} n={sent.n} session={session} onAgain={() => { setSent(null); setText(''); setP(null); setSeparate(false); setPhoto(null) }} />

  const likely = !separate ? p?.matches.find((m) => m.likely) ?? null : null
  const possible = !separate && !likely ? p?.matches[0] ?? null : null
  const official = p?.official[0] ?? null
  const i = p?.intake
  const needPhoto = p?.photo === 'required'
  // The place is known from the words, or from the shared location (the text may have no address).
  const noPlace = !session && !!i?.missing.includes('address') && !p?.place.area_id

  return (
    <div className="flex flex-col gap-5">
      {session ? (
        <div className="rise flex items-center gap-3 rounded-[18px] bg-demo-soft p-3.5">
          <Icon name="people" size={18} className="text-demo" />
          <div className="flex min-w-0 flex-1 flex-col"><span className="t-label text-demo">{tx({ en: 'Live demo session', ru: 'Живая демо-сессия', kk: 'Тірі демо-сессия' })} · {session.code}</span><span className="t-row truncate text-text">{session.title} · {session.venue}</span></div>
          <Link href={`/live/${session.code}/present`} className="tap t-meta font-bold text-demo">{tx({ en: 'Presenter screen', ru: 'Экран ведущего', kk: 'Жүргізуші экраны' })}</Link>
        </div>
      ) : null}
      <div className="rise"><PageTitle eyebrow={tx({ en: '109 · Aktau', ru: '109 · Актау', kk: '109 · Ақтау' })}
        sub={tx({ en: 'Describe it in your own words, or say it. Russian, Kazakh or English. The copilot fills in the request for you.', ru: 'Опишите своими словами или скажите голосом — на русском, казахском или английском. Copilot сам заполнит заявку.', kk: 'Өз сөзіңізбен жазыңыз немесе айтыңыз — орысша, қазақша не ағылшынша. Copilot өтінішті өзі толтырады.' })}>
        {tx({ en: 'What’s wrong?', ru: 'Что случилось?', kk: 'Не болды?' })}
      </PageTitle></div>

      <div className={`rise rise-1 flex flex-col gap-3 rounded-[26px] bg-surface p-4 card-shadow ${thinking || listening ? 'beam-edge' : ''}`}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000}
          placeholder={EXAMPLES[lang][0]} aria-label={tx({ en: 'Describe the problem', ru: 'Опишите проблему', kk: 'Мәселені сипаттаңыз' })}
          className="min-h-[112px] w-full resize-none bg-transparent text-[17px] font-semibold leading-snug text-text outline-none placeholder:font-medium placeholder:text-faint" />
        <div className="flex flex-wrap items-center gap-2">
          {speechSupported ? (
            <button type="button" onClick={toggleMic} className={`tap inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-bold ${listening ? 'bg-red text-bg' : 'bg-surface-2 text-text hairline'}`}>
              <Icon name="mic" size={16} />{listening ? tx({ en: 'Listening… tap to stop', ru: 'Слушаю… нажмите, чтобы закончить', kk: 'Тыңдап тұрмын…' }) : tx({ en: 'Speak', ru: 'Сказать голосом', kk: 'Дауыспен айту' })}
            </button>
          ) : null}
          {!session && home?.designator && !i?.designator ? (
            <button type="button" onClick={() => setText((t) => `${t.trim()}${t.trim() ? ', ' : ''}${home.designator}${/^\d/.test(home.designator!) ? ` ${lang === 'kk' ? 'ш/а' : lang === 'en' ? 'mkr' : 'мкр'}` : ''}${home.house ? `, ${lang === 'kk' ? '' : lang === 'en' ? 'house ' : 'дом '}${home.house}${lang === 'kk' ? ' үй' : ''}` : ''}`)}
              className="tap inline-flex h-10 items-center gap-2 rounded-full bg-surface-2 px-4 text-[13px] font-bold text-text hairline">
              <Icon name="home" size={16} />{tx({ en: 'At my home', ru: 'У меня дома', kk: 'Үйімде' })} · {home.designator}{home.house ? `/${home.house}` : ''}
            </button>
          ) : null}
          {!session && !home?.designator && !i?.designator && !coords ? (
            <button type="button" onClick={() => navigator.geolocation?.getCurrentPosition((g) => setCoords({ lat: g.coords.latitude, lon: g.coords.longitude }))}
              className="tap inline-flex h-10 items-center gap-2 rounded-full bg-surface-2 px-4 text-[13px] font-bold text-text hairline">
              <Icon name="pin" size={16} />{tx({ en: 'Use my location', ru: 'Моё местоположение', kk: 'Менің орным' })}
            </button>
          ) : null}
          <span className="ml-auto t-mono text-[11px] text-faint">{text.length}/2000</span>
        </div>
      </div>

      {!text ? (
        <div className="rise rise-2 flex flex-col gap-2">
          <Eyebrow>{tx({ en: 'For example', ru: 'Например', kk: 'Мысалы' })}</Eyebrow>
          {EXAMPLES[lang].map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="tap flex items-center gap-3 rounded-[16px] bg-surface px-4 py-3 text-left card-shadow hover:bg-surface-2">
              <Icon name="sparkle" size={16} className="text-beam" /><span className="t-sub text-text">{ex}</span>
            </button>
          ))}
        </div>
      ) : null}

      {i ? <Understood p={p!} thinking={thinking} onAdd={(s) => setText((t) => `${t.trim()}. ${s}`)} /> : text.trim().length >= 4 ? <div className="h-40 rounded-[24px] shimmer" /> : null}

      {official ? (
        <div className="fade-in flex flex-col gap-3 rounded-[24px] bg-soft p-5">
          <div className="flex items-center gap-2"><Icon name="shield" size={18} className="text-blue" /><span className="t-label text-blue">{tx({ en: 'Already announced officially', ru: 'Уже объявлено официально', kk: 'Ресми жарияланған' })}</span></div>
          <p className="t-card text-text">{official.title}</p>
          <p className="t-sub text-secondary" suppressHydrationWarning>
            {official.reported_authority ?? ''}{official.starts_at ? ` · ${fmtTime(new Date(official.starts_at))}` : ''}{official.expected_ends_at ? `–${fmtTime(new Date(official.expected_ends_at))}` : ` · ${tx({ en: 'restoration time not announced', ru: 'время восстановления не объявлено', kk: 'қалпына келу уақыты жарияланбаған' })}`}
          </p>
          <p className="t-sub text-text">{tx({ en: 'You don’t need to call 109 about this, it is planned work. We’ll notify you when it ends.', ru: 'Звонить в 109 не нужно — это объявленные работы. Мы сообщим, когда закончат.', kk: '109-ға қоңырау шалудың қажеті жоқ — бұл жарияланған жұмыс. Аяқталғанда хабарлаймыз.' })}</p>
          <LinkButton href={`/event/${official.id}`} style="secondary">{tx({ en: 'Open the notice', ru: 'Открыть уведомление', kk: 'Хабарламаны ашу' })}</LinkButton>
        </div>
      ) : null}

      {likely ? (
        <div className="fade-in flex flex-col gap-4 rounded-[26px] bg-soft p-5 text-text card-shadow">
          <div className="flex flex-col gap-1">
            <span className="t-label text-blue">{tx({ en: 'Looks like this was already reported', ru: 'Похоже, об этой проблеме уже сообщили', kk: 'Бұл мәселе туралы хабарланған сияқты' })}</span>
            <p className="t-sub text-secondary">{tx({ en: 'Confirm it instead of a new request: one city incident, every update to everyone affected.', ru: 'Подтвердите её вместо новой заявки: одна городская проблема, все обновления каждому, кого она касается.', kk: 'Жаңа өтініштің орнына растаңыз: бір мәселе, барлық жаңалық бәріне.' })}</p>
          </div>
          <Link href={`/incident/${likely.code}`} className="tap flex items-start gap-3 rounded-[18px] bg-surface p-4 card-shadow">
            <span className="grid size-11 flex-none place-items-center rounded-[14px] bg-surface-2 text-text hairline"><Icon name={SERVICE_ICON[likely.service]} size={21} /></span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="t-card text-text">{incidentHeading(lang, likely)}</span>
              <span className="t-sub text-secondary">{placeText(lang, likely)} · {tx(STATUS[likely.status]?.label ?? STATUS.NEW!.label)}</span>
              <span className="t-meta text-faint" suppressHydrationWarning>{tx({ en: 'Reported', ru: 'Сообщили', kk: 'Хабарланды' })} {ago(lang, likely.first_signal_at)}</span>
            </span>
            <span className="flex flex-col items-end">
              <span className="t-num text-[32px] font-semibold leading-none text-text">{likely.signal_count + likely.confirm_count}</span>
              <span className="t-meta text-secondary">{plural(lang, likely.signal_count + likely.confirm_count, { en: ['resident', 'residents'], ru: ['житель', 'жителя', 'жителей'], kk: 'тұрғын' })}</span>
            </span>
          </Link>
          <p className="t-row text-text">{alreadyConfirmed(lang, likely.signal_count + likely.confirm_count)}</p>
          <p className="flex flex-wrap gap-1.5">{likely.reasons.map((r) => <span key={r} className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-secondary">{tx(REASON[r] ?? { en: r, ru: r })}</span>)}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button disabled={busy || blocked?.code === 'already_confirmed'} onClick={() => void confirmSame(likely.id)}><Icon name="people" size={18} />{tx({ en: 'Yes, it is the same problem', ru: 'Да, это та же проблема', kk: 'Иә, бұл сол мәселе' })}</Button>
            <Button style="outline" disabled={busy} onClick={() => setSeparate(true)}>{tx({ en: 'No, it is a different problem', ru: 'Нет, это другая проблема', kk: 'Жоқ, бұл басқа мәселе' })}</Button>
          </div>
          {blocked?.code === 'already_confirmed' ? <CheckNote tone="amber" c={blocked} /> : null}
          <p className="t-meta text-faint">{tx({ en: 'Your words and photo are added for 109 as evidence; they are never public.', ru: 'Ваш текст и фото добавятся для 109 как подтверждение; публично их не видно.', kk: 'Мәтін мен фото 109 үшін дәлел ретінде қосылады.' })}</p>
        </div>
      ) : null}

      {p && !likely && i ? (
        <div className="fade-in flex flex-col gap-3 rounded-[24px] bg-surface p-5 card-shadow">
          {possible ? (
            <p className="t-sub text-secondary">{tx({ en: 'Similar, but not the same:', ru: 'Похоже, но не то же самое:', kk: 'Ұқсас, бірақ бірдей емес:' })} <Link className="font-bold text-blue" href={`/incident/${possible.code}`}>{possible.code}</Link> · {Math.round(possible.score * 100)}%</p>
          ) : null}
          <div className="flex items-center gap-2"><CopilotTag>{tx({ en: 'Will be sent to', ru: 'Будет направлено', kk: 'Жіберіледі' })}</CopilotTag></div>
          <p className="t-card text-text">{p.route.org}</p>
          <ol className="flex flex-col gap-1.5 border-l border-line pl-3">
            {p.route.chain.slice(1).map((c, k) => <li key={k} className="t-meta text-secondary"><span className="t-label mr-1.5 !text-[9.5px] text-faint">{c.level.replace('_', ' ')}</span>{c.name}</li>)}
          </ol>
          <p className="t-meta text-secondary">{p.route.note}</p>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
          {photo ? (
            <div className="flex items-center gap-3 rounded-[16px] bg-surface-2 p-2.5 hairline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.thumb} alt={tx({ en: 'Your photo', ru: 'Ваше фото', kk: 'Сіздің фотоңыз' })} className="size-16 flex-none rounded-[12px] object-cover" />
              <span className="flex-1 t-sub text-text">{tx({ en: 'Photo attached. Only 109 sees it.', ru: 'Фото прикреплено. Его видит только 109.', kk: 'Фото тіркелді. Оны тек 109 көреді.' })}</span>
              <button type="button" onClick={() => fileRef.current?.click()} className="tap t-meta font-bold text-blue">{tx({ en: 'Retake', ru: 'Переснять', kk: 'Қайта түсіру' })}</button>
              <button type="button" onClick={() => setPhoto(null)} aria-label={tx({ en: 'Remove photo', ru: 'Убрать фото', kk: 'Фотоны алып тастау' })} className="tap grid size-8 place-items-center rounded-full text-secondary hover:bg-surface"><Icon name="x" size={15} /></button>
            </div>
          ) : needPhoto ? (
            <button type="button" onClick={() => fileRef.current?.click()} className="tap flex items-center gap-3 rounded-[16px] border-2 border-dashed border-blue/50 bg-soft p-4 text-left">
              <span className="grid size-11 flex-none place-items-center rounded-[14px] bg-blue text-on-blue"><Icon name="camera" size={20} /></span>
              <span className="flex flex-col"><span className="t-row text-text">{tx({ en: 'Add a photo', ru: 'Добавьте фото', kk: 'Фото қосыңыз' })}</span><span className="t-meta text-secondary">{tx({ en: `Needed for ${incidentName(lang, i.service).toLowerCase()}: the crew and 109 see exactly what and where.`, ru: `Нужно для «${incidentName(lang, i.service)}»: бригада и 109 увидят, что и где.`, kk: `«${incidentName(lang, i.service)}» үшін қажет: бригада мен 109 не және қайда екенін көреді.` })}</span></span>
            </button>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className="tap inline-flex h-10 items-center gap-2 self-start rounded-full bg-surface-2 px-4 text-[13px] font-bold text-text hairline">
              <Icon name="camera" size={16} />{tx({ en: 'Add a photo (optional)', ru: 'Добавить фото (необязательно)', kk: 'Фото қосу (міндетті емес)' })}
            </button>
          )}
          {blocked ? <CheckNote tone="red" c={blocked} /> : null}
          {doubt ? (
            <div className="flex flex-col gap-2.5">
              <CheckNote tone="amber" c={doubt} />
              <div className="grid grid-cols-2 gap-2">
                <Button style="outline" disabled={busy} onClick={() => (doubt.code === 'photo_mismatch' ? fileRef.current?.click() : setDoubt(null))}>{doubt.code === 'photo_mismatch' ? tx({ en: 'Change photo', ru: 'Другое фото', kk: 'Басқа фото' }) : tx({ en: 'Edit', ru: 'Исправить', kk: 'Түзету' })}</Button>
                <Button style="secondary" disabled={busy} onClick={() => submit(null, true)}>{tx({ en: 'Send anyway', ru: 'Всё равно отправить', kk: 'Бәрібір жіберу' })}</Button>
              </div>
            </div>
          ) : (
            <Button disabled={busy || noPlace || (needPhoto && !photo) || !!blocked} onClick={() => submit(null)}>
              {busy ? <><span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />{tx({ en: 'Checking the request…', ru: 'Проверяем обращение…', kk: 'Өтініш тексерілуде…' })}</> : <><Icon name="send" size={18} />{tx({ en: 'Send to 109', ru: 'Отправить в 109', kk: '109-ға жіберу' })}</>}
            </Button>
          )}
          {noPlace ? <p className="t-meta text-amber">{tx({ en: 'Add the microdistrict and house so the crew can find it.', ru: 'Добавьте микрорайон и дом, чтобы бригада нашла место.', kk: 'Бригада табуы үшін шағын аудан мен үйді қосыңыз.' })}</p> : null}
          <p className="t-meta text-faint">{tx({ en: 'Before sending, the request is checked for spam (rules and AI). A 109 operator confirms every new request. Your text and photo are visible only to 109, never on the public map.', ru: 'Перед отправкой обращение проверяется на спам (правила и ИИ). Каждую новую заявку подтверждает оператор 109. Текст и фото видит только 109 — на публичной карте их нет.', kk: 'Жіберер алдында өтініш спамға тексеріледі (ережелер және ЖИ). Әр жаңа өтінішті 109 операторы растайды. Мәтін мен фотоны тек 109 көреді.' })}</p>
        </div>
      ) : null}
      {error ? <p className="t-sub text-red">{error}</p> : null}

      {mine.length ? (
        <section className="flex flex-col gap-3 pt-2">
          <Eyebrow>{tx({ en: 'Your reports', ru: 'Ваши обращения', kk: 'Сіздің өтініштеріңіз' })}</Eyebrow>
          {mine.map((m) => <IncidentCard key={m.id} i={m} />)}
        </section>
      ) : null}
      <button type="button" className="sr-only" onClick={() => router.refresh()}>refresh</button>
    </div>
  )
}

/** "12 жителей уже подтвердили проблему". */
function alreadyConfirmed(lang: 'en' | 'ru' | 'kk', n: number) {
  if (lang === 'en') return `${n} ${n === 1 ? 'resident has' : 'residents have'} already confirmed the problem`
  if (lang === 'kk') return `${n} тұрғын мәселені растады`
  return `${n} ${plural('ru', n, { en: ['', ''], ru: ['житель', 'жителя', 'жителей'], kk: '' })} уже ${plural('ru', n, { en: ['', ''], ru: ['подтвердил', 'подтвердили', 'подтвердили'], kk: '' })} проблему`
}

/** The report check's verdict, in the resident's language, with the AI's reasons. */
function CheckNote({ c, tone }: { c: CheckReply; tone: 'red' | 'amber' }) {
  const { tx } = useApp()
  return (
    <div className={`fade-in flex items-start gap-3 rounded-[16px] p-3.5 ${tone === 'red' ? 'bg-red-soft' : 'bg-amber-soft'}`}>
      <Icon name="alert" size={18} className={`mt-0.5 flex-none ${tone === 'red' ? 'text-red' : 'text-amber'}`} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="t-row text-text">{tx(CHECK_TEXT[c.code] ?? CHECK_TEXT.suspicious!)}</span>
        {c.reasons.length ? <ul className="flex list-disc flex-col gap-0.5 pl-4 t-sub text-secondary">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
        {c.duplicate_of && c.duplicate_of !== 'pending' ? <Link href={`/incident/${c.duplicate_of}`} className="t-meta font-bold text-blue">{tx({ en: `Follow ${c.duplicate_of}`, ru: `Следить за ${c.duplicate_of}`, kk: `${c.duplicate_of} бақылау` })}</Link> : null}
        {c.reasons.length ? <span className="t-meta text-faint">{tx({ en: 'Checked by AI. You can edit the report and send it again.', ru: 'Проверено ИИ. Можно исправить обращение и отправить снова.', kk: 'ЖИ тексерді. Өтінішті түзетіп, қайта жіберуге болады.' })}</span> : null}
      </div>
    </div>
  )
}

/** What the copilot understood — each field grounded in the resident's own words. */
function Understood({ p, thinking, onAdd }: { p: SignalPreview; thinking: boolean; onAdd: (s: string) => void }) {
  const { lang, tx } = useApp()
  const i = p.intake
  const span = (f: string) => i.spans.find((s) => s.field === f)?.text
  const since: Record<string, { en: string; ru: string; kk: string }> = {
    now: { en: 'just now', ru: 'только что', kk: 'жаңа ғана' }, this_morning: { en: 'this morning', ru: 'с утра', kk: 'таңертеңнен' },
    last_night: { en: 'overnight', ru: 'с ночи', kk: 'түннен' }, yesterday_evening: { en: 'since yesterday evening', ru: 'со вчерашнего вечера', kk: 'кеше кештен' },
    yesterday: { en: 'since yesterday', ru: 'со вчера', kk: 'кешеден' }, hours_ago: { en: 'for some hours', ru: 'несколько часов', kk: 'бірнеше сағат' },
    days_ago: { en: 'for days', ru: 'несколько дней', kk: 'бірнеше күн' }, clock: { en: 'since', ru: 'с', kk: 'бастап' },
  }
  const rows: Array<{ k: string; label: string; value: string | null; src?: string; icon: Parameters<typeof Icon>[0]['name'] }> = [
    { k: 'service', icon: SERVICE_ICON[i.service], label: tx({ en: 'Problem', ru: 'Проблема', kk: 'Мәселе' }), value: i.service === 'other' ? null : `${serviceName(lang, i.service)} · ${incidentHeading(lang, { service: i.service, kind: i.kind, risk_flags: i.risk_flags })}`, src: span('service') },
    { k: 'where', icon: 'pin', label: tx({ en: 'Where', ru: 'Где', kk: 'Қайда' }), value: p.session ? `${p.session.venue} · ${tx({ en: 'demo session', ru: 'демо-сессия', kk: 'демо-сессия' })}` : i.designator ? placeText(lang, { designator: i.designator, house: i.house }) + (i.near_house ? ` · ${tx({ en: 'nearby', ru: 'рядом', kk: 'жанында' })}` : '')
      : p.place.area_id ? tx({ en: 'At your location', ru: 'По вашей геолокации', kk: 'Сіздің орныңыз бойынша' }) : null, src: [span('designator'), span('house')].filter(Boolean).join(' · ') },
    { k: 'since', icon: 'clock', label: tx({ en: 'Since', ru: 'С какого времени', kk: 'Қашаннан' }), value: i.started_hint ? `${tx(since[i.started_hint]!)}${i.started_hint === 'clock' && i.started_at ? ` ${fmtTime(new Date(i.started_at))}` : ''}` : null, src: span('started') },
    { k: 'scope', icon: 'people', label: tx({ en: 'Who is affected', ru: 'Кого касается', kk: 'Кімге қатысты' }), value: i.scope === 'single' ? tx({ en: 'you', ru: 'вас', kk: 'сізге' }) : i.scope === 'household' ? tx({ en: 'only your flat', ru: 'только вашу квартиру', kk: 'тек сіздің пәтеріңізге' }) : i.scope === 'multiple' ? tx({ en: 'several homes', ru: 'несколько квартир / домов', kk: 'бірнеше үй' }) : i.scope === 'area' ? tx({ en: 'the area', ru: 'весь участок', kk: 'аумақ' }) : tx({ en: 'the building', ru: 'весь дом', kk: 'бүкіл үй' }), src: span('scope') },
  ]
  const quick: Record<string, { q: string; add: string }[]> = {
    neighbours: [{ q: tx({ en: 'Neighbours too', ru: 'У соседей тоже', kk: 'Көршілерде де' }), add: tx({ en: 'Neighbours too.', ru: 'У соседей тоже.', kk: 'Көршілерде де.' }) }, { q: tx({ en: 'Only me', ru: 'Только у меня', kk: 'Тек менде' }), add: tx({ en: 'Only in my apartment.', ru: 'Только в моей квартире.', kk: 'Тек менің пәтерімде.' }) }],
    start_time: [{ q: tx({ en: 'Since morning', ru: 'С утра', kk: 'Таңертеңнен' }), add: tx({ en: 'Since morning.', ru: 'С утра.', kk: 'Таңертеңнен.' }) }, { q: tx({ en: 'Since yesterday', ru: 'Со вчера', kk: 'Кешеден' }), add: tx({ en: 'Since yesterday.', ru: 'Со вчера.', kk: 'Кешеден.' }) }, { q: tx({ en: 'Just now', ru: 'Только что', kk: 'Жаңа ғана' }), add: tx({ en: 'Just now.', ru: 'Только что.', kk: 'Жаңа ғана.' }) }],
  }
  return (
    <section className="fade-in flex flex-col gap-4 rounded-[26px] bg-surface p-5 card-shadow">
      <div className="flex items-center justify-between">
        <CopilotTag>{tx({ en: 'Understood', ru: 'Понял', kk: 'Түсіндім' })}</CopilotTag>
        <span className="t-mono text-[11px] text-faint">{thinking ? '…' : `${p.ms} ms · ${i.lang.toUpperCase()}`}</span>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.k} className="flex items-start gap-3">
            <span className={`grid size-9 flex-none place-items-center rounded-[12px] ${r.value ? 'bg-beam-soft text-beam' : 'bg-surface-2 text-faint hairline'}`}><Icon name={r.icon} size={17} /></span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="t-label !text-[9.5px] text-faint">{r.label}</span>
              <span className={`t-row ${r.value ? 'text-text' : 'text-faint'}`}>{r.value ?? tx({ en: 'not said yet', ru: 'пока не указано', kk: 'әлі айтылмады' })}</span>
              {r.value && r.src ? <span className="t-mono mt-0.5 truncate text-[11px] text-secondary">“{r.src}”</span> : null}
            </div>
          </div>
        ))}
      </div>
      {i.risk !== 'none' ? (
        <div className={`flex items-start gap-3 rounded-[16px] p-3 ${i.risk === 'imminent' ? 'bg-red-soft' : 'bg-amber-soft'}`}>
          <Icon name="alert" size={18} className={i.risk === 'imminent' ? 'text-red' : 'text-amber'} />
          <div className="flex flex-col gap-0.5">
            <span className={`t-row ${i.risk === 'imminent' ? 'text-red' : 'text-amber'}`}>{i.risk === 'imminent' ? tx({ en: 'Danger, this goes to the top of the queue', ru: 'Опасно — заявка пойдёт вне очереди', kk: 'Қауіпті — өтініш кезектен тыс' }) : tx({ en: 'Higher priority', ru: 'Повышенный приоритет', kk: 'Жоғары басымдық' })}</span>
            <span className="t-meta text-secondary">{i.risk_flags.map((f) => tx(REASON[f] ?? { en: f, ru: f })).join(' · ')}</span>
            {i.risk_flags.includes('gas_smell') ? <a href="tel:104" className="t-row mt-1 text-red">{tx({ en: 'Smell of gas? Call 104 now', ru: 'Запах газа? Звоните 104 сейчас', kk: 'Газ иісі ме? Қазір 104-ке қоңырау шалыңыз' })}</a> : null}
          </div>
        </div>
      ) : null}
      {i.missing.filter((m) => quick[m]).map((m) => (
        <div key={m} className="flex flex-col gap-2">
          <span className="t-meta font-bold text-text">{tx(REASON[m]!)}</span>
          <div className="flex flex-wrap gap-2">{quick[m]!.map((q) => <button key={q.q} type="button" onClick={() => onAdd(q.add)} className="tap h-9 rounded-full bg-surface-2 px-3.5 text-[12.5px] font-bold text-text hairline">{q.q}</button>)}</div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Meter value={i.confidence} tone="beam" />
        <span className="t-mono text-[11px] text-secondary">{Math.round(i.confidence * 100)}%</span>
      </div>
    </section>
  )
}

function Sent({ id, attached, n, session, onAgain }: { id: string; attached: boolean; n?: number; session?: ReportSession | null; onAgain: () => void }) {
  const { tx } = useApp()
  const [inc, setInc] = useState<IncidentLite | null>(null)
  const load = () => fetch(`/api/incidents/${id}`, { cache: 'no-store' }).then((r) => r.json()).then(setInc).catch(() => {})
  useEffect(() => { void load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime((e) => { if (e.kind === 'resync' || e.id === id) void load() }, ['incidents'])
  const count = n ?? inc?.confirm_count
  return (
    <div className="flex flex-col gap-5 pt-4">
      <div className="rise flex flex-col items-start gap-4">
        <span className="grid size-14 place-items-center rounded-[18px] beam-fill beam-glow"><Icon name="check" size={28} className="text-on-blue" /></span>
        <PageTitle eyebrow={inc?.code ?? '…'} sub={attached
          ? tx({ en: 'You are counted as affected. One incident, one team, every update to everyone affected, including you.', ru: 'Вы учтены как затронутый житель. Одна проблема, одна ответственная команда, все обновления каждому, кого она касается, и вам тоже.', kk: 'Сіз есептелдіңіз. Бір мәселе, бір команда, барлық жаңалық бәріне.' })
          : session ? tx({ en: 'Everyone connected to the session sees it now and can confirm it.', ru: 'Все подключённые к сессии уже видят проблему и могут её подтвердить.', kk: 'Сессияға қосылғандардың бәрі қазір көреді.' })
          : tx({ en: 'Neighbours it affects see it now and can confirm it. A 109 operator assigns the responsible team; every change reaches your inbox.', ru: 'Соседи, которых это касается, уже видят проблему и могут подтвердить. Оператор 109 назначит ответственную команду; все изменения придут во входящие.', kk: 'Қатысы бар көршілер қазір көреді. 109 операторы жауапты команданы тағайындайды.' })}>
          {attached ? tx({ en: `You’re confirmation #${count ?? '…'}`, ru: `Вы — подтверждение №${count ?? '…'}`, kk: `Сіз — №${count ?? '…'} растау` }) : tx({ en: 'Sent to 109', ru: 'Отправлено в 109', kk: '109-ға жіберілді' })}
        </PageTitle>
      </div>
      {inc ? <IncidentCard i={inc} /> : <div className="h-40 rounded-[22px] shimmer" />}
      <div className="grid grid-cols-2 gap-3">
        {session ? <LinkButton href={`/live/${session.code}/present`} style="primary">{tx({ en: 'Presenter screen', ru: 'Экран ведущего', kk: 'Жүргізуші экраны' })}</LinkButton>
          : <LinkButton href={inc ? `/incident/${inc.code}` : '#'} style="primary">{tx({ en: 'Follow', ru: 'Следить', kk: 'Бақылау' })}</LinkButton>}
        <Button style="outline" onClick={onAgain}>{tx({ en: 'Report another', ru: 'Сообщить ещё', kk: 'Тағы хабарлау' })}</Button>
      </div>
      {inc?.is_demo ? <Badge tone="demo" className="self-start">DEMO</Badge> : null}
    </div>
  )
}
