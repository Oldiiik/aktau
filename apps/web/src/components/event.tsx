'use client'
// Event detail + history. Every event answers "Where did this come from?":
// source announcement → raw record → extracted structure → city event → updates.
import { useCallback, useState } from 'react'
import { agoShort } from '@aktau/i18n'
import { fmtDate, fmtTime } from '@aktau/normalization/time'
import type { CityEventDetailDTO, EventUpdateDTO } from '@aktau/types'
import { useApp, useRealtime } from './app'
import { BackLink, Badge, Card, Divider, Eyebrow, Icon, LinkButton, type IconName } from './primitives'
import { NotifyButton } from './home'
import { CATEGORY_ICON, areasText, authorityName, etaText, headline, isOngoing, relevanceText, statusBadge, trust, windowText } from '@/lib/present'

function updateIcon(u: EventUpdateDTO, cat: IconName): { icon: IconName; cls: string } {
  if (u.update_type === 'ETA_CHANGED') return { icon: 'clock', cls: 'text-blue' }
  if (u.new_status === 'RESOLVED') return { icon: 'check', cls: 'text-green' }
  if (u.update_type === 'STATUS_CHANGED' && (u.new_status === 'ACTIVE' || u.new_status === 'DELAYED')) return { icon: cat, cls: 'text-red' }
  if (u.update_type === 'CONFLICT_NOTED') return { icon: 'alert', cls: 'text-amber' }
  return { icon: 'shield', cls: 'text-secondary' }
}

function updateLabel(t: (k: string, p?: Record<string, string | number>) => string, u: EventUpdateDTO) {
  if (u.update_type === 'STATUS_CHANGED' && u.new_status) {
    const key = `upd.STATUS_CHANGED.${u.new_status}`
    const v = t(key)
    return v === key ? t(`badge.${u.new_status}`) : v
  }
  return t(`upd.${u.update_type}`)
}

export function EventHistory({ detail, limit = 4 }: { detail: CityEventDetailDTO; limit?: number }) {
  const { t, lang } = useApp()
  const cat = CATEGORY_ICON[detail.category]
  const updates = detail.updates.slice(0, limit)
  return (
    <Card className="gap-1">
      <h2 className="t-section mb-3 text-text">{t('history.title')}</h2>
      {updates.map((u, i) => {
        const ic = updateIcon(u, cat)
        return (
          <div key={u.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < updates.length - 1 ? <span className="absolute bottom-0 left-[17px] top-9 w-px bg-line" aria-hidden /> : null}
            <span className="relative grid size-9 flex-none place-items-center rounded-full bg-surface-2 hairline"><Icon name={ic.icon} size={16} className={ic.cls} /></span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-1">
              <p className="t-row text-text" suppressHydrationWarning><span className="t-mono mr-1.5 text-faint">{fmtTime(new Date(u.created_at))}</span>{updateLabel(t, u)}</p>
              {u.update_type === 'ETA_CHANGED' && u.new_expected_end ? <p className="t-meta text-secondary">{t('upd.eta', { time: fmtTime(new Date(u.new_expected_end)) })}</p>
                : u.message && (lang === 'en' || !/^[\x00-\x7F]+$/.test(u.message)) ? <p className="t-meta text-secondary">{u.message}</p> : null}
            </div>
          </div>
        )
      })}
      {detail.expected_ends_at && isOngoing(detail) ? <p className="t-meta pt-2 text-secondary">{t('history.estimate', { source: authorityName(detail) })}</p> : null}
    </Card>
  )
}

const REL_TONE = { PRIMARY: 'official', CONFIRMING: 'resolved', UPDATE: 'planned', CONTRADICTING: 'active' } as const

export function EventDetailView({ initial }: { initial: CityEventDetailDTO }) {
  const { lang, t, tx } = useApp()
  const [e, setE] = useState(initial)
  const reload = useCallback(() => { fetch(`/api/events/${e.id}?lang=${lang}`, { cache: 'no-store' }).then((r) => r.json()).then(setE).catch(() => {}) }, [e.id, lang])
  useRealtime((ev) => { if (ev.id === e.id) reload() })
  const h = headline(lang, e)
  const b = statusBadge(lang, e)
  const tr = trust(lang, e)
  const primary = e.sources.find((s) => s.relationship === 'PRIMARY') ?? e.sources[0]
  const rel = relevanceText(lang, e)
  const ongoing = isOngoing(e)

  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/">{t('nav.home')}</BackLink>
      <header className="rise flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={b.tone} dot>{b.label}</Badge>
          <Badge tone={tr.tone}>{tr.label}</Badge>
          {e.is_demo ? <Badge tone="demo">{t('badge.demo')}</Badge> : null}
          {e.freshness === 'stale' ? <Badge tone="unknown">{t('freshness.stale')}</Badge> : null}
        </div>
        <div className="flex items-start gap-4">
          <span className={`grid size-14 flex-none place-items-center rounded-[18px] ${ongoing ? 'bg-red text-bg' : e.display_status === 'RESOLVED' ? 'bg-green text-bg' : 'bg-amber text-bg'}`}><Icon name={CATEGORY_ICON[e.category]} size={26} /></span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="t-title text-text">{h.head}{h.when ? ` · ${h.when}` : ''}</h1>
            <p className="flex items-center gap-1.5 t-sub text-secondary" suppressHydrationWarning><Icon name="shield" size={14} className="text-blue" />{authorityName(e)} · {tr.kind} · {t('updated', { ago: agoShort(lang, e.last_confirmed_at) })}</p>
          </div>
        </div>
      </header>

      <Card className="rise rise-1 gap-4">
        {(() => {
          const title = [e.starts_at ? fmtDate(new Date(e.starts_at), lang) : null, windowText(lang, e)].filter(Boolean).join(' · ') || t('eta.unknown')
          const sub = ongoing || e.display_status === 'UNCONFIRMED' ? etaText(lang, e) : e.time_text ? `“${e.time_text}”` : null
          // Don't say the same sentence twice ("restoration time not announced").
          return <Row icon="clock" title={title} sub={sub && sub !== title ? sub : null} big />
        })()}
        <Divider />
        <Row icon="pin" title={areasText(lang, e)} sub={e.building_count ? `${t('scope.buildings', { list: e.buildings.map((x) => x.house_number).join(', ') })}` : e.areas.some((a) => a.coverage === 'PARTIAL') ? t('scope.partial') : null} />
        {rel ? <><Divider /><Row icon="home" title={rel} sub={null} /></> : null}
        {e.reason ? <><Divider /><Row icon="alert" title={e.reason.charAt(0).toUpperCase() + e.reason.slice(1)} sub={t('event.reason')} /></> : null}
        <div id="notify" className="grid grid-cols-2 gap-2.5 pt-1">
          <LinkButton href={`/map?event=${e.id}`} style="secondary"><Icon name="map" size={17} />{t('action.showMap')}</LinkButton>
          <NotifyButton eventId={e.id} label={t('action.notifyMe')} style="primary" />
        </div>
      </Card>

      <EventHistory detail={e} limit={20} />

      {/* ── Provenance ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-5 rounded-[24px] bg-surface p-5 card-shadow">
        <div className="flex flex-col gap-1.5">
          <Eyebrow>{tx({ en: 'Provenance', ru: 'Происхождение', kk: 'Шығу тегі' })}</Eyebrow>
          <h2 className="t-headline text-text">{tx({ en: 'Where did this come from?', ru: 'Откуда это известно?', kk: 'Бұл қайдан белгілі?' })}</h2>
          <p className="t-meta text-secondary">{tx({ en: 'Every step is stored. Nothing here was written by a language model.', ru: 'Каждый шаг сохранён. Ничего здесь не написано языковой моделью.', kk: 'Әр қадам сақталған. Мұнда тіл моделі ештеңе жазбаған.' })}</p>
        </div>
        {primary ? (
          <Step n={1} title={tx({ en: 'Source announcement', ru: 'Исходное сообщение', kk: 'Бастапқы хабарлама' })} meta={`${primary.reported_authority ? `${authorityName(e)} · ` : ''}${t('source.reported', { publisher: primary.source_name })}${primary.published_at ? ` · ${fmtDate(new Date(primary.published_at), lang)} ${fmtTime(new Date(primary.published_at))}` : ''}`}>
            <blockquote className="rounded-[14px] bg-surface-2 p-3.5 t-sub text-text hairline">“{primary.excerpt}”</blockquote>
            {primary.canonical_url ? <a href={primary.canonical_url} target="_blank" rel="noreferrer" className="t-meta font-bold text-blue underline-offset-2 hover:underline">{t('action.viewSource')} ↗</a> : null}
          </Step>
        ) : null}
        <Step n={2} title={tx({ en: 'Raw record preserved', ru: 'Сырая запись сохранена', kk: 'Бастапқы жазба сақталды' })} meta={primary ? `source_items/${primary.source_item_id.slice(0, 8)} · ${agoShort(lang, primary.fetched_at)}` : '-'}>
          <p className="t-meta text-secondary">{tx({ en: 'Original text kept verbatim for audit and re-parsing.', ru: 'Исходный текст хранится дословно для аудита и повторного разбора.', kk: 'Бастапқы мәтін аудит үшін сөзбе-сөз сақталады.' })}</p>
        </Step>
        <Step n={3} title={tx({ en: 'Extracted structure', ru: 'Извлечённая структура', kk: 'Алынған құрылым' })} meta={`${tx({ en: 'confidence', ru: 'уверенность', kk: 'сенімділік' })} ${Math.round(e.confidence * 100)}% · ${tx({ en: 'reviewed before publishing', ru: 'проверено до публикации', kk: 'жарияланар алдында тексерілді' })}`}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-[14px] bg-bg p-3.5 t-mono text-[11.5px] hairline">
            <dt className="text-faint">service</dt><dd className="text-text">{e.category.toLowerCase()} · {e.event_type.replace('_', ' ')}</dd>
            <dt className="text-faint">window</dt><dd className="text-text">{e.starts_at ? new Date(e.starts_at).toISOString().replace('.000', '') : 'not stated'} → {e.expected_ends_at ? new Date(e.expected_ends_at).toISOString().replace('.000', '') : 'not announced'}</dd>
            <dt className="text-faint">areas</dt><dd className="text-text">{e.areas.map((a) => `${a.designator ?? a.slug} (${a.coverage.toLowerCase().replace('_', ' ')})`).join(', ')}</dd>
            {e.building_count ? <><dt className="text-faint">houses</dt><dd className="text-text">{e.buildings.map((x) => x.house_number).join(', ')}</dd></> : null}
            <dt className="text-faint">authority</dt><dd className="text-text">{e.reported_authority ?? '-'}</dd>
          </dl>
        </Step>
        <Step n={4} title={tx({ en: 'City event', ru: 'Событие города', kk: 'Қала оқиғасы' })} meta={`${e.verification_status.toLowerCase()} · ${e.freshness}`} last>
          <p className="t-mono text-[11.5px] text-secondary">aktau://event/{e.id}</p>
        </Step>
        {e.sources.length > 1 ? (
          <div className="flex flex-col gap-2.5 border-t border-line pt-4">
            <p className="t-row text-text">{tx({ en: 'All evidence', ru: 'Все источники', kk: 'Барлық дереккөз' })} ({e.sources.length})</p>
            {e.sources.map((s) => (
              <div key={s.source_item_id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="t-sub font-semibold text-text">{s.source_name}{s.reported_authority ? ` · ${s.reported_authority}` : ''}</p>
                  <p className="t-meta line-clamp-2 text-secondary">{s.excerpt}</p>
                </div>
                <Badge tone={REL_TONE[s.relationship]}>{s.relationship.toLowerCase()}</Badge>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function Row({ icon, title, sub, big }: { icon: IconName; title: string; sub: string | null; big?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 flex-none place-items-center rounded-[12px] bg-surface-2 hairline"><Icon name={icon} size={17} className="text-blue" /></span>
      <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
        <p className={`${big ? 't-card' : 't-row'} text-text`} suppressHydrationWarning>{title}</p>
        {sub ? <p className="t-meta text-secondary" suppressHydrationWarning>{sub}</p> : null}
      </div>
    </div>
  )
}

function Step({ n, title, meta, children, last }: { n: number; title: string; meta: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className="relative flex gap-3.5">
      {!last ? <span className="absolute bottom-[-18px] left-[13px] top-8 w-px bg-line" /> : null}
      <span className="relative grid size-7 flex-none place-items-center rounded-full bg-soft t-mono text-[11px] font-bold text-blue">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pb-1">
        <div className="flex flex-col gap-0.5"><p className="t-row text-text">{title}</p><p className="t-meta text-secondary" suppressHydrationWarning>{meta}</p></div>
        {children}
      </div>
    </div>
  )
}
