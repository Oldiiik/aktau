'use client'
// Incident page: the central civic object. One physical problem, many
// residents, one responsible team, one traceable result. It shows where and
// whom it affects, how many residents confirmed it, how urgent it is and why,
// who is responsible, the deadline they committed to (and every change), the
// proof of completion, what the affected residents said, and every step with
// where it came from. Residents answer two questions here: "does this affect
// you too?" and "is it really fixed?".
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { fmtDate, fmtTime } from '@aktau/normalization/time'
import type { IncidentDetailDTO } from '@aktau/server'
import { useApp, useRealtime } from './app'
import { plural } from '@/lib/plural'
import { term } from '@/lib/terms'
import { Badge, BackLink, Button, CopilotTag, Eyebrow, Icon, LinkButton, type IconName } from './primitives'
import {
  CHECK, ConfirmButtons, PriorityChip, Pipeline, SERVICE_ICON, SOURCE, STATUS, VerifyButtons, duration, etaLine, incidentHeading, metresText, priorityWhy,
  residentsText, scopeText, sourceLabel, timelineText, whereText,
} from './incident-ui'

const KIND_ICON: Record<string, { icon: IconName; cls: string }> = {
  created: { icon: 'report', cls: 'text-blue' }, signal: { icon: 'people', cls: 'text-secondary' }, confirmed: { icon: 'people', cls: 'text-blue' },
  routed: { icon: 'send', cls: 'text-blue' }, accepted: { icon: 'check', cls: 'text-blue' }, deadline_set: { icon: 'timer', cls: 'text-blue' },
  deadline_changed: { icon: 'timer', cls: 'text-amber' }, returned: { icon: 'alert', cls: 'text-red' }, dispatched: { icon: 'bus', cls: 'text-blue' },
  update: { icon: 'bell', cls: 'text-blue' }, completed: { icon: 'check', cls: 'text-green' }, evidence: { icon: 'camera', cls: 'text-secondary' },
  resolved: { icon: 'check', cls: 'text-green' }, verified: { icon: 'thumb', cls: 'text-green' }, disputed: { icon: 'alert', cls: 'text-red' },
  reopened: { icon: 'alert', cls: 'text-red' }, official: { icon: 'shield', cls: 'text-blue' }, rejected: { icon: 'x', cls: 'text-secondary' },
  recurrence: { icon: 'route', cls: 'text-amber' }, scope: { icon: 'pin', cls: 'text-secondary' }, priority: { icon: 'alert', cls: 'text-amber' },
  merged: { icon: 'merge', cls: 'text-blue' }, merged_into: { icon: 'merge', cls: 'text-blue' }, escalated: { icon: 'alert', cls: 'text-red' },
}

const OPEN = ['NEW', 'ROUTED', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED']

export function IncidentView({ initial }: { initial: IncidentDetailDTO }) {
  const { lang, tx } = useApp()
  const [d, setD] = useState(initial)
  const reload = useCallback(() => { fetch(`/api/incidents/${d.id}`, { cache: 'no-store' }).then((r) => r.json()).then(setD).catch(() => {}) }, [d.id])
  useRealtime((e) => { if (e.kind === 'resync' || e.id === d.id) reload() }, ['incidents'])
  const st = STATUS[d.status] ?? STATUS.NEW!
  const open = OPEN.includes(d.status) && !d.merged_into
  const closed = d.status === 'RESOLVED' || d.status === 'VERIFIED'
  const followed = d.my_relation === 'reporter' || d.my_relation === 'confirmed'
  const place = [whereText(lang, d), d.my_place?.distance_m != null ? `${metresText(lang, d.my_place.distance_m)} ${tx({ en: 'from you', ru: 'от вас', kk: 'сізден' })}` : null].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-5">
      <BackLink href={d.session ? `/live/${d.session.code}` : '/map?layer=109'}>{d.session ? d.session.title : tx({ en: 'City map', ru: 'Карта города', kk: 'Қала картасы' })}</BackLink>

      <header className="rise flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-mono rounded-full bg-surface px-2.5 py-1 text-[12px] font-semibold text-text hairline">{d.code}</span>
          <Badge tone={st.tone} dot>{tx(st.label)}</Badge>
          <PriorityChip level={d.priority} />
          {d.previous ? <Badge tone="planned">{tx({ en: 'Recurring', ru: 'Повторная проблема', kk: 'Қайталанған мәселе' })}</Badge> : null}
          {d.is_demo ? <Badge tone="demo">DEMO</Badge> : null}
        </div>
        <div className="flex items-start gap-4">
          <span className={`grid size-14 flex-none place-items-center rounded-[18px] ${d.priority === 'CRITICAL' ? 'bg-red text-bg' : 'bg-surface text-text card-shadow'}`}><Icon name={SERVICE_ICON[d.service]} size={26} /></span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="t-title text-text">{incidentHeading(lang, d)}</h1>
            <p className="t-body text-secondary">{place}</p>
          </div>
        </div>
      </header>

      {d.merged_into ? (
        <Link href={`/incident/${d.merged_into.code}`} className="tap flex items-center gap-3 rounded-[20px] bg-soft p-4">
          <Icon name="merge" size={20} className="text-blue" />
          <span className="flex-1 t-row text-text">{tx({ en: `Merged into ${d.merged_into.code}: every update continues there`, ru: `Объединено с ${d.merged_into.code}: все обновления там`, kk: `${d.merged_into.code} біріктірілді` })}</span>
          <Icon name="chevron" size={16} className="text-faint" />
        </Link>
      ) : null}

      <Facts d={d} />

      <section className="rise rise-2 flex flex-col gap-4 rounded-[24px] bg-surface p-5 card-shadow">
        <Pipeline status={d.status} />
        {open && !d.my_relation ? (
          <div className="flex flex-col gap-2.5">
            <p className="t-card text-text">{tx({ en: 'Does this affect you too?', ru: 'Вас это тоже затрагивает?', kk: 'Бұл сізге де қатысты ма?' })}</p>
            <ConfirmButtons id={d.id} onDone={reload} />
            <p className="t-meta text-faint">{tx({ en: 'A confirmation is not a like: one per person, and you get every update.', ru: 'Подтверждение — не лайк: одно на человека, и вы получите все обновления.', kk: 'Растау — лайк емес: бір адамға бір рет.' })}</p>
          </div>
        ) : null}
        {open && followed ? <p className="flex items-center gap-2 t-sub text-secondary"><Icon name="check" size={16} className="text-green" />{d.my_relation === 'reporter' ? tx({ en: 'You reported this; updates go to your inbox.', ru: 'Вы сообщили об этом: обновления придут во входящие.', kk: 'Сіз хабарладыңыз: жаңалықтар хабарларға келеді.' }) : tx({ en: 'You confirmed this; updates go to your inbox.', ru: 'Вы подтвердили проблему: обновления придут во входящие.', kk: 'Сіз растадыңыз: жаңалықтар хабарларға келеді.' })}</p> : null}
        {d.my_relation === 'not_affected' && open ? <p className="t-sub text-secondary">{tx({ en: 'You said it does not affect you.', ru: 'Вы ответили, что вас это не затрагивает.', kk: 'Сізге қатысы жоқ деп жауап бердіңіз.' })}</p> : null}
      </section>

      <Verification d={d} onDone={reload} />
      <Completion d={d} />
      {d.previous ? <Previous d={d} /> : null}
      {closed ? <Returned d={d} /> : null}

      {d.official ? (
        <Link href={`/event/${d.official.id}`} className="tap flex items-center gap-3 rounded-[20px] bg-soft p-4">
          <Icon name="shield" size={20} className="text-blue" />
          <div className="flex min-w-0 flex-1 flex-col"><span className="t-label !text-[9.5px] text-blue">{tx({ en: 'Linked official notice', ru: 'Связанное официальное уведомление', kk: 'Байланысты ресми хабарлама' })}</span><span className="t-row truncate text-text">{d.official.title}</span></div>
          <Icon name="chevron" size={16} className="text-faint" />
        </Link>
      ) : null}

      <Timeline d={d} />

      <details className="group rounded-[24px] bg-surface card-shadow">
        <summary className="tap flex cursor-pointer list-none items-center justify-between gap-2 p-5"><span className="t-section text-text">{tx({ en: 'Chain of responsibility', ru: 'Цепочка ответственности', kk: 'Жауапкершілік тізбегі' })}</span><Icon name="chevron" size={16} className="text-faint transition-transform group-open:rotate-90" /></summary>
        <div className="px-5 pb-5"><Responsibility d={d} bare /></div>
      </details>

      {d.response_text ? (
        <section className="flex flex-col gap-3 rounded-[24px] bg-surface p-5 card-shadow">
          <div className="flex items-center justify-between"><h2 className="t-section text-text">{tx({ en: 'Official answer', ru: 'Официальный ответ', kk: 'Ресми жауап' })}</h2>{d.response_check ? <QualityBadge v={(d.response_check as { verdict: string }).verdict} /> : null}</div>
          <blockquote className="rounded-[16px] bg-surface-2 p-4 t-body text-text hairline">“{d.response_text}”</blockquote>
          <p className="t-meta text-faint">{term(lang, d.responsible_org ?? '')}</p>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <LinkButton href={`/map?layer=109&incident=${d.id}`} style="secondary"><Icon name="map" size={18} />{tx({ en: 'On the map', ru: 'На карте', kk: 'Картада' })}</LinkButton>
        <LinkButton href="/report" style="outline"><Icon name="report" size={18} />{tx({ en: 'Report', ru: 'Сообщить', kk: 'Хабарлау' })}</LinkButton>
      </div>
    </div>
  )
}

/** Where, whom, how many, how urgent and why, who, by when, and the cause (only if someone accountable said it). */
function Facts({ d }: { d: IncidentDetailDTO }) {
  const { lang, tx } = useApp()
  const fromReports = d.residents - d.confirm_count
  const who = d.team && d.responsible_org && d.team !== d.responsible_org ? `${d.team} · ${term(lang, d.responsible_org)}` : term(lang, d.team ?? d.responsible_org ?? '')
  const assigned = !!d.assigned_at || !!d.routed_at
  const eta = etaLine(lang, d.commit_finish_at)
  const changes = d.deadlines.filter((x) => x.from)
  // Once the team reports completion, the row says when, and whether it kept its word.
  const late = d.completed_at && d.commit_finish_at ? Math.round((new Date(d.completed_at).getTime() - new Date(d.commit_finish_at).getTime()) / 60000) : null
  const doneText = d.completed_at ? [
    `${tx({ en: 'Done', ru: 'Выполнено', kk: 'Орындалды' })} ${fmtDate(new Date(d.completed_at), lang)}, ${fmtTime(new Date(d.completed_at))}`,
    late == null ? null : late <= 0 ? tx({ en: 'on time', ru: 'в срок', kk: 'мерзімінде' }) : `${tx({ en: 'late by', ru: 'позже срока на', kk: 'кешікті' })} ${duration(lang, late)}`,
  ].filter(Boolean).join(' · ') : ''
  const cause = d.cause_text
    ? { text: d.cause_text, source: d.cause_source === 'official' ? SOURCE.official! : d.cause_source === 'operator' ? SOURCE.operator! : { en: 'according to the team', ru: 'со слов исполнителя', kk: 'орындаушының айтуы бойынша' } }
    : d.official?.reason ? { text: d.official.reason, source: SOURCE.official! } : null
  const Row = ({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) => (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid size-9 flex-none place-items-center rounded-[12px] bg-surface-2 text-secondary hairline"><Icon name={icon} size={17} /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="t-label !text-[11px] text-faint">{label}</span>{children}</div>
    </div>
  )
  return (
    <section className="rise rise-1 flex flex-col divide-y divide-[var(--line)] rounded-[24px] bg-surface p-5 card-shadow">
      <Row icon="people" label={tx({ en: 'Residents', ru: 'Жители', kk: 'Тұрғындар' })}>
        <span className="flex items-baseline gap-2"><span className="t-num text-[30px] font-semibold leading-none text-text">{d.residents}</span><span className="t-row text-text">{residentsText(lang, d.residents).replace(/^\d+\s/, '')}</span></span>
        <span className="t-meta text-secondary">{[
          fromReports ? `${fromReports} ${plural(lang, fromReports, { en: ['report', 'reports'], ru: ['обращение', 'обращения', 'обращений'], kk: 'өтініш' })}` : null,
          d.confirm_count ? `${d.confirm_count} ${plural(lang, d.confirm_count, { en: ['confirmation', 'confirmations'], ru: ['подтверждение', 'подтверждения', 'подтверждений'], kk: 'растау' })}` : null,
          `${tx({ en: 'first report', ru: 'первое сообщение', kk: 'алғашқы хабар' })} ${fmtTime(new Date(d.first_signal_at))}`,
        ].filter(Boolean).join(' · ')}</span>
      </Row>
      <Row icon="pin" label={tx({ en: 'Affected area', ru: 'Кого затрагивает', kk: 'Кімге қатысты' })}>
        <span className="t-row text-text">{scopeText(lang, d)}</span>
        {d.my_place ? <span className={`t-meta ${d.my_place.relevance === 'DIRECT' ? 'font-bold text-blue' : 'text-secondary'}`}>{d.my_place.relevance === 'DIRECT' ? tx({ en: 'Your home is inside this area', ru: 'Ваш дом входит в эту зону', kk: 'Үйіңіз осы аймақта' }) : tx({ en: 'Your home is outside this area', ru: 'Ваш дом вне этой зоны', kk: 'Үйіңіз бұл аймақтан тыс' })}</span> : null}
      </Row>
      <Row icon="alert" label={tx({ en: 'Priority', ru: 'Приоритет', kk: 'Басымдық' })}>
        <span className="flex"><PriorityChip level={d.priority} /></span>
        {d.priority_reasons.length ? (
          <ul className="mt-1 flex flex-col gap-0.5">
            {d.priority_reasons.slice(0, 4).map((r) => <li key={r.key} className="flex items-start gap-1.5 t-sub text-secondary"><span className="mt-[7px] size-1 flex-none rounded-full bg-current" />{priorityWhy(lang, r)}</li>)}
          </ul>
        ) : null}
      </Row>
      <Row icon="shield" label={tx({ en: 'Responsible', ru: 'Ответственный', kk: 'Жауапты' })}>
        <span className="t-row text-text">{who || tx({ en: 'Not assigned yet', ru: 'Пока не назначен', kk: 'Әлі тағайындалмаған' })}</span>
        <span className="t-meta text-secondary">{assigned ? tx({ en: 'Assigned by a 109 operator', ru: 'Назначен оператором 109', kk: '109 операторы тағайындады' }) : tx({ en: 'Likely responsible: an AI suggestion until a 109 operator confirms', ru: 'Вероятный ответственный: подсказка ИИ, пока оператор 109 не подтвердит', kk: 'Ықтимал жауапты: 109 операторы растағанша ЖИ ұсынысы' })}</span>
      </Row>
      <Row icon="timer" label={tx({ en: 'Deadline', ru: 'Срок', kk: 'Мерзім' })}>
        <span className="t-row text-text" suppressHydrationWarning>{d.completed_at ? doneText : eta ?? tx({ en: 'The team has not committed to a deadline yet', ru: 'Исполнитель ещё не назвал срок', kk: 'Орындаушы әлі мерзім атаған жоқ' })}</span>
        {d.commit_start_at && d.status !== 'IN_PROGRESS' && !d.completed_at ? <span className="t-meta text-secondary" suppressHydrationWarning>{tx({ en: 'Start', ru: 'Начало', kk: 'Басталуы' })}: {fmtTime(new Date(d.commit_start_at))}</span> : null}
        {changes.map((c) => (
          <span key={c.at} className="mt-1 flex flex-col rounded-[12px] bg-amber-soft px-3 py-2" suppressHydrationWarning>
            <span className="t-meta font-bold text-amber">{tx({ en: 'Deadline changed', ru: 'Срок изменён', kk: 'Мерзім өзгерді' })} · {fmtTime(new Date(c.from!))} → {fmtTime(new Date(c.to))}</span>
            {c.reason ? <span className="t-meta text-secondary">{tx({ en: 'Reason', ru: 'Причина', kk: 'Себебі' })}: {c.reason}</span> : null}
          </span>
        ))}
      </Row>
      <Row icon="eye" label={tx({ en: 'Cause', ru: 'Причина', kk: 'Себебі' })}>
        {cause ? <><span className="t-row text-text">{cause.text}</span><span className="t-meta text-secondary">{tx(cause.source)}</span></>
          : <span className="t-row text-secondary">{tx({ en: 'Not officially confirmed', ru: 'Официально не подтверждена', kk: 'Ресми расталмаған' })}</span>}
      </Row>
    </section>
  )
}

/** What the affected residents said after the team reported completion. */
function Verification({ d, onDone }: { d: IncidentDetailDTO; onDone: () => void }) {
  const { tx } = useApp()
  const v = d.verification
  const asking = d.can_verify && (d.status === 'EVIDENCE_SUBMITTED' || d.status === 'RESOLVED')
  if (v.round < 1 && !asking) return null
  const n = v.yes + v.partial + v.no
  const tone = d.status === 'DISPUTED' ? 'bg-red-soft' : d.status === 'VERIFIED' ? 'bg-green-soft' : 'bg-surface card-shadow'
  const headline = d.status === 'VERIFIED' ? tx({ en: 'Residents confirmed it is fixed.', ru: 'Жители подтвердили устранение.', kk: 'Тұрғындар шешілгенін растады.' })
    : d.status === 'DISPUTED' ? tx({ en: 'Reopened after residents checked.', ru: 'Проблема повторно открыта после проверки жителей.', kk: 'Тұрғындар тексергеннен кейін қайта ашылды.' })
    : d.status === 'RESOLVED' ? tx({ en: '109 closed it. Is it actually fixed?', ru: '109 закрыла заявку. Действительно исправлено?', kk: '109 жапты. Шынымен түзелді ме?' })
    : tx({ en: 'The team reports it is fixed. Is it really?', ru: 'Исполнитель сообщил, что проблема решена. Это так?', kk: 'Орындаушы шешілді дейді. Солай ма?' })
  return (
    <section id="verify" className={`fade-in flex scroll-mt-4 flex-col gap-4 rounded-[24px] p-5 ${tone}`}>
      <Eyebrow>{tx({ en: 'Residents’ check', ru: 'Проверка жителями', kk: 'Тұрғындар тексеруі' })}{v.round > 1 ? ` · ${tx({ en: 'round', ru: 'раунд', kk: 'кезең' })} ${v.round}` : ''}</Eyebrow>
      <p className="t-hero !text-[20px] text-text">{headline}</p>
      {n ? (
        <div className="flex flex-col gap-2">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <span className="bg-green transition-[width] duration-700" style={{ width: `${(v.yes / n) * 100}%` }} />
            <span className="bg-amber transition-[width] duration-700" style={{ width: `${(v.partial / n) * 100}%` }} />
            <span className="bg-red transition-[width] duration-700" style={{ width: `${(v.no / n) * 100}%` }} />
          </div>
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 t-sub text-secondary">
            <span className="t-row text-text">{tx({ en: 'Checked', ru: 'Проверили', kk: 'Тексерді' })}: {n}</span>
            <span><b className="text-green">{v.yes}</b> {tx({ en: 'yes', ru: 'да', kk: 'иә' })}</span>
            <span><b className="text-amber">{v.partial}</b> {tx({ en: 'partly', ru: 'частично', kk: 'ішінара' })}</span>
            <span><b className="text-red">{v.no}</b> {tx({ en: 'no', ru: 'нет', kk: 'жоқ' })}</span>
          </p>
          <p className="t-card text-text">{v.pct}% {tx({ en: 'confirmed it is fixed', ru: 'подтвердили устранение', kk: 'шешілгенін растады' })}</p>
          {v.quality != null || v.speed != null ? <p className="t-meta text-secondary">{[v.quality != null ? `${tx({ en: 'Quality', ru: 'Качество', kk: 'Сапа' })} ${v.quality.toFixed(1)}/5` : null, v.speed != null ? `${tx({ en: 'Speed', ru: 'Скорость', kk: 'Жылдамдық' })} ${v.speed.toFixed(1)}/5` : null].filter(Boolean).join(' · ')}</p> : null}
          {d.status === 'EVIDENCE_SUBMITTED' && v.outcome !== 'verified' ? <p className="t-meta text-faint">{tx({ en: `Closes when at least ${v.quorum} of the affected residents answer and 60% say “yes, fully”. One “no” never reopens it on its own.`, ru: `Закроется, когда ответят не меньше ${v.quorum} затронутых жителей и 60% скажут «да, полностью». Один ответ «нет» сам по себе не открывает заявку снова.`, kk: `Кемінде ${v.quorum} тұрғын жауап беріп, 60% «иә» десе жабылады.` })}</p> : null}
        </div>
      ) : d.status === 'EVIDENCE_SUBMITTED' ? <p className="t-sub text-secondary">{tx({ en: 'Waiting for the residents who reported or confirmed it.', ru: 'Ждём ответов жителей, которые сообщили или подтвердили проблему.', kk: 'Хабарлаған не растаған тұрғындардың жауабын күтудеміз.' })}</p> : null}
      {asking ? <VerifyButtons id={d.id} mine={d.my_answer?.answer ?? null} onDone={onDone} /> : d.status === 'EVIDENCE_SUBMITTED' && !d.can_verify ? <p className="t-meta text-secondary">{tx({ en: 'Residents who reported or confirmed it can answer.', ru: 'Ответить могут жители, которые сообщили или подтвердили проблему.', kk: 'Хабарлаған не растаған тұрғындар жауап бере алады.' })}</p> : null}
    </section>
  )
}

/** Proof of completion: before/after, what was done, when. The AI check advises; people decide. */
function Completion({ d }: { d: IncidentDetailDTO }) {
  const { lang, tx } = useApp()
  if (!d.completion_note && !d.evidence.length) return null
  const check = d.evidence_check as { verdict: string; checks: Array<{ key: string; ok: boolean; detail?: string }> } | null
  return (
    <section className="flex flex-col gap-3 rounded-[24px] bg-surface p-5 card-shadow">
      <h2 className="t-section text-text">{tx({ en: 'Completion', ru: 'Результат работ', kk: 'Жұмыс нәтижесі' })}</h2>
      {d.evidence.length ? (
        <div className="grid grid-cols-2 gap-2">
          {d.evidence.map((e, k) => (
            <figure key={k} className="relative overflow-hidden rounded-[14px] bg-surface-2 hairline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {e.image ? <img src={e.image} alt={e.kind} className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3]" />}
              <figcaption className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 t-label !text-[10px] text-white">{e.kind === 'before' ? tx({ en: 'Before', ru: 'До', kk: 'Дейін' }) : tx({ en: 'After', ru: 'После', kk: 'Кейін' })}</figcaption>
            </figure>
          ))}
        </div>
      ) : <p className="t-meta text-secondary">{tx({ en: 'No photo: for an outage the residents’ answers are the proof.', ru: 'Без фото: для отключений доказательство — ответы жителей.', kk: 'Фотосыз: ажырату үшін дәлел — тұрғындардың жауаптары.' })}</p>}
      {d.completion_note ? (
        <div className="flex flex-col gap-0.5">
          <span className="t-label !text-[11px] text-faint">{tx({ en: 'Work done', ru: 'Выполненные работы', kk: 'Орындалған жұмыс' })} · {tx(SOURCE.organization!)}</span>
          <p className="t-body text-text">{d.completion_note}</p>
        </div>
      ) : null}
      {d.completed_at ? <p className="t-meta text-secondary" suppressHydrationWarning>{tx({ en: 'Completed', ru: 'Завершено', kk: 'Аяқталды' })}: {fmtDate(new Date(d.completed_at), lang)}, {fmtTime(new Date(d.completed_at))}</p> : null}
      {check ? (
        <details className="rounded-[14px] bg-surface-2 p-3 hairline">
          <summary className="tap flex cursor-pointer list-none items-center justify-between gap-2"><CopilotTag>{tx({ en: 'Photo check · advice, not a verdict', ru: 'Проверка фото · подсказка, не решение', kk: 'Фото тексеру · ұсыныс' })}</CopilotTag><Icon name="chevron" size={14} className="text-faint" /></summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {check.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2">
                <Icon name={c.ok ? 'check' : 'x'} size={15} className={`mt-0.5 ${c.ok ? 'text-green' : 'text-amber'}`} />
                <span className="flex flex-col"><span className="t-sub text-text">{tx(CHECK[c.key] ?? { en: c.key, ru: c.key })}</span>{c.detail ? <span className="t-mono text-[10.5px] text-faint">{c.detail}</span> : null}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

/** A repeat: the earlier repair, who did it, how residents rated it. */
function Previous({ d }: { d: IncidentDetailDTO }) {
  const { lang, tx } = useApp()
  const p = d.previous!
  const days = p.closed_at ? Math.max(0, Math.round((Date.now() - new Date(p.closed_at).getTime()) / 86400_000)) : null
  return (
    <Link href={`/incident/${p.code}`} className="tap flex flex-col gap-2 rounded-[24px] bg-amber-soft p-5 hairline">
      <span className="t-label text-amber">{tx({ en: 'Recurring problem', ru: 'Повторная проблема', kk: 'Қайталанған мәселе' })}</span>
      <p className="t-row text-text" suppressHydrationWarning>{tx({ en: 'Previous repair', ru: 'Предыдущий ремонт', kk: 'Алдыңғы жөндеу' })}: {days == null ? p.code : days === 0 ? tx({ en: 'today', ru: 'сегодня', kk: 'бүгін' }) : `${days} ${plural(lang, days, { en: ['day ago', 'days ago'], ru: ['день назад', 'дня назад', 'дней назад'], kk: 'күн бұрын' })}`}</p>
      <p className="t-sub text-secondary">{tx({ en: 'By', ru: 'Исполнитель', kk: 'Орындаушы' })}: {term(lang, p.team ?? p.responsible_org ?? '—')}{p.verify_quality != null ? ` · ${tx({ en: 'residents’ rating', ru: 'оценка жителей', kk: 'тұрғындар бағасы' })} ${p.verify_quality.toFixed(1)} / 5` : ''}</p>
      <span className="t-meta font-bold text-amber">{p.code} →</span>
    </Link>
  )
}

/** "The problem came back": a new incident, linked to this repair. */
function Returned({ d }: { d: IncidentDetailDTO }) {
  const { tx } = useApp()
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [done, setDone] = useState<string | null>(null)
  if (done) return <LinkButton href={`/incident/${done}`} style="secondary">{tx({ en: 'Open the new report', ru: 'Открыть новое обращение', kk: 'Жаңа өтінішті ашу' })}</LinkButton>
  return (
    <Button style="outline" disabled={state === 'busy'} onClick={async () => {
      setState('busy')
      try {
        const r = await fetch(`/api/incidents/${d.id}/returned`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        const j = await r.json()
        if (!r.ok) throw new Error()
        setDone(j.incident_id)
      } catch { setState('error') }
    }}><Icon name="alert" size={17} />{state === 'error' ? tx({ en: 'Try again', ru: 'Повторить', kk: 'Қайталау' }) : tx({ en: 'The problem came back', ru: 'Проблема вернулась', kk: 'Мәселе қайталанды' })}</Button>
  )
}

function Timeline({ d }: { d: IncidentDetailDTO }) {
  const { lang, tx } = useApp()
  const tl = collapseSignals(d.timeline)
  return (
    <section className="flex flex-col gap-1 rounded-[24px] bg-surface p-5 card-shadow">
      <h2 className="t-section mb-2 text-text">{tx({ en: 'Live timeline', ru: 'Хронология', kk: 'Хронология' })}</h2>
      {tl.map((x) => {
        const k = KIND_ICON[x.kind] ?? { icon: 'bell' as IconName, cls: 'text-secondary' }
        return (
          <div key={x.id} className="relative flex gap-3 pb-4 last:pb-0">
            <span className="absolute bottom-0 left-[17px] top-9 w-px bg-line" aria-hidden />
            <span className="relative grid size-9 flex-none place-items-center rounded-full bg-surface-2 hairline"><Icon name={k.icon} size={16} className={k.cls} /></span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-1">
              <p className="t-row text-text">{timelineText(lang, x)}</p>
              <p className="t-mono text-[11px] text-faint" suppressHydrationWarning>{fmtTime(new Date(x.created_at))} · {fmtDate(new Date(x.created_at), lang)} · {tx(sourceLabel(x))}</p>
            </div>
          </div>
        )
      })}
      <p className="t-meta pt-2 text-faint">{tx({ en: 'Residents’ own words and photos are visible only to 109.', ru: 'Тексты и фото жителей видит только 109.', kk: 'Тұрғындардың мәтіні мен фотосын тек 109 көреді.' })}</p>
    </section>
  )
}

type TL = IncidentDetailDTO['timeline'][number]
/** Runs of "one more report" collapse into one line. */
function collapseSignals(tl: TL[]): TL[] {
  const out: TL[] = []
  let run: TL[] = []
  const flush = () => {
    if (run.length <= 2) out.push(...run)
    else out.push({ ...run[run.length - 1]!, kind: 'signals', message: `+${run.length}`, data: { n: run.length } })
    run = []
  }
  for (const x of tl) { if (x.kind === 'signal') run.push(x); else { flush(); out.push(x) } }
  flush()
  return out
}

function QualityBadge({ v }: { v: string }) {
  const { tx } = useApp()
  return v === 'good' ? <Badge tone="resolved">{tx({ en: 'Complete answer', ru: 'Полный ответ', kk: 'Толық жауап' })}</Badge>
    : v === 'needs_work' ? <Badge tone="planned">{tx({ en: 'Needs detail', ru: 'Нужна детализация', kk: 'Толықтыру керек' })}</Badge>
    : <Badge tone="active">{tx({ en: 'Insufficient', ru: 'Недостаточный', kk: 'Жеткіліксіз' })}</Badge>
}

const LEVEL: Record<string, { en: string; ru: string; kk: string }> = {
  object: { en: 'Object', ru: 'Объект', kk: 'Нысан' }, system: { en: 'System', ru: 'Система', kk: 'Жүйе' }, balance_holder: { en: 'Balance holder', ru: 'Балансодержатель', kk: 'Баланс ұстаушы' },
  service_company: { en: 'Service company', ru: 'Обслуживающая', kk: 'Қызмет көрсетуші' }, contractor: { en: 'Contractor', ru: 'Подрядчик', kk: 'Мердігер' },
  department: { en: 'Responsible dept.', ru: 'Ответственный отдел', kk: 'Жауапты бөлім' }, escalation: { en: 'Escalation', ru: 'Эскалация', kk: 'Эскалация' },
}

export function Responsibility({ d, bare = false }: { d: Pick<IncidentDetailDTO, 'responsible_chain' | 'responsible_org' | 'routing_confidence' | 'routing_note' | 'needs_human_review'> & { routed_at?: string | null }; bare?: boolean }) {
  const { tx, lang } = useApp()
  const chain = (d.responsible_chain as Array<{ level: string; name: string; note?: string }>) ?? []
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        {!bare ? <h2 className="t-section text-text">{tx({ en: 'Who is responsible', ru: 'Кто отвечает', kk: 'Кім жауапты' })}</h2> : <span className="t-meta text-secondary">{d.routed_at ? tx({ en: 'Confirmed by 109', ru: 'Подтверждено 109', kk: '109 растады' }) : tx({ en: 'Suggested, not confirmed', ru: 'Подсказка, не подтверждено', kk: 'Ұсыныс, расталмаған' })}</span>}
        <CopilotTag>{d.routing_confidence != null ? `${Math.round(d.routing_confidence * 100)}%` : 'Graph'}</CopilotTag>
      </div>
      <ol className="flex flex-col">
        {chain.map((c, k) => {
          const isOrg = c.name === d.responsible_org
          return (
            <li key={k} className="relative flex gap-3 pb-3 last:pb-0">
              {k < chain.length - 1 ? <span className="absolute bottom-0 left-[7px] top-4 w-px bg-line" aria-hidden /> : null}
              <span className={`relative mt-1 size-[15px] flex-none rounded-full ${isOrg ? 'beam-fill beam-glow' : c.level === 'escalation' ? 'bg-red' : 'bg-surface-2 hairline'}`} />
              <div className="flex min-w-0 flex-col">
                <span className="t-label !text-[9.5px] text-faint">{tx(LEVEL[c.level] ?? { en: c.level, ru: c.level })}</span>
                <span className={`t-row ${isOrg ? 'text-text' : 'text-secondary'}`}>{term(lang, c.name)}</span>
                {c.note ? <span className="t-meta text-faint">{term(lang, c.note)}</span> : null}
              </div>
            </li>
          )
        })}
      </ol>
      {d.routing_note ? <p className="t-meta rounded-[12px] bg-surface-2 p-3 text-secondary hairline">{term(lang, d.routing_note)}</p> : null}
      {d.needs_human_review ? <p className="flex items-center gap-1.5 t-meta font-bold text-amber"><Icon name="alert" size={14} />{tx({ en: 'Responsibility is ambiguous, a 109 operator decides.', ru: 'Ответственность неоднозначна — решает оператор 109.', kk: 'Жауапкершілік анық емес — 109 операторы шешеді.' })}</p> : null}
    </>
  )
  return bare ? <div className="flex flex-col gap-3">{body}</div> : <section className="flex flex-col gap-3 rounded-[24px] bg-surface p-5 card-shadow">{body}</section>
}

export function Proof({ d }: { d: Pick<IncidentDetailDTO, 'evidence' | 'evidence_check'> & { completion_note?: string | null } }) {
  const { tx } = useApp()
  const check = d.evidence_check as { verdict: string; checks: Array<{ key: string; ok: boolean; detail?: string }> } | null
  return (
    <section className="flex flex-col gap-3 rounded-[24px] bg-surface p-5 card-shadow">
      <div className="flex items-center justify-between gap-2">
        <h2 className="t-section text-text">{tx({ en: 'Proof of completion', ru: 'Доказательство выполнения', kk: 'Орындалу дәлелі' })}</h2>
        {check ? <Badge tone={check.verdict === 'consistent' ? 'resolved' : check.verdict === 'inconsistent' ? 'active' : 'planned'}>{check.verdict === 'consistent' ? tx({ en: 'Consistent', ru: 'Подтверждается', kk: 'Сәйкес' }) : check.verdict === 'inconsistent' ? tx({ en: 'Inconsistent', ru: 'Не совпадает', kk: 'Сәйкес емес' }) : tx({ en: 'Cannot verify', ru: 'Нельзя подтвердить', kk: 'Растау мүмкін емес' })}</Badge> : null}
      </div>
      {d.evidence.length ? (
        <div className="grid grid-cols-2 gap-2">
          {d.evidence.map((e, k) => (
            <figure key={k} className="relative overflow-hidden rounded-[14px] bg-surface-2 hairline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {e.image ? <img src={e.image} alt={e.kind} className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3]" />}
              <figcaption className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 t-label !text-[9px] text-white">{e.kind === 'before' ? tx({ en: 'Before', ru: 'До', kk: 'Дейін' }) : tx({ en: 'After', ru: 'После', kk: 'Кейін' })}</figcaption>
            </figure>
          ))}
        </div>
      ) : <p className="t-sub text-secondary">{tx({ en: 'No photos yet. Visible problems need an “after” photo to be reported as done.', ru: 'Фото пока нет. Для видимых проблем без фото «после» работу не закрыть.', kk: 'Әзірге фото жоқ.' })}</p>}
      {d.completion_note ? <p className="t-sub text-text">{d.completion_note}</p> : null}
      {check ? (
        <ul className="flex flex-col gap-1.5">
          <li className="mb-1"><CopilotTag>{tx({ en: 'Evidence check · advice', ru: 'Проверка · подсказка', kk: 'Тексеру · ұсыныс' })}</CopilotTag></li>
          {check.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-2">
              <Icon name={c.ok ? 'check' : 'x'} size={16} className={`mt-0.5 ${c.ok ? 'text-green' : 'text-red'}`} />
              <span className="flex flex-col"><span className="t-sub text-text">{tx(CHECK[c.key] ?? { en: c.key, ru: c.key })}</span>{c.detail ? <span className="t-mono text-[10.5px] text-faint">{c.detail}</span> : null}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
