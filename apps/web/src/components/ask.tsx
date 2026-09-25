'use client'
// The structured /api/ask answer card: facts from the database, sources
// attached. The conversation itself lives in assistant.tsx.
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { agoShort } from '@aktau/i18n'
import { fmtDate, fmtTime } from '@aktau/normalization/time'
import type { AskResponse } from '@aktau/types'
import { useApp } from './app'
import { Badge, Button, CopilotTag, Divider, Eyebrow, Icon, LinkButton, type IconName } from './primitives'

const CONF: Record<AskResponse['confidence'], { tone: 'official' | 'community' | 'unknown'; label: { en: string; ru: string; kk: string }; icon: IconName }> = {
  confirmed: { tone: 'official', label: { en: 'Official source', ru: 'Официальный источник', kk: 'Ресми дереккөз' }, icon: 'shield' },
  reported: { tone: 'community', label: { en: 'Reported', ru: 'Сообщается', kk: 'Хабарланған' }, icon: 'people' },
  no_information: { tone: 'unknown', label: { en: 'No confirmed information', ru: 'Нет подтверждённой информации', kk: 'Расталған ақпарат жоқ' }, icon: 'eye' },
  model: { tone: 'unknown', label: { en: 'Forecast · model', ru: 'Прогноз · модель', kk: 'Болжам · модель' }, icon: 'wind' },
}

/** The deterministic answer card (assistant basic mode, and anywhere an AskResponse is shown). */
export function Answer({ a }: { a: AskResponse }) {
  const { lang, t, tx } = useApp()
  const conf = CONF[a.confidence]
  const d = a.data as Record<string, any>
  const firstEvent = a.event_ids[0]
  const places = (d.places ?? []) as Array<{ id: string; label: string; sublabel: string; distance_m: number | null; open_now: boolean | null }>
  return (
    <div className="rise flex flex-col gap-3">
      <article className="flex flex-col gap-4 rounded-[24px] rounded-tl-[8px] bg-surface p-5 card-shadow">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={conf.tone} dot>{tx(conf.label)}</Badge>
          {a.phrased_by === 'llm' ? <CopilotTag>{tx({ en: 'wording', ru: 'формулировка', kk: 'тұжырым' })}</CopilotTag> : null}
        </div>
        <p className={`${a.message.length > 60 ? 't-headline' : 't-title !text-[26px]'} text-text whitespace-pre-line [text-wrap:pretty]`}>{a.message}</p>
        {a.detail ? <p className="t-body text-secondary">{a.detail}</p> : null}
        {a.answer_type === 'utility' && d.start ? (
          <div className="flex items-center gap-3 rounded-[16px] bg-surface-2 p-3 hairline">
            <span className="grid size-10 place-items-center rounded-[12px] bg-soft"><Icon name={d.service === 'electricity' ? 'power' : d.service === 'heating' ? 'flame' : 'water'} size={20} className="text-blue" /></span>
            <div className="flex flex-col gap-0.5">
              <span className="t-row t-mono text-text" suppressHydrationWarning>{fmtDate(new Date(d.start), lang)} · {fmtTime(new Date(d.start))}{d.expected_end ? `–${fmtTime(new Date(d.expected_end))}` : ''}</span>
              <span className="t-meta text-secondary">{d.location?.label}</span>
            </div>
          </div>
        ) : null}
        {places.length ? (
          <div className="flex flex-col">
            {places.map((p) => (
              <Link key={p.id} href={`/place/${p.id}`} className="tap -mx-2 flex min-h-[52px] items-center gap-3 rounded-[14px] px-2 hover:bg-surface-2">
                <span className="grid size-9 place-items-center rounded-[12px] bg-surface-2 hairline"><Icon name="food" size={17} className="text-blue" /></span>
                <span className="flex min-w-0 flex-1 flex-col"><span className="t-row text-text">{p.label}</span><span className="t-meta text-secondary">{[p.sublabel, p.distance_m != null ? `${p.distance_m} m` : null, p.open_now === true ? tx({ en: 'Open now', ru: 'Открыто', kk: 'Ашық' }) : null].filter(Boolean).join(' · ')}</span></span>
                <Icon name="chevron" size={16} className="text-faint" />
              </Link>
            ))}
          </div>
        ) : null}
        {a.sources.length ? (
          <>
            <Divider />
            <div className="flex flex-col gap-2">
              {a.sources.slice(0, 3).map((s) => (
                <div key={s.name} className="flex items-center gap-2.5">
                  <Icon name="shield" size={16} className="text-blue" />
                  <span className="t-sub font-semibold text-text">{s.name}</span>
                  <span className="t-meta text-secondary" suppressHydrationWarning>{s.type === 'OFFICIAL' || s.type === 'GOVERNMENT' ? `${t('badge.official')} · ` : ''}{s.updated_at ? t('updated', { ago: agoShort(lang, s.updated_at) }) : ''}</span>
                  {firstEvent ? <Link className="ml-auto t-meta font-bold text-blue" href={`/event/${firstEvent}`}>{t('action.viewSource')}</Link> : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
        {firstEvent && a.answer_type === 'utility' ? <LinkButton href={`/event/${firstEvent}`}>{t('action.notifyBefore')}</LinkButton> : null}
        {a.answer_type === 'directions' && d.open_in ? <a href={d.open_in} target="_blank" rel="noreferrer" className="tap inline-flex h-[50px] items-center justify-center gap-2 rounded-[16px] bg-blue text-[15px] font-bold text-on-blue"><Icon name="route" size={18} />{t('action.directions')}</a> : null}
      </article>
      {firstEvent ? <LinkButton href={`/map?event=${firstEvent}`} style="secondary" size="sm"><Icon name="map" size={16} />{t('action.showArea')}</LinkButton> : null}
      <p className="px-1 t-meta text-faint">{tx({ en: 'Answered from Aktau’s database', ru: 'Ответ из базы данных Aktau', kk: 'Aktau дерекқорынан жауап' })}{a.phrased_by === 'llm' ? tx({ en: ' · wording by AI, facts checked', ru: ' · формулировка AI, факты проверены', kk: ' · AI тұжырымы, фактілер тексерілген' }) : ''}. {tx({ en: 'No notice is not a guarantee of service.', ru: 'Отсутствие уведомления — не гарантия подачи.', kk: 'Хабарламаның жоқтығы — кепілдік емес.' })}</p>
    </div>
  )
}
