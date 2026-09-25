// Widget state: a compact, precomputed projection of Aktau Now. The iOS
// widget renders this verbatim — it never reconstructs city logic.
import { eventHeadline, t } from '@aktau/i18n'
import { fmtTime } from '@aktau/normalization/time'
import type { AktauNowDTO, Lang, WidgetState } from '@aktau/types'

export function widgetStateFrom(now: AktauNowDTO, lang: Lang, at: Date): WidgetState {
  const e = now.priority_event && now.priority_event.relevance !== 'NO' ? now.priority_event : null
  const personal = now.location.kind !== 'city'
  let headline = now.overall === 'CALM' ? (personal ? t(lang, 'widget.calm') : now.headline) : now.overall === 'UNKNOWN' ? t(lang, 'widget.unknown') : now.headline
  let detail: string | null = null
  if (e) {
    headline = eventHeadline(lang, e)
    const s = e.starts_at ? fmtTime(new Date(e.starts_at)) : null
    const end = e.expected_ends_at ? fmtTime(new Date(e.expected_ends_at)) : null
    const ongoing = e.display_status === 'ACTIVE' || e.display_status === 'DELAYED'
    detail = ongoing
      ? end ? t(lang, 'eta.expected', { time: end }) : t(lang, 'eta.unknown')
      : s && end ? t(lang, 'time.window', { start: s, end }) : s ? t(lang, 'time.from', { start: s }) : null
    if (e.relevance === 'DIRECT') detail = [detail, t(lang, 'relevance.DIRECT')].filter(Boolean).join(' · ')
  }
  const f = now.weather.forecast
  // Refresh sooner around a known transition, otherwise every 30 minutes.
  const nextEdge = [e?.starts_at, e?.expected_ends_at].filter(Boolean).map((x) => new Date(x!).getTime()).filter((x) => x > at.getTime()).sort()[0]
  const refresh = Math.min(nextEdge ?? Infinity, at.getTime() + 30 * 60_000)
  return {
    status: now.overall,
    headline,
    detail,
    event_id: e?.id ?? null,
    deep_link: e ? `aktau://event/${e.id}` : 'aktau://home',
    weather: f ? { temperature_c: f.temperature_c, wind_ms: f.wind_ms, provider: f.provider } : null,
    location_label: now.location.label,
    updated_at: at.toISOString(),
    refresh_after: new Date(refresh).toISOString(),
  }
}
