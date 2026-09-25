// Operational helpers: rate limiting, demo scenario, admin read models,
// local scheduler. (Production scheduling is Supabase Cron → /api/cron/*.)
import { createHash } from 'node:crypto'
import { CONNECTORS } from '@aktau/connectors'
import { addDays, fromLocal, localDate } from '@aktau/normalization/time'
import { audit } from './audit.ts'
import type { Sql } from './db/client.ts'
import { ingestManual, runJob } from './ingest.ts'
import { log } from './log.ts'
import { publishCandidate } from './publish.ts'

// ── Rate limiting (fixed window, hashed keys, no raw IPs stored) ────────────
export async function rateLimit(sql: Sql, bucket: string, subject: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; remaining: number }> {
  const key = `${bucket}:${createHash('sha256').update(subject).digest('hex').slice(0, 24)}`
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000)
  const [r] = await sql<{ count: number }[]>`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count`
  const count = r?.count ?? 1
  return { ok: count <= limit, remaining: Math.max(0, limit - count) }
}

// ── Demo mode ───────────────────────────────────────────────────────────────
// Demo items are stored with is_demo = true end-to-end and labelled in every
// surface. They exercise the real pipeline: raw item → extraction → review.
export function demoAnnouncement(now = new Date()) {
  const d = addDays(localDate(now), 1)
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
  return {
    source_slug: 'aues',
    title: 'Плановое отключение электроэнергии',
    text: `ГКП «АУЭС» сообщает: ${d.day} ${months[d.month - 1]} с 13:30 до 17:30 в связи с плановыми ремонтными работами на ТП будет отключена электроэнергия в 14 микрорайоне, дома №19, 20, 21, 22, 23.`,
    starts: fromLocal(d.year, d.month, d.day, 13, 30),
  }
}

export async function injectDemo(sql: Sql, actor: string, opts: { autoApprove?: boolean; scenario?: 'aues_power' | 'water_no_eta' | 'road' } = {}) {
  if (process.env.DEMO_MODE !== 'true') throw new Error('DEMO_MODE is off')
  const scenario = opts.scenario ?? 'aues_power'
  const input =
    scenario === 'aues_power' ? demoAnnouncement()
    : scenario === 'water_no_eta' ? { source_slug: 'kzhsa', title: 'Аварийное отключение воды', text: 'В связи с аварией на водоводе прекращена подача питьевой воды в 7 микрорайоне, дома 5, 6 и 8. Время восстановления будет сообщено дополнительно. ТОО «КЖСА».' }
    : { source_slug: 'aktau_akimat', title: 'Ограничение движения', text: 'С завтрашнего дня перекрыто движение на участке дороги между 27 и 16 микрорайонами в связи с ремонтом дорожного покрытия. Акимат города Актау.' }
  const r = await ingestManual(sql, { ...input, actor, is_demo: true })
  await audit(sql, actor, 'demo.inject', 'source_item', r.source_item_id, null, { scenario })
  if (opts.autoApprove) for (const id of r.candidate_ids) await publishCandidate(sql, id, { actor })
  return r
}

export async function clearDemo(sql: Sql, actor: string) {
  const n = await sql`delete from city_events where is_demo = true`
  await sql`delete from event_candidates c using source_items si where si.id = c.source_item_id and si.is_demo = true`
  await sql`delete from source_items where is_demo = true`
  await audit(sql, actor, 'demo.clear', 'city_event', null, null, { removed: n.count })
  return n.count
}

// ── Admin read models ───────────────────────────────────────────────────────
export async function sourceHealth(sql: Sql) {
  const rows = await sql<{ slug: string; name: string; organization: string | null; source_type: string; authority_level: number; adapter_type: string; enabled: boolean; poll_interval_seconds: number | null; last_successful_fetch_at: Date | null; last_attempt_at: Date | null; notes: string | null; last_status: string | null; last_error: string | null; last_items: number | null; last_new: number | null; last_ms: number | null; runs_24h: number; failures_24h: number; items_total: number }[]>`
    select s.slug, s.name, s.organization, s.source_type, s.authority_level, s.adapter_type, s.enabled, s.poll_interval_seconds,
      s.last_successful_fetch_at, s.last_attempt_at, s.notes,
      r.status last_status, r.error last_error, r.items_found last_items, r.items_new last_new, r.duration_ms last_ms,
      (select count(*)::int from source_fetch_runs x where x.source_id = s.id and x.started_at > now() - interval '24 hours') runs_24h,
      (select count(*)::int from source_fetch_runs x where x.source_id = s.id and x.started_at > now() - interval '24 hours' and x.status = 'FAILED') failures_24h,
      (select count(*)::int from source_items i where i.source_id = s.id) items_total
    from sources s
    left join lateral (select * from source_fetch_runs fr where fr.source_id = s.id order by started_at desc limit 1) r on true
    order by s.authority_level desc, s.name`
  return Promise.all(rows.map(async (r) => {
    const conn = CONNECTORS[r.slug]
    const health = conn ? await conn.healthCheck() : { ok: true, mode: 'manual' as const, detail: '' }
    const overdue = r.poll_interval_seconds && r.last_successful_fetch_at ? Date.now() - r.last_successful_fetch_at.getTime() > r.poll_interval_seconds * 3000 : false
    const state = health.mode === 'manual' ? 'manual' : health.mode === 'disabled' || !r.enabled ? 'disabled'
      : r.last_status === 'FAILED' ? 'failing' : !r.last_successful_fetch_at ? 'pending' : overdue ? 'stale' : 'healthy'
    return { ...r, state, mode: health.mode, detail: health.detail }
  }))
}

export async function candidateQueue(sql: Sql, status = 'REVIEW_REQUIRED', limit = 50) {
  return sql`
    select c.id, c.status, c.segment_index, c.segment_text, c.extracted, c.extractor, c.parser_version, c.confidence, c.validation_errors, c.warnings,
      c.duplicate_of_event_id, c.duplicate_score, c.created_event_id, c.created_at, c.reviewed_by, c.reviewed_at, c.review_note,
      si.id source_item_id, si.title item_title, si.canonical_url, si.published_at, si.fetched_at, si.raw_text, si.reported_authority, si.is_demo,
      s.slug source_slug, s.name source_name, s.source_type, s.authority_level,
      de.title duplicate_title, de.status duplicate_status
    from event_candidates c join source_items si on si.id = c.source_item_id join sources s on s.id = si.source_id
    left join city_events de on de.id = c.duplicate_of_event_id
    where ${status === 'ALL' ? sql`true` : sql`c.status = ${status}`}
    order by c.created_at desc limit ${limit}`
}

// ── Local scheduler (dev only; production uses Supabase Cron) ───────────────
let started = false
export function startLocalScheduler(sql: Sql) {
  if (started || process.env.LOCAL_SCHEDULER !== 'true') return
  started = true
  const plan: Array<[Parameters<typeof runJob>[1], number, number]> = [
    ['weather', 10 * 60_000, 3_000],
    ['observations', 30 * 60_000, 6_000],
    ['air-marine', 30 * 60_000, 9_000],
    ['media', 15 * 60_000, 15_000],
    ['lifecycle', 5 * 60_000, 20_000],
    ['places', 24 * 3600_000, 30_000],
    ['afisha', 3 * 3600_000, 40_000],
  ]
  for (const [job, every, delay] of plan) {
    const run = () => runJob(sql, job).catch((err) => log('error', 'scheduler.job_failed', { job, err }))
    setTimeout(() => { void run(); setInterval(run, every).unref() }, delay).unref()
  }
  log('info', 'scheduler.started', { jobs: plan.map((p) => p[0]) })
}
