// 109 Incident Engine — service layer.
//
//   signal → copilot intake → match (attach) | new incident (scope · priority · recurrence)
//          → residents confirm "this affects me too" (one per person, never a like)
//          → operator assigns a team → the team accepts and commits to a deadline
//          → work started → completion with proof → the affected residents verify
//          → verified | reopened            ("the problem came back" links a new one)
//
// One incident, many residents: every step lands in incident_timeline with its
// source; every meaningful one reaches everyone who reported or confirmed.
// A demo session is one more scope: after the audience is chosen, it is this
// same code path.
import {
  ACCEPT_MINUTES, MATCH_LIKELY, RESOLVE_HOURS, SERVICE_META, assessPriority, bestMatches, callQa, checkEvidence, checkResponse, completionNeedsPhoto,
  contentWords, etaWords, incidentAffects, incidentTitle, inferScope, intake as runIntake, photoRequirement, route as runRoute, slaState,
  verificationOutcome, type Channel, type EvidencePhoto, type IncidentService, type Intake, type OpenIncident, type PriorityLevel, type PriorityReason,
  type Route, type ScopeKind, type ScopeProposal,
} from '@aktau/city-core'
import { normalizeHouseNumber } from '@aktau/normalization/text'
import type { Lang } from '@aktau/types'
import { audit } from './audit.ts'
import type { Sql } from './db/client.ts'
import { resolveLocation } from './location.ts'
import { storedPhoto, type ReportCheck, type ReportPhotoInput } from './report-check.ts'

export class IncidentError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'IncidentError' }
}

export type Place = { area_id: string | null; area_name: string | null; building_id: string | null; lat: number | null; lon: number | null }

/** A shared location this close to a building is that building (the phone is at home or at the door). */
export const GPS_BUILDING_M = 40

export async function resolvePlace(sql: Sql, designator: string | null, house: string | null, near?: { lat: number; lon: number } | null): Promise<Place> {
  if (!designator && near) {
    const pt = sql`ST_SetSRID(ST_MakePoint(${near.lon}, ${near.lat}), 4326)::geography`
    const [[a], [b]] = await Promise.all([
      sql<{ id: string; name: string }[]>`
        select id, name from areas where area_type = 'MICRODISTRICT' and geometry is not null order by geometry <-> ${pt} limit 1`,
      sql<{ id: string }[]>`select id from buildings where point is not null and ST_DWithin(point, ${pt}, ${GPS_BUILDING_M}) order by point <-> ${pt} limit 1`,
    ])
    return { area_id: a?.id ?? null, area_name: a?.name ?? null, building_id: b?.id ?? null, lat: near.lat, lon: near.lon }
  }
  if (!designator) return { area_id: null, area_name: null, building_id: null, lat: null, lon: null }
  const [a] = await sql<{ id: string; name: string; lat: number | null; lon: number | null }[]>`
    select id, name, ST_Y(centroid::geometry) lat, ST_X(centroid::geometry) lon from areas
    where area_type = 'MICRODISTRICT' and upper(designator) = upper(${designator}) limit 1`
  if (!a) return { area_id: null, area_name: null, building_id: null, lat: null, lon: null }
  if (house) {
    const [b] = await sql<{ id: string; lat: number | null; lon: number | null }[]>`
      select id, ST_Y(point::geometry) lat, ST_X(point::geometry) lon from buildings
      where area_id = ${a.id} and house_number_norm = ${normalizeHouseNumber(house)} limit 1`
    if (b) return { area_id: a.id, area_name: a.name, building_id: b.id, lat: b.lat, lon: b.lon }
  }
  return { area_id: a.id, area_name: a.name, building_id: null, lat: a.lat, lon: a.lon }
}

// ── Demo sessions (the lookup the engine needs; the rest is in live.ts) ─────
export type SessionRow = { id: string; code: string; title: string; venue: string; lat: number | null; lon: number | null; status: string; created_by: string; created_at: Date; ended_at: Date | null }
export async function sessionById(sql: Sql, idOrCode: string): Promise<SessionRow | null> {
  const uuid = /^[0-9a-f-]{36}$/i.test(idOrCode)
  const [s] = await sql<SessionRow[]>`
    select id, code, title, venue, ST_Y(point::geometry) lat, ST_X(point::geometry) lon, status, created_by, created_at, ended_at from demo_sessions
    where ${uuid ? sql`id = ${idOrCode}::uuid` : sql`code = ${idOrCode.toLowerCase()}`}`
  return s ?? null
}

/** In a demo session the organiser's own team is responsible. */
function sessionRoute(s: SessionRow): Route {
  return {
    org: s.venue, confidence: 0.95, note: 'Demo session: the organiser at the venue is responsible.', needs_review: false, alternatives: [],
    chain: [{ level: 'object', name: s.venue }, { level: 'service_company', name: s.venue }, { level: 'contractor', name: DEMO_TEAM }],
  }
}
export const DEMO_TEAM = 'Demo IT Team'

// ── Matching inputs ─────────────────────────────────────────────────────────
type OpenRow = OpenIncident & { public_title: string | null; risk_flags: string[] }
/** `at`: the new report's point when it is building-precise; each incident then carries its distance to it (near_m). */
async function openIncidents(sql: Sql, sessionId: string | null, at: { lat: number; lon: number } | null = null): Promise<OpenRow[]> {
  const pt = at ? sql`ST_SetSRID(ST_MakePoint(${at.lon}, ${at.lat}), 4326)::geography` : null
  const rows = await sql<(Omit<OpenRow, 'last_signal_at' | 'first_signal_at' | 'words'> & { last_signal_at: Date; first_signal_at: Date; first_text: string | null })[]>`
    select i.id, i.code, i.service, i.status, i.area_id, a.designator, b.house_number house, i.last_signal_at, i.first_signal_at, i.signal_count, i.confirm_count,
      ST_Y(i.point::geometry) lat, ST_X(i.point::geometry) lon, (i.building_id is not null or coalesce(f.gps, false)) precise, i.problem_kind kind, i.demo_session_id session_id,
      i.public_title, i.risk_flags,
      ${pt ? sql`least(case when i.building_id is not null or f.gps then ST_Distance(i.point, ${pt}) end,
        (select min(ST_Distance(sb.point, ${pt})) from incident_buildings ib join buildings sb on sb.id = ib.building_id where ib.incident_id = i.id))` : sql`null::float8`} near_m,
      f.first_text
    from incidents i left join areas a on a.id = i.area_id left join buildings b on b.id = i.building_id
      -- The first report: its words, and whether its point is a shared location (precise without a building).
      left join lateral (select s.raw_text first_text, (s.intake->>'designator') is null and s.point is not null gps
        from incident_signals s where s.incident_id = i.id order by s.created_at limit 1) f on true
    where (i.status not in ('VERIFIED', 'REJECTED') or i.updated_at > now() - interval '24 hours')
      and i.merged_into_id is null
      and i.demo_session_id is not distinct from ${sessionId}::uuid
    -- Equal scores go to the older incident, the same way every time.
    order by i.created_at, i.code`
  return rows.map(({ first_text, ...r }) => ({
    ...r, last_signal_at: new Date(r.last_signal_at).toISOString(), first_signal_at: new Date(r.first_signal_at).toISOString(),
    words: first_text ? contentWords(first_text) : [],
  }))
}

async function adjacentAreas(sql: Sql, areaId: string | null): Promise<Set<string>> {
  if (!areaId) return new Set()
  const rows = await sql<{ id: string }[]>`
    select b.id from areas a join areas b on b.area_type = 'MICRODISTRICT' and b.id <> a.id and ST_DWithin(a.geometry, b.geometry, 400)
    where a.id = ${areaId}`
  return new Set(rows.map((r) => r.id))
}

async function routingHistory(sql: Sql, service: string, areaId: string | null): Promise<Record<string, number>> {
  const rows = await sql<{ org: string; n: number }[]>`
    select responsible_org org, count(*)::int n from incidents
    where service = ${service} and status in ('RESOLVED', 'VERIFIED') and responsible_org is not null and demo_session_id is null
      and (${areaId}::uuid is null or area_id = ${areaId})
    group by 1`
  return Object.fromEntries(rows.map((r) => [r.org, r.n]))
}

/** Official notices about the same service and place — "this is already announced". */
async function officialFor(sql: Sql, service: IncidentService, areaId: string | null, buildingId: string | null) {
  if (!areaId) return []
  const cat = SERVICE_META[service].category
  const cats = cat === 'WATER' || cat === 'HOT_WATER' ? ['WATER', 'HOT_WATER'] : [cat]
  if (cat === 'OTHER') return []
  return sql<{ id: string; title: string; status: string; starts_at: Date | null; expected_ends_at: Date | null; reported_authority: string | null; is_demo: boolean; building_limited: boolean; covers_building: boolean }[]>`
    select e.id, e.title, e.status, e.starts_at, e.expected_ends_at, e.reported_authority, e.is_demo,
      exists (select 1 from event_buildings eb where eb.event_id = e.id) building_limited,
      (${buildingId}::uuid is not null and exists (select 1 from event_buildings eb where eb.event_id = e.id and eb.building_id = ${buildingId})) covers_building
    from city_events e join event_areas ea on ea.event_id = e.id
    where ea.area_id = ${areaId} and e.category::text = any(${cats}::text[]) and e.status in ('SCHEDULED', 'ACTIVE', 'DEGRADED', 'DELAYED')
      and (e.starts_at is null or e.starts_at < now() + interval '12 hours')
    order by e.status = 'ACTIVE' desc, e.starts_at nulls last limit 3`
}

export type SignalPreview = Awaited<ReturnType<typeof previewSignal>>

/** Copilot view of a message: intake, place, scope, likely matches, official notices, suggested route. No writes. */
export async function previewSignal(sql: Sql, text: string, opts: { now?: Date; lat?: number | null; lon?: number | null; sessionId?: string | null } = {}) {
  const now = opts.now ?? new Date()
  const t0 = performance.now()
  const i = runIntake(text, now)
  const session = opts.sessionId ? await sessionById(sql, opts.sessionId) : null
  const place: Place = session
    ? { area_id: null, area_name: session.venue, building_id: null, lat: session.lat, lon: session.lon }
    : await resolvePlace(sql, i.designator, i.house, opts.lat != null && opts.lon != null ? { lat: opts.lat, lon: opts.lon } : null)
  const precise = !!place.building_id || (opts.lat != null && !i.designator)
  const [open, adj, hist, official] = await Promise.all([
    openIncidents(sql, session?.id ?? null, precise && place.lat != null && place.lon != null ? { lat: place.lat, lon: place.lon } : null),
    session ? Promise.resolve(new Set<string>()) : adjacentAreas(sql, place.area_id),
    session ? Promise.resolve({}) : routingHistory(sql, i.service, place.area_id), session ? Promise.resolve([]) : officialFor(sql, i.service, place.area_id, place.building_id),
  ])
  const matches = bestMatches({
    service: i.service, designator: i.designator, house: i.house, area_id: place.area_id, at: now, lat: place.lat, lon: place.lon,
    precise, kind: i.kind, words: contentWords(text), session_id: session?.id ?? null,
  }, open, adj)
  const r = session ? sessionRoute(session) : runRoute(i, hist)
  const scope: ScopeProposal = session ? { kind: 'demo_session', radius_m: null, reason: 'demo_session' }
    : inferScope(i, { building_id: place.building_id, area_id: place.area_id, has_point: place.lat != null && place.lon != null })
  return {
    intake: i, place, route: r, photo: photoRequirement(i), scope, session: session ? { id: session.id, code: session.code, title: session.title, venue: session.venue } : null,
    matches: matches.map((m) => {
      const inc = m.incident as OpenRow
      return {
        id: inc.id, code: inc.code, service: inc.service, status: inc.status, designator: inc.designator, house: inc.house, signal_count: inc.signal_count,
        confirm_count: inc.confirm_count ?? 0, first_signal_at: inc.first_signal_at, last_signal_at: inc.last_signal_at, public_title: inc.public_title,
        kind: inc.kind ?? null, risk_flags: inc.risk_flags, score: m.score, reasons: m.reasons, likely: m.score >= MATCH_LIKELY,
      }
    }),
    official: official.filter((o) => !o.building_limited || o.covers_building || !place.building_id).map((o) => ({ ...o, starts_at: o.starts_at?.toISOString() ?? null, expected_ends_at: o.expected_ends_at?.toISOString() ?? null })),
    ms: Math.round(performance.now() - t0),
  }
}

// ── Timeline (append-only; the audit trail residents can read) ──────────────
export type TimelineSource = 'resident' | '109' | 'official' | 'operator' | 'organization' | 'automated' | 'ai'
/** Where a step came from, so an AI guess is never shown as an official fact. */
export function sourceOf(actor: string): TimelineSource {
  if (actor === 'resident') return 'resident'
  if (actor === 'copilot') return 'ai'
  if (actor === '109') return '109'
  if (actor.startsWith('executor')) return 'organization'
  if (actor.startsWith('operator') || actor.startsWith('admin')) return 'operator'
  if (actor.startsWith('official')) return 'official'
  return 'automated'
}
const channelSource = (channel: string): TimelineSource => (channel === 'APP' ? 'resident' : '109')

async function timeline(sql: Sql, incidentId: string, kind: string, message: string, actor: string, data: Record<string, unknown> = {}, at: Date | null = null, o: { source?: TimelineSource; visibility?: 'public' | 'staff' } = {}) {
  await sql`insert into incident_timeline (incident_id, kind, message, actor, data, created_at, source, visibility)
    values (${incidentId}, ${kind}, ${message}, ${actor}, ${sql.json(data as never)}, coalesce(${at}::timestamptz, clock_timestamp()),
      ${o.source ?? sourceOf(actor)}, ${o.visibility ?? 'public'})`
}

// ── Resident messages: one per follower, in their device's language ────────
type Msg = { title: Record<Lang, string>; body: Record<Lang, string> }
const L = (f: (lang: Lang) => string): Record<Lang, string> => ({ en: f('en'), ru: f('ru'), kk: f('kk') })

/**
 * Everyone who reported or confirmed gets the same meaningful update. Internal
 * operator steps (routing suggestions, checks, notes) never reach residents.
 */
async function notifyFollowers(sql: Sql, incidentId: string, msg: Msg, kind = 'update', data: Record<string, unknown> = {}, at: Date | null = null) {
  await sql`
    insert into incident_messages (incident_id, installation_id, title, body, kind, data, created_at)
    select ${incidentId}, f.installation_id,
      case coalesce(d.language::text, 'ru') when 'en' then ${msg.title.en} when 'kk' then ${msg.title.kk} else ${msg.title.ru} end,
      case coalesce(d.language::text, 'ru') when 'en' then ${msg.body.en} when 'kk' then ${msg.body.kk} else ${msg.body.ru} end,
      ${kind}, ${sql.json(data as never)}, coalesce(${at}::timestamptz, now())
    from (
      select installation_id from incident_signals where incident_id = ${incidentId} and installation_id is not null
      union select installation_id from incident_confirmations where incident_id = ${incidentId} and state = 'confirmed'
    ) f left join device_installations d on d.installation_id = f.installation_id`
}

/** A message to named installations (e.g. everyone whose home is in the scope), once per kind. */
async function notifyInstallations(sql: Sql, incidentId: string, installationIds: string[], msg: Msg, kind: string, at: Date | null = null) {
  if (!installationIds.length) return 0
  const r = await sql`
    insert into incident_messages (incident_id, installation_id, title, body, kind, data, created_at)
    select ${incidentId}, x.iid,
      case coalesce(d.language::text, 'ru') when 'en' then ${msg.title.en} when 'kk' then ${msg.title.kk} else ${msg.title.ru} end,
      case coalesce(d.language::text, 'ru') when 'en' then ${msg.body.en} when 'kk' then ${msg.body.kk} else ${msg.body.ru} end,
      ${kind}, '{}'::jsonb, coalesce(${at}::timestamptz, now())
    from unnest(${installationIds}::text[]) x(iid) left join device_installations d on d.installation_id = x.iid
    where not exists (select 1 from incident_messages m where m.incident_id = ${incidentId} and m.installation_id = x.iid and m.kind = ${kind})`
  return r.count
}

export type SubmitSignal = {
  text: string
  channel: Channel
  installation_id?: string | null
  is_demo?: boolean
  lat?: number | null
  lon?: number | null
  /** Attach to this incident (operator merge of a queued signal). */
  attach_to?: string | null
  /** Create a candidate incident right away (resident app); otherwise the signal waits for an operator. */
  create?: boolean
  actor?: string
  now?: Date
  /** The resident's photo (private to 109) and the anti-spam check it passed (report-check.ts). */
  photo?: ReportPhotoInput | null
  check?: ReportCheck | null
  /** The resident confirmed "send anyway" after the check had doubts. */
  sent_anyway?: boolean
  /** 'staff' when a signed-in operator/admin reports (e.g. a presenter): never counted as a resident. */
  origin?: 'resident' | 'staff'
  /** Report into a live demo session: the session is the location. */
  session_id?: string | null
  /** "The problem came back": open a new incident at the place of this closed one, linked to it. */
  returned_from?: string | null
  /** Title written by staff; residents' own words stay private. */
  public_title?: string | null
}

export async function submitSignal(sql: Sql, s: SubmitSignal) {
  const now = s.now ?? new Date()
  const session = s.session_id ? await sessionById(sql, s.session_id) : null
  if (s.session_id && (!session || session.status !== 'active')) throw new IncidentError('session_closed', 'This demo session is not active.')
  const p = await previewSignal(sql, s.text, { now, lat: s.lat, lon: s.lon, sessionId: session?.id ?? null })
  let previous: Awaited<ReturnType<typeof load>> | null = null
  if (s.returned_from) {
    previous = await load(sql, s.returned_from)
    // The place and the problem are those of the earlier incident, whatever the new words say.
    p.place = { area_id: previous.area_id, area_name: null, building_id: previous.building_id, lat: previous.lat, lon: previous.lon }
    p.intake = { ...p.intake, service: previous.service, kind: previous.problem_kind ?? p.intake.kind, designator: previous.designator, house: previous.house }
    p.scope = inferScope(p.intake, { building_id: previous.building_id, area_id: previous.area_id, has_point: previous.lat != null })
    p.matches = []
  }
  const isDemo = !!session || (s.is_demo ?? false) || (previous?.is_demo ?? false)
  const match = s.attach_to ? p.matches.find((m) => m.id === s.attach_to) : null
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const [sig] = await t<{ id: string }[]>`
      insert into incident_signals (channel, raw_text, lang, intake, match_score, match_reasons, area_id, building_id, point, installation_id, is_demo, created_at,
        photo, check_result, origin, demo_session_id)
      values (${s.channel}, ${s.text.slice(0, 2000)}, ${p.intake.lang}, ${t.json(p.intake as never)}, ${match?.score ?? null}, ${match?.reasons ?? []},
        ${p.place.area_id}, ${p.place.building_id},
        ${p.place.lat != null && p.place.lon != null ? t`ST_SetSRID(ST_MakePoint(${p.place.lon}, ${p.place.lat}), 4326)::geography` : null},
        ${s.installation_id ?? null}, ${isDemo}, ${now},
        ${s.photo ? t.json(storedPhoto(s.photo) as never) : null}, ${s.check ? t.json({ ...s.check, sent_anyway: !!s.sent_anyway } as never) : null},
        ${s.origin ?? 'resident'}, ${session?.id ?? null})
      returning id`
    let incidentId: string | null = null
    if (s.attach_to) {
      incidentId = await attach(t, sig!.id, s.attach_to, s.actor ?? 'resident', now, match?.score ?? null)
    } else if (s.create || s.returned_from) {
      incidentId = await createFromSignal(t, sig!.id, p, {
        is_demo: isDemo, actor: s.actor ?? 'copilot', now, check: s.check ?? null, sent_anyway: !!s.sent_anyway, has_photo: !!s.photo,
        session, previous_id: previous?.id ?? null, public_title: s.public_title ?? null, channel: s.channel,
      })
    }
    return { signal_id: sig!.id, incident_id: incidentId, preview: p }
  })
}

async function attach(sql: Sql, signalId: string, incidentId: string, actor: string, now: Date, score: number | null) {
  const [inc] = await sql<{ id: string; code: string; signal_count: number }[]>`
    update incidents set signal_count = signal_count + 1, last_signal_at = greatest(last_signal_at, ${now}) where id = ${incidentId}
    returning id, code, signal_count`
  if (!inc) throw new IncidentError('not_found', 'Incident not found')
  const [sig] = await sql<{ channel: string; lang: string; building_id: string | null; scope: string | null }[]>`
    update incident_signals set incident_id = ${incidentId}, decision = 'attached' where id = ${signalId} returning channel, lang, building_id, intake->>'scope' scope`
  await timeline(sql, incidentId, 'signal', `Signal #${inc.signal_count} attached · ${sig?.channel ?? ''}${score != null ? ` · match ${Math.round(score * 100)}%` : ''}`, actor,
    { signal_id: signalId, channel: sig?.channel, score, n: inc.signal_count }, now, { source: channelSource(sig?.channel ?? 'APP') })
  // "Only us" is never evidence that another house is affected.
  if (sig?.building_id && sig.scope !== 'household') await growScope(sql, incidentId, sig.building_id, 'report')
  await refreshPriority(sql, incidentId, now)
  return inc.id
}

type CreateOpts = {
  is_demo: boolean; actor: string; now: Date; check?: ReportCheck | null; sent_anyway?: boolean; has_photo?: boolean
  session?: SessionRow | null; previous_id?: string | null; public_title?: string | null; channel?: string
}

async function createFromSignal(sql: Sql, signalId: string, p: SignalPreview, o: CreateOpts) {
  const i = p.intake
  // A doubt from the report check (or "send anyway") puts a human in the loop, like an unclear route does.
  const doubted = !!o.check && (o.sent_anyway || o.check.flags.some((f) => f !== 'ai_unavailable'))
  const previousId = o.previous_id ?? (o.session ? null : await previousAtPlace(sql, i.service, p.place, o.now))
  const [inc] = await sql<{ id: string; code: string }[]>`
    insert into incidents (service, category, title, summary, priority, risk_flags, area_id, building_id, point, location_text,
      responsible_org, responsible_chain, routing_confidence, routing_note, needs_human_review, city_event_id, signal_count, first_signal_at, last_signal_at, is_demo,
      problem_kind, public_title, demo_session_id, previous_incident_id)
    values (${i.service}, ${SERVICE_META[i.service].category}, ${incidentTitle(i.service, 'en', i.kind, i.risk_flags)}, ${null}, ${i.priority}, ${i.risk_flags},
      ${p.place.area_id}, ${p.place.building_id},
      ${p.place.lat != null && p.place.lon != null ? sql`ST_SetSRID(ST_MakePoint(${p.place.lon}, ${p.place.lat}), 4326)::geography` : null}, ${o.session ? o.session.venue : i.location_text},
      ${p.route.org}, ${sql.json(p.route.chain as never)}, ${p.route.confidence}, ${p.route.note}, ${!o.session && (p.route.needs_review || i.risk === 'imminent' || doubted)},
      ${p.official[0]?.id ?? null}, 1, ${i.started_at ? new Date(Math.min(new Date(i.started_at).getTime(), o.now.getTime())) : o.now}, ${o.now}, ${o.is_demo},
      ${i.kind}, ${o.public_title ? o.public_title.slice(0, 120) : null}, ${o.session?.id ?? null}, ${previousId})
    returning id, code`
  const id = inc!.id
  await sql`update incident_signals set incident_id = ${id}, decision = 'created' where id = ${signalId}`
  await applyScope(sql, id, p.scope, p.place, o.session?.id ?? null)
  await timeline(sql, id, 'created', `${inc!.code} opened from the first report · copilot intake ${Math.round(i.confidence * 100)}%`, o.actor,
    { signal_id: signalId, channel: o.channel ?? 'APP' }, o.now, { source: channelSource(o.channel ?? 'APP') })
  await timeline(sql, id, 'routing', `Suggested route: ${p.route.org} (${Math.round(p.route.confidence * 100)}%)${p.route.needs_review ? ' · human review required' : ''}`, 'copilot', { route: p.route }, o.now, { visibility: 'staff' })
  if (p.scope.kind) await timeline(sql, id, 'scope', `Affected area inferred: ${p.scope.kind}${p.scope.radius_m ? ` ${p.scope.radius_m} m` : ''}`, 'system', { scope: p.scope }, o.now, { source: 'automated' })
  if (o.check) {
    const c = o.check
    const ai = c.ai ? `AI (${c.ai.engine}): ${c.ai.verdict}${c.ai.photo !== 'none' ? `, photo ${c.ai.photo}` : ''}` : 'AI check unavailable'
    const msg = `Report check: ${doubted ? 'needs a look' : 'passed'} · ${ai}${c.flags.length ? ` · ${c.flags.join(', ')}` : ''}${o.sent_anyway ? ' · resident sent anyway' : ''}${o.has_photo ? ' · photo attached' : ''}`
    await timeline(sql, id, 'check', msg, 'copilot', { check: c, sent_anyway: !!o.sent_anyway }, o.now, { visibility: 'staff' })
  }
  if (p.official[0]) await timeline(sql, id, 'official', `Linked to an official notice: ${p.official[0].title}`, 'official', { city_event_id: p.official[0].id, title: p.official[0].title, authority: p.official[0].reported_authority }, o.now, { source: 'official' })
  if (previousId) {
    const [prev] = await sql<{ code: string; closed_at: Date | null }[]>`select code, coalesce(verified_at, resolved_at) closed_at from incidents where id = ${previousId}`
    await timeline(sql, id, 'recurrence', `The same problem was fixed here before (${prev?.code})`, 'system', { previous_id: previousId, previous_code: prev?.code, closed_at: prev?.closed_at }, o.now, { source: 'automated' })
  }
  await refreshPriority(sql, id, o.now)
  return id
}

/** Problems in the street: "the same place" is the same spot, whichever house the next resident names. */
const SPOT_SERVICES: IncidentService[] = ['streetlight', 'garbage', 'road', 'yard', 'transport']
export const SAME_SPOT_M = 150

/** A closed incident with the same problem at the same place in the last 60 days: the problem came back. */
async function previousAtPlace(sql: Sql, service: IncidentService, place: Place, now: Date): Promise<string | null> {
  if (!place.building_id && !place.area_id) return null
  const spot = SPOT_SERVICES.includes(service) && place.lat != null && place.lon != null
  const [r] = await sql<{ id: string }[]>`
    select id from incidents
    where service = ${service} and status in ('RESOLVED', 'VERIFIED') and demo_session_id is null and merged_into_id is null
      and coalesce(verified_at, resolved_at) > ${new Date(now.getTime() - 60 * 86400_000)}
      and ${spot ? sql`point is not null and ST_DWithin(point, ST_SetSRID(ST_MakePoint(${place.lon}, ${place.lat}), 4326)::geography, ${SAME_SPOT_M})`
        : place.building_id ? sql`building_id = ${place.building_id}` : sql`area_id = ${place.area_id} and building_id is null`}
    order by coalesce(verified_at, resolved_at) desc limit 1`
  return r?.id ?? null
}

/** Operator decision for a signal waiting in the queue. */
export async function decideSignal(sql: Sql, signalId: string, d: { action: 'attach'; incident_id: string } | { action: 'create' }, actor = 'operator') {
  const [sig] = await sql<{ id: string; raw_text: string; created_at: Date; decision: string; match_score: number | null; is_demo: boolean; channel: string; demo_session_id: string | null }[]>`
    select id, raw_text, created_at, decision, match_score, is_demo, channel, demo_session_id from incident_signals where id = ${signalId}`
  if (!sig) throw new IncidentError('not_found', 'Signal not found')
  if (sig.decision !== 'pending') throw new IncidentError('processed', 'Signal already processed')
  const p = await previewSignal(sql, sig.raw_text, { now: new Date(sig.created_at), sessionId: sig.demo_session_id })
  if (d.action === 'attach') {
    const score = p.matches.find((m) => m.id === d.incident_id)?.score ?? null
    const id = await sql.begin((tx) => attach(tx as unknown as Sql, signalId, d.incident_id, actor, new Date(sig.created_at), score))
    await sql`update incident_signals set match_score = ${score} where id = ${signalId}`
    await audit(sql, actor, 'signal.attach', 'incident_signal', signalId, null, { incident_id: d.incident_id })
    return { incident_id: id }
  }
  const session = sig.demo_session_id ? await sessionById(sql, sig.demo_session_id) : null
  const id = await sql.begin((tx) => createFromSignal(tx as unknown as Sql, signalId, p, { is_demo: sig.is_demo, actor, now: new Date(sig.created_at), session, channel: sig.channel }))
  await audit(sql, actor, 'signal.create', 'incident_signal', signalId, null, { incident_id: id })
  return { incident_id: id }
}

// ── Scope ───────────────────────────────────────────────────────────────────
async function applyScope(sql: Sql, id: string, scope: ScopeProposal, place: Place, sessionId: string | null) {
  await sql`update incidents set scope_kind = ${scope.kind}, scope_radius_m = ${scope.radius_m} where id = ${id}`
  if ((scope.kind === 'building' || scope.kind === 'buildings') && place.building_id && scope.reason !== 'one_household') {
    await sql`insert into incident_buildings (incident_id, building_id, source) values (${id}, ${place.building_id}, 'report') on conflict do nothing`
  }
  if ((scope.kind === 'area' || scope.kind === 'areas') && place.area_id) {
    await sql`insert into incident_areas (incident_id, area_id, coverage) values (${id}, ${place.area_id}, 'FULL') on conflict do nothing`
  }
  void sessionId
  await syncScopeAreas(sql, id)
}

/** Microdistricts the scope touches (PARTIAL): the realtime hint for whose screens may change. */
async function syncScopeAreas(sql: Sql, id: string) {
  await sql`delete from incident_areas where incident_id = ${id} and coverage <> 'FULL'`
  await sql`
    insert into incident_areas (incident_id, area_id, coverage)
    select distinct ${id}::uuid, a.id, 'PARTIAL'::coverage_type from incidents i
      join areas a on a.area_type = 'MICRODISTRICT' and a.geometry is not null
    where i.id = ${id} and (
      (i.scope_kind in ('building', 'buildings') and a.id in (select b.area_id from incident_buildings ib join buildings b on b.id = ib.building_id where ib.incident_id = i.id))
      or (i.scope_kind = 'radius' and i.point is not null and ST_DWithin(a.geometry, i.point, coalesce(i.scope_radius_m, 200)))
      or (i.scope_kind in ('road', 'polygon') and i.scope_geometry is not null and ST_DWithin(a.geometry, i.scope_geometry, coalesce(i.scope_radius_m, 30)))
    )
    on conflict do nothing`
}

/** How far (m) a building-scoped outage reaches from its first report, and from any house already in it. */
export const GROW_FROM_POINT_M = 500
export const GROW_FROM_HOUSE_M = 300

/**
 * A building-scoped outage grows as neighbours report or confirm: a house joins
 * when it is near the first report or next to a house already in the outage,
 * so a large outage spreads house by house instead of stopping at a fixed circle.
 */
async function growScope(sql: Sql, id: string, buildingId: string, source: 'report' | 'confirmation') {
  const [ok] = await sql<{ ok: boolean }[]>`
    select (i.scope_kind in ('building', 'buildings') and i.scope_source = 'inferred'
      and (i.point is null or ST_DWithin(b.point, i.point, ${GROW_FROM_POINT_M})
        or exists (select 1 from incident_buildings ib join buildings x on x.id = ib.building_id where ib.incident_id = i.id and ST_DWithin(x.point, b.point, ${GROW_FROM_HOUSE_M})))) ok
    from incidents i, buildings b where i.id = ${id} and b.id = ${buildingId}`
  if (!ok?.ok) return false
  const r = await sql`insert into incident_buildings (incident_id, building_id, source) values (${id}, ${buildingId}, ${source}) on conflict do nothing`
  if (!r.count) return false
  await sql`update incidents set scope_kind = 'buildings' where id = ${id}`
  await syncScopeAreas(sql, id)
  await suggestNetworkRoute(sql, id)
  return true
}

/**
 * The suggested team follows the evidence: an outage that started as "one flat"
 * (building OSI) but now has reports from several houses is the network's
 * (KZhSA / AUES). Before assignment the suggestion is updated; after it, 109
 * gets a note to re-route (the operator decides).
 */
async function suggestNetworkRoute(sql: Sql, id: string) {
  const [inc] = await sql<{ service: IncidentService; status: string; responsible_org: string | null; problem_kind: Intake['kind'] | null; risk_flags: string[]; houses: number; routed: boolean }[]>`
    select i.service, i.status, i.responsible_org, i.problem_kind, i.risk_flags, i.routed_at is not null routed,
      (select count(*)::int from incident_buildings ib where ib.incident_id = i.id) houses
    from incidents i where i.id = ${id} and i.demo_session_id is null`
  if (!inc || inc.houses < 2 || !['water', 'sewer', 'hot_water', 'heating', 'electricity'].includes(inc.service)) return
  const next = runRoute({ service: inc.service, scope: 'multiple', risk: 'none', risk_flags: inc.risk_flags, designator: null, house: null, kind: inc.problem_kind ?? 'outage' })
  if (next.org === inc.responsible_org) return
  if (inc.status === 'NEW' && !inc.routed) {
    await sql`update incidents set responsible_org = ${next.org}, responsible_chain = ${sql.json(next.chain as never)}, routing_confidence = ${next.confidence},
      routing_note = ${next.note}, needs_human_review = ${next.needs_review} where id = ${id}`
    await timeline(sql, id, 'routing', `Suggested route updated: ${next.org} (reports from ${inc.houses} houses)`, 'copilot', { route: next, houses: inc.houses }, null, { visibility: 'staff' })
  } else if (!['RESOLVED', 'VERIFIED', 'REJECTED', 'EVIDENCE_SUBMITTED'].includes(inc.status)) {
    const [seen] = await sql<{ n: number }[]>`select count(*)::int n from incident_timeline where incident_id = ${id} and kind = 'reroute_hint' and data->>'org' = ${next.org}`
    if (!seen!.n) await timeline(sql, id, 'reroute_hint', `Reports now come from ${inc.houses} houses: this looks like the network (${next.org}). Re-route?`, 'copilot', { org: next.org, houses: inc.houses }, null, { visibility: 'staff' })
  }
}

export type ScopeInput = {
  kind: ScopeKind; radius_m?: number | null; building_ids?: string[]; area_ids?: string[]
  /** House numbers in the incident's microdistrict ("37", "38", "40А"), resolved here. */
  houses?: string[]
  /** Microdistrict designators ("14", "15"), resolved here. */
  designators?: string[]
}

/** Operator sets who is affected. Replaces the inferred scope; kept in the timeline. */
export async function setScope(sql: Sql, id: string, s: ScopeInput, actor: string, now = new Date()) {
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const inc = await load(t, id)
    if (inc.demo_session_id && s.kind !== 'demo_session') throw new IncidentError('session_scope', 'A demo-session incident stays in its session.')
    const radius = s.kind === 'radius' || s.kind === 'road' || s.kind === 'polygon' ? Math.min(20000, Math.max(10, Math.round(s.radius_m ?? 150))) : null
    if (s.kind === 'radius' && inc.lat == null) throw new IncidentError('no_point', 'The incident has no location to draw a radius around.')
    const buildingIds = [...(s.building_ids ?? [])]
    if (s.houses?.length && inc.area_id) {
      const norm = s.houses.map((h) => normalizeHouseNumber(h)).filter(Boolean)
      const found = await t<{ id: string; house_number_norm: string }[]>`select id, house_number_norm from buildings where area_id = ${inc.area_id} and house_number_norm = any(${norm}::text[])`
      const missing = norm.filter((h) => !found.some((f) => f.house_number_norm === h))
      if (missing.length) throw new IncidentError('unknown_house', `No such house in this microdistrict: ${missing.join(', ')}`)
      buildingIds.push(...found.map((f) => f.id))
    }
    const areaIds = [...(s.area_ids ?? [])]
    if (s.designators?.length) {
      const found = await t<{ id: string; designator: string }[]>`select id, designator from areas where area_type = 'MICRODISTRICT' and upper(designator) = any(${s.designators.map((x) => x.trim().toUpperCase())}::text[])`
      if (found.length < s.designators.length) throw new IncidentError('unknown_area', 'Unknown microdistrict.')
      areaIds.push(...found.map((f) => f.id))
    }
    if ((s.kind === 'building' || s.kind === 'buildings') && !buildingIds.length) throw new IncidentError('no_buildings', 'Name at least one house.')
    if ((s.kind === 'area' || s.kind === 'areas') && !areaIds.length && inc.area_id) areaIds.push(inc.area_id)
    await t`update incidents set scope_kind = ${s.kind}, scope_radius_m = ${radius}, scope_source = 'operator' where id = ${id}`
    await t`delete from incident_buildings where incident_id = ${id}`
    await t`delete from incident_areas where incident_id = ${id}`
    if (buildingIds.length) await t`insert into incident_buildings (incident_id, building_id, source) select ${id}, unnest(${buildingIds}::uuid[]), 'operator' on conflict do nothing`
    if ((s.kind === 'area' || s.kind === 'areas') && areaIds.length) await t`insert into incident_areas (incident_id, area_id, coverage) select ${id}, unnest(${areaIds}::uuid[]), 'FULL' on conflict do nothing`
    await syncScopeAreas(t, id)
    const summary = await scopeSummary(t, id)
    await timeline(t, id, 'scope', `Affected area set by the operator: ${summary.text_en}`, actor, { kind: s.kind, radius_m: radius, buildings: summary.houses, areas: summary.areas }, now, { source: 'operator' })
    await refreshPriority(t, id, now)
    await audit(t, actor, 'incident.scope', 'incident', id, null, s)
    return summary
  })
}

async function scopeSummary(sql: Sql, id: string) {
  const [r] = await sql<{ kind: ScopeKind | null; radius_m: number | null; houses: string[]; areas: string[] }[]>`
    select i.scope_kind kind, i.scope_radius_m radius_m,
      coalesce((select array_agg(b.house_number order by b.house_number_norm) from incident_buildings ib join buildings b on b.id = ib.building_id where ib.incident_id = i.id), '{}') houses,
      coalesce((select array_agg(coalesce(a.designator, a.name)) from incident_areas ia join areas a on a.id = ia.area_id where ia.incident_id = i.id and ia.coverage = 'FULL'), '{}') areas
    from incidents i where i.id = ${id}`
  const s = r!
  const text_en = s.kind === 'radius' ? `${s.radius_m} m radius` : s.kind === 'city' ? 'the whole city' : s.kind === 'area' || s.kind === 'areas' ? `microdistrict ${s.areas.join(', ')}`
    : s.kind === 'building' || s.kind === 'buildings' ? `houses ${s.houses.join(', ')}` : s.kind ?? 'not set'
  return { ...s, text_en }
}

// ── Priority (recomputed on every change; explained in plain words) ─────────
export async function refreshPriority(sql: Sql, id: string, now = new Date()) {
  const [r] = await sql<{
    priority_score: number | null; priority_reasons: PriorityReason[]
    service: IncidentService; problem_kind: Intake['kind'] | null; risk_flags: string[]; scope_kind: ScopeKind | null; priority: PriorityLevel; priority_source: string
    first_signal_at: Date; previous_incident_id: string | null; city_event_id: string | null; confirm_count: number; risk: Intake['risk']; flags: string[] | null
    floor: PriorityLevel | null; resident_signals: number; buildings: number; areas_full: number; sensitive: string[]
  }[]>`
    select i.priority_score, i.priority_reasons, i.service, i.problem_kind, i.risk_flags, i.scope_kind, i.priority, i.priority_source, i.first_signal_at, i.previous_incident_id, i.city_event_id, i.confirm_count,
      coalesce((select case when bool_or(s.intake->>'risk' = 'imminent') then 'imminent' when bool_or(s.intake->>'risk' = 'elevated') then 'elevated' else 'none' end
        from incident_signals s where s.incident_id = i.id), 'none') risk,
      (select array_agg(distinct f) from incident_signals s, jsonb_array_elements_text(s.intake->'risk_flags') f where s.incident_id = i.id) flags,
      (select s.intake->>'priority' from incident_signals s where s.incident_id = i.id order by s.created_at limit 1) floor,
      (select count(*)::int from incident_signals s where s.incident_id = i.id and s.origin = 'resident') resident_signals,
      case when i.scope_kind in ('building', 'buildings') then (select count(*)::int from incident_buildings ib where ib.incident_id = i.id)
           when i.scope_kind = 'radius' and i.point is not null then (select count(*)::int from buildings b where ST_DWithin(b.point, i.point, coalesce(i.scope_radius_m, 200)))
           else 0 end buildings,
      (select count(*)::int from incident_areas ia where ia.incident_id = i.id and ia.coverage = 'FULL') areas_full,
      case when i.point is null or i.demo_session_id is not null then '{}'::text[] else array(
        select distinct case when p.category = 'school' then 'school' when p.category = 'hospital' then 'hospital' else 'kindergarten' end
        from places p where ST_DWithin(p.point, i.point, 150)
          and (p.category in ('school', 'hospital') or (p.category = 'education' and p.name ~* '(детск|детсад|ясли|балабақша|kindergarten)'))) end sensitive
    from incidents i where i.id = ${id}`
  if (!r) return null
  const pr = assessPriority({
    service: r.service, kind: r.problem_kind, risk: r.risk, risk_flags: [...new Set([...r.risk_flags, ...(r.flags ?? [])])], scope_kind: r.scope_kind,
    buildings: r.buildings, areas_full: r.areas_full, residents: r.resident_signals + r.confirm_count, first_signal_at: new Date(r.first_signal_at).toISOString(),
    recurring: !!r.previous_incident_id, sensitive: r.sensitive, official: !!r.city_event_id, floor: r.floor, now,
  })
  // An operator's decision stands; the reasons still update.
  const level = r.priority_source === 'operator' ? r.priority : pr.level
  const reasons: PriorityReason[] = r.priority_source === 'operator' ? [{ key: 'operator' }, ...pr.reasons] : pr.reasons
  // jsonb reorders object keys, so compare reasons by value.
  const same = (a: PriorityReason[]) => a.map((x) => `${x.key}:${x.n ?? ''}`).join('|')
  if (level === r.priority && pr.score === r.priority_score && same(reasons) === same(r.priority_reasons ?? [])) return { level, score: pr.score, reasons }
  await sql`update incidents set priority = ${level}, priority_score = ${pr.score}, priority_reasons = ${sql.json(reasons as never)} where id = ${id}`
  if (level !== r.priority) {
    await timeline(sql, id, 'priority', `Priority ${r.priority} → ${level}`, 'system', { from: r.priority, to: level, reasons }, now, { source: 'automated' })
  }
  return { level, score: pr.score, reasons }
}

// ── Confirmations: "Yes, I also experience this" ────────────────────────────
export type ConfirmInput = {
  installation_id: string
  account_id?: string | null
  state: 'confirmed' | 'not_affected' | 'withdrawn'
  note?: string | null
  photo?: ReportPhotoInput | null
  lat?: number | null
  lon?: number | null
  now?: Date
}
const MILESTONES = [1, 3, 5, 10, 25, 50, 100, 250, 500, 1000]

/**
 * One confirmation per person per incident: a real record (who, when, where
 * they stood, an optional note or photo), not a like. Reporters are already
 * counted and cannot confirm their own report again.
 */
export async function confirmIncident(sql: Sql, idOrCode: string, c: ConfirmInput) {
  const now = c.now ?? new Date()
  const id = await incidentId(sql, idOrCode)
  const home = await resolveLocation(sql, { installation_id: c.installation_id }, 'en')
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const inc = await load(t, id)
    if (inc.merged_into_id) throw new IncidentError('merged', 'This incident was merged into another one.')
    if (inc.status === 'REJECTED') throw new IncidentError('closed', 'This incident is closed.')
    if (c.state === 'confirmed' && ['RESOLVED', 'VERIFIED'].includes(inc.status)) throw new IncidentError('resolved', 'This problem is marked as fixed. If it is back, report that it returned.')
    const [reporter] = await t<{ n: number }[]>`select count(*)::int n from incident_signals where incident_id = ${id} and installation_id = ${c.installation_id}`
    if (reporter!.n > 0) throw new IncidentError('already_reported', 'You reported this problem: you are already counted.')
    const [member] = inc.demo_session_id
      ? await t<{ n: number }[]>`select count(*)::int n from demo_session_members where session_id = ${inc.demo_session_id} and installation_id = ${c.installation_id}`
      : [{ n: 0 }]
    // Where the person stands relative to the scope, recorded with the answer.
    const facts = await scopeFacts(t, id, { building_id: home.building_id, point: c.lat != null && c.lon != null ? { lat: c.lat, lon: c.lon } : home.point })
    const affects = incidentAffects(facts, { building_id: home.building_id, area_ids: home.area_ids, session_ids: member!.n ? [inc.demo_session_id!] : [] })
    const context = member!.n ? 'session' : c.lat != null ? (affects.relevance === 'DIRECT' ? 'here' : 'elsewhere')
      : home.ctx.kind === 'city' ? 'unknown' : affects.relevance === 'DIRECT' ? 'home_in_scope' : affects.relevance === 'NEARBY' ? 'home_nearby' : 'elsewhere'
    const [prev] = await t<{ state: string }[]>`select state from incident_confirmations where incident_id = ${id} and installation_id = ${c.installation_id}`
    await t`
      insert into incident_confirmations (incident_id, installation_id, account_id, state, context, distance_m, building_id, note, photo, demo_session_id, is_demo, created_at, updated_at)
      values (${id}, ${c.installation_id}, ${c.account_id ?? null}, ${c.state}, ${context}, ${facts.distance_m != null ? Math.round(facts.distance_m) : null}, ${home.building_id},
        ${c.note?.trim().slice(0, 1000) || null}, ${c.photo ? t.json(storedPhoto(c.photo) as never) : null}, ${inc.demo_session_id}, ${inc.is_demo}, ${now}, ${now})
      on conflict (incident_id, installation_id) do update set state = excluded.state, context = excluded.context, distance_m = excluded.distance_m,
        building_id = excluded.building_id, account_id = coalesce(excluded.account_id, incident_confirmations.account_id),
        note = coalesce(excluded.note, incident_confirmations.note), photo = coalesce(excluded.photo, incident_confirmations.photo), updated_at = excluded.updated_at`
    const changed = prev?.state !== c.state
    const [cnt] = await t<{ n: number }[]>`select count(*)::int n from incident_confirmations where incident_id = ${id} and state = 'confirmed'`
    const n = cnt!.n
    await t`update incidents set confirm_count = ${n}${c.state === 'confirmed' && changed ? t`, last_signal_at = greatest(last_signal_at, ${now})` : t``} where id = ${id}`
    if (c.state === 'confirmed' && changed) {
      if (MILESTONES.includes(n)) await timeline(t, id, 'confirmed', `${n} resident${n === 1 ? '' : 's'} confirmed the problem`, 'resident', { n }, now, { source: 'resident' })
      if (home.building_id && context === 'home_in_scope') await growScope(t, id, home.building_id, 'confirmation')
      else if (home.building_id && context === 'home_nearby' && ['water', 'hot_water', 'electricity', 'heating'].includes(inc.service) && inc.problem_kind === 'outage') await growScope(t, id, home.building_id, 'confirmation')
    }
    if (changed) await refreshPriority(t, id, now)
    return { incident_id: id, code: inc.code, state: c.state, confirm_count: n, changed, context }
  })
}

// ── Scope facts & audience ──────────────────────────────────────────────────
async function scopeFacts(sql: Sql, id: string, where: { building_id: string | null; point: { lat: number; lon: number } | null }) {
  const pt = where.point ? sql`ST_SetSRID(ST_MakePoint(${where.point.lon}, ${where.point.lat}), 4326)::geography` : sql`null::geography`
  const [r] = await sql<{ kind: ScopeKind | null; radius_m: number | null; building_ids: string[]; area_ids_full: string[]; session_id: string | null; distance_m: number | null }[]>`
    select i.scope_kind kind, i.scope_radius_m radius_m, i.demo_session_id session_id,
      coalesce((select array_agg(building_id) from incident_buildings where incident_id = i.id), '{}') building_ids,
      coalesce((select array_agg(area_id) from incident_areas where incident_id = i.id and coverage = 'FULL'), '{}') area_ids_full,
      case when ${pt} is null then null
        when i.scope_kind in ('road', 'polygon') and i.scope_geometry is not null then ST_Distance(i.scope_geometry, ${pt})
        when i.point is not null then ST_Distance(i.point, ${pt}) end distance_m
    from incidents i where i.id = ${id}`
  return r!
}

export type NearbyItem = Awaited<ReturnType<typeof nearbyFor>>['items'][number]

/**
 * Incidents that concern one person (an installation): inside the scope of
 * their saved home (DIRECT), close to it (NEARBY), in a demo session they
 * joined, or ones they reported / confirmed (FOLLOWING). The server decides;
 * the realtime hint only tells the client when to ask again.
 */
export async function nearbyFor(sql: Sql, installationId: string | null, o: { lang?: Lang; now?: Date; sessionId?: string | null } = {}) {
  const lang = o.lang ?? 'ru'
  const now = o.now ?? new Date()
  const home = installationId ? await resolveLocation(sql, { installation_id: installationId }, lang) : null
  const hasHome = !!home && home.ctx.kind !== 'city'
  const sessions = installationId
    ? (await sql<{ session_id: string }[]>`select m.session_id from demo_session_members m join demo_sessions s on s.id = m.session_id
        where m.installation_id = ${installationId} and s.status = 'active' ${o.sessionId ? sql`and s.id = ${o.sessionId}` : sql``}`).map((r) => r.session_id)
    : []
  const pt = hasHome && home!.point ? sql`ST_SetSRID(ST_MakePoint(${home!.point.lon}, ${home!.point.lat}), 4326)::geography` : sql`null::geography`
  const areaIds = hasHome ? home!.area_ids : []
  const rows = await sql<(Row & { relation: string | null; my_answer: string | null; distance_m: number | null; building_ids: string[]; area_ids_full: string[] })[]>`
    select ${cols(sql)},
      case when exists (select 1 from incident_signals s where s.incident_id = i.id and s.installation_id = ${installationId} and s.origin = 'resident') then 'reporter'
        when exists (select 1 from incident_signals s where s.incident_id = i.id and s.installation_id = ${installationId}) then 'staff_reporter'
        else (select c.state from incident_confirmations c where c.incident_id = i.id and c.installation_id = ${installationId}) end relation,
      (select v.answer from incident_verifications v where v.incident_id = i.id and v.installation_id = ${installationId} and v.round = i.verify_round) my_answer,
      case when ${pt} is null then null
        when i.scope_kind in ('road', 'polygon') and i.scope_geometry is not null then ST_Distance(i.scope_geometry, ${pt})
        when i.point is not null then ST_Distance(i.point, ${pt}) end distance_m,
      coalesce((select array_agg(building_id) from incident_buildings where incident_id = i.id), '{}') building_ids,
      coalesce((select array_agg(area_id) from incident_areas where incident_id = i.id and coverage = 'FULL'), '{}') area_ids_full
    from incidents i left join areas a on a.id = i.area_id left join buildings b on b.id = i.building_id
    where i.status <> 'REJECTED' and i.merged_into_id is null
      and (i.status not in ('RESOLVED', 'VERIFIED') or coalesce(i.verified_at, i.resolved_at, i.updated_at) > ${new Date(now.getTime() - 24 * 3600_000)})
      and (
        (i.demo_session_id is not null and i.demo_session_id = any(${sessions}::uuid[]))
        or (i.demo_session_id is null and (
          i.scope_kind = 'city'
          or exists (select 1 from incident_areas ia where ia.incident_id = i.id and ia.area_id = any(${areaIds}::uuid[]))
          or (${pt} is not null and i.point is not null and ST_DWithin(i.point, ${pt}, 1000))
          or exists (select 1 from incident_signals s where s.incident_id = i.id and s.installation_id = ${installationId})
          or exists (select 1 from incident_confirmations c where c.incident_id = i.id and c.installation_id = ${installationId} and c.state = 'confirmed')
        ))
      )
    order by i.last_signal_at desc limit 40`
  const items = rows.map(({ relation, my_answer, distance_m, building_ids, area_ids_full, ...r }) => {
    const scoped = incidentAffects(
      { kind: r.scope_kind, radius_m: r.scope_radius_m, building_ids, area_ids_full, session_id: r.demo_session_id, distance_m },
      { building_id: home?.building_id ?? null, area_ids: areaIds, session_ids: sessions },
    )
    // A report the copilot could not classify is not put to the neighbours until 109 has looked at it.
    const affects = scoped.relevance === 'DIRECT' && r.service === 'other' && r.status === 'NEW' && !r.demo_session_id ? { relevance: 'NEARBY' as const, reason: 'unclassified' } : scoped
    const relevance = affects.relevance !== 'NO' ? affects.relevance : relation === 'reporter' || relation === 'confirmed' || relation === 'staff_reporter' ? 'FOLLOWING' : 'NO'
    const eligible = relation === 'reporter' || relation === 'confirmed'
    const verifying = ['EVIDENCE_SUBMITTED', 'RESOLVED', 'VERIFIED'].includes(r.status) && r.verify_round > 0
    return {
      ...lite(project(r, now)), relation: relation as 'reporter' | 'staff_reporter' | 'confirmed' | 'not_affected' | 'withdrawn' | null, my_answer,
      relevance: relevance as 'DIRECT' | 'NEARBY' | 'FOLLOWING' | 'NO', reason: affects.reason, distance_m: distance_m != null ? Math.round(distance_m) : null,
      // What this person is asked, if anything.
      ask: verifying && eligible && !my_answer && r.status !== 'VERIFIED' ? 'verify' as const
        : affects.relevance === 'DIRECT' && !relation && ['NEW', 'ROUTED', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED'].includes(r.status) ? 'confirm' as const : null,
    }
  }).filter((x) => x.relevance !== 'NO')
  const rank = (x: (typeof items)[number]) => (x.ask === 'verify' ? 0 : x.priority === 'CRITICAL' && x.relevance === 'DIRECT' ? 1 : x.ask === 'confirm' ? 2 : x.relevance === 'DIRECT' ? 3 : x.relevance === 'FOLLOWING' ? 4 : 5)
  items.sort((a, b) => rank(a) - rank(b) || b.last_signal_at.localeCompare(a.last_signal_at))
  return { has_home: hasHome, home: hasHome ? { area: home!.ctx.area, building: home!.ctx.building } : null, sessions, items, generated_at: now.toISOString() }
}

/** Residents in the scope of an incident (installations with a saved home inside it). */
async function audienceOf(sql: Sql, id: string, limit = 500): Promise<string[]> {
  const rows = await sql<{ installation_id: string }[]>`
    select distinct d.installation_id from incidents i
      join saved_locations sl on true
      join device_installations d on d.id = sl.installation_id
      left join buildings b on b.id = sl.building_id
    where i.id = ${id} and i.demo_session_id is null and (
      i.scope_kind = 'city'
      or (i.scope_kind in ('building', 'buildings') and sl.building_id in (select building_id from incident_buildings where incident_id = i.id))
      or (i.scope_kind in ('area', 'areas') and coalesce(b.area_id, sl.area_id) in (select area_id from incident_areas where incident_id = i.id and coverage = 'FULL'))
      or (i.scope_kind = 'radius' and i.point is not null and ST_DWithin(coalesce(sl.point, b.point), i.point, coalesce(i.scope_radius_m, 200)))
      or (i.scope_kind in ('road', 'polygon') and i.scope_geometry is not null and ST_DWithin(coalesce(sl.point, b.point), i.scope_geometry, coalesce(i.scope_radius_m, 30)))
    ) limit ${limit}`
  return rows.map((r) => r.installation_id)
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export type IncidentAction =
  | { action: 'route'; org?: string; team?: string | null }
  | { action: 'accept' }
  | { action: 'commit'; finish_at: string; start_at?: string | null; reason?: string | null }
  | { action: 'reject'; reason: string }
  | { action: 'dispatch'; message?: string }
  | { action: 'update'; message: string }
  | { action: 'evidence'; photos: EvidencePhoto[] }
  | { action: 'complete'; note: string; photos?: EvidencePhoto[]; cause?: string | null; completed_at?: string | null }
  | { action: 'respond'; text: string }
  | { action: 'resolve'; force?: boolean; reason?: string | null }
  | { action: 'close_rejected'; reason: string }
  | { action: 'request_evidence'; note?: string | null }
  | { action: 'escalate'; reason: string }
  | { action: 'reopen'; reason: string }
  | { action: 'merge'; into: string }
  | { action: 'scope'; scope: ScopeInput }
  | { action: 'title'; title: string }

const MSG = {
  assigned: (code: string, who: string): Msg => ({
    title: L((l) => ({ en: 'A responsible team is assigned', ru: 'Исполнитель назначен', kk: 'Орындаушы тағайындалды' })[l]),
    body: L((l) => ({ en: `${code}: ${who} is responsible. You will see when they accept it and commit to a deadline.`, ru: `${code}: ответственный — ${who}. Вы увидите, когда исполнитель примет работу и назовёт срок.`, kk: `${code}: жауапты — ${who}. Орындаушы жұмысты қабылдап, мерзімін атағанда көресіз.` })[l]),
  }),
  accepted: (who: string, start: string | null, finish: string, now: Date): Msg => ({
    title: L((l) => ({ en: 'Work accepted by the team', ru: 'Работа принята исполнителем', kk: 'Жұмысты орындаушы қабылдады' })[l]),
    body: L((l) => {
      const f = etaWords(l, finish, now)
      const s = start ? etaWords(l, start, now) : null
      const eta = f.rel ? `${f.rel} (${f.when})` : f.when
      return { en: `${who}. ${s ? `Start: ${s.when}. ` : ''}Expected: ${eta}.`, ru: `${who}. ${s ? `Начало: ${s.when}. ` : ''}Ожидаемое решение: ${eta}.`, kk: `${who}. ${s ? `Басталуы: ${s.when}. ` : ''}Күтілетін шешім: ${eta}.` }[l]
    }),
  }),
  deadline: (from: string, to: string, reason: string, now: Date): Msg => ({
    title: L((l) => ({ en: 'Deadline changed', ru: 'Срок изменён', kk: 'Мерзім өзгерді' })[l]),
    body: L((l) => ({ en: `${etaWords(l, from, now).when} → ${etaWords(l, to, now).when}. Reason: ${reason}`, ru: `${etaWords(l, from, now).when} → ${etaWords(l, to, now).when}. Причина: ${reason}`, kk: `${etaWords(l, from, now).when} → ${etaWords(l, to, now).when}. Себебі: ${reason}` })[l]),
  }),
  started: (who: string, finish: string | null, now: Date): Msg => ({
    title: L((l) => ({ en: 'Work has started', ru: 'Работы начались', kk: 'Жұмыс басталды' })[l]),
    body: L((l) => {
      const f = finish ? etaWords(l, finish, now) : null
      return { en: `${who} started the work.${f ? ` Expected: ${f.rel ?? f.when}.` : ''}`, ru: `${who} приступили к работе.${f ? ` Ожидаемое решение: ${f.rel ?? f.when}.` : ''}`, kk: `${who} жұмысқа кірісті.${f ? ` Күтілетін шешім: ${f.rel ?? f.when}.` : ''}` }[l]
    }),
  }),
  completed: (): Msg => ({
    title: L((l) => ({ en: 'The team reports it is fixed', ru: 'Исполнитель сообщил, что проблема решена', kk: 'Орындаушы мәселе шешілді деді' })[l]),
    body: L((l) => ({ en: 'You experienced this problem. Is it really fixed? Open to answer: yes, partly or no.', ru: 'Вы сталкивались с этой проблемой. Она действительно решена? Откройте, чтобы ответить: да, частично или нет.', kk: 'Сіз бұл мәселеге тап болдыңыз. Шынымен шешілді ме? Жауап беру үшін ашыңыз.' })[l]),
  }),
  verified: (pct: number, yes: number, n: number): Msg => ({
    title: L((l) => ({ en: 'Resolved: residents confirmed it', ru: 'Решено: жители подтвердили', kk: 'Шешілді: тұрғындар растады' })[l]),
    body: L((l) => ({ en: `${pct}% of those who answered confirmed it is fixed (${yes} of ${n}).`, ru: `${pct}% ответивших подтвердили устранение (${yes} из ${n}).`, kk: `Жауап бергендердің ${pct}% шешілгенін растады (${n}-нан ${yes}).` })[l]),
  }),
  reopened: (no: number, n: number): Msg => ({
    title: L((l) => ({ en: 'The problem is reopened', ru: 'Проблема снова открыта', kk: 'Мәселе қайта ашылды' })[l]),
    body: L((l) => ({ en: `After residents checked: ${no} of ${n} say it is not fixed. Returned to the team.`, ru: `После проверки жителей: ${no} из ${n} сообщили, что проблема не устранена. Возвращено исполнителю.`, kk: `Тұрғындар тексергеннен кейін: ${n}-нан ${no} шешілмеді дейді. Орындаушыға қайтарылды.` })[l]),
  }),
  reopenedBy109: (reason: string): Msg => ({
    title: L((l) => ({ en: 'The problem is reopened', ru: 'Проблема снова открыта', kk: 'Мәселе қайта ашылды' })[l]),
    body: L((l) => ({ en: `109: ${reason}`, ru: `109: ${reason}`, kk: `109: ${reason}` })[l]),
  }),
  closed: (code: string, reason: string | null): Msg => ({
    title: L((l) => ({ en: `${code}: closed by 109`, ru: `${code}: закрыто оператором 109`, kk: `${code}: 109 жапты` })[l]),
    body: L((l) => reason || { en: 'Is it actually fixed? You can still answer.', ru: 'Действительно исправлено? Вы всё ещё можете ответить.', kk: 'Шынымен түзелді ме? Әлі де жауап бере аласыз.' }[l]),
  }),
  rejected: (reason: string): Msg => ({
    title: L((l) => ({ en: 'The request is closed', ru: 'Обращение закрыто', kk: 'Өтініш жабылды' })[l]),
    body: L(() => reason),
  }),
  merged: (code: string): Msg => ({
    title: L((l) => ({ en: 'Merged with the same problem', ru: 'Объединено с той же проблемой', kk: 'Сол мәселемен біріктірілді' })[l]),
    body: L((l) => ({ en: `Your report now counts toward ${code}; every update comes from there.`, ru: `Ваше обращение теперь учитывается в ${code}: все обновления придут оттуда.`, kk: `Өтінішіңіз енді ${code} ішінде есептеледі.` })[l]),
  }),
  update: (code: string, message: string): Msg => ({
    title: L((l) => ({ en: `Update from 109 · ${code}`, ru: `Обновление от 109 · ${code}`, kk: `109 жаңалығы · ${code}` })[l]),
    body: L(() => message),
  }),
  warning: (title: (l: Lang) => string, place: string): Msg => ({
    title: L((l) => ({ en: 'Important warning', ru: 'Важное предупреждение', kk: 'Маңызды ескерту' })[l]),
    body: L((l) => ({ en: `${title(l)} near your home${place ? ` (${place})` : ''}. Confirmed by 109.`, ru: `${title(l)} рядом с вашим домом${place ? ` (${place})` : ''}. Подтверждено 109.`, kk: `${title(l)} үйіңіздің жанында${place ? ` (${place})` : ''}. 109 растады.` })[l]),
  }),
}

async function incidentId(sql: Sql, idOrCode: string): Promise<string> {
  if (/^INC-\d+$/i.test(idOrCode)) {
    const [r] = await sql<{ id: string }[]>`select id from incidents where code = ${idOrCode.toUpperCase()}`
    if (!r) throw new IncidentError('not_found', 'Incident not found')
    return r.id
  }
  if (!/^[0-9a-f-]{36}$/i.test(idOrCode)) throw new IncidentError('not_found', 'Incident not found')
  return idOrCode
}

async function load(sql: Sql, id: string) {
  const [r] = await sql<{
    id: string; code: string; status: string; priority: PriorityLevel; responsible_org: string | null; team: string | null; service: IncidentService; first_signal_at: Date
    lat: number | null; lon: number | null; designator: string | null; house: string | null; area_id: string | null; building_id: string | null; evidence: EvidencePhoto[]
    response_check: { verdict: string } | null; lang: Lang | null; is_demo: boolean; problem_kind: Intake['kind'] | null; risk_flags: string[]; public_title: string | null
    demo_session_id: string | null; merged_into_id: string | null; accepted_at: Date | null; commit_start_at: Date | null; commit_finish_at: Date | null
    verify_round: number; routed_at: Date | null; completed_at: Date | null
  }[]>`
    select i.id, i.code, i.status, i.priority, i.responsible_org, i.team, i.service, i.first_signal_at, ST_Y(i.point::geometry) lat, ST_X(i.point::geometry) lon,
      a.designator, b.house_number house, i.area_id, i.building_id, i.evidence, i.response_check,
      (select lang from incident_signals s where s.incident_id = i.id order by created_at limit 1) lang, i.is_demo, i.problem_kind, i.risk_flags, i.public_title,
      i.demo_session_id, i.merged_into_id, i.accepted_at, i.commit_start_at, i.commit_finish_at, i.verify_round, i.routed_at, i.completed_at
    from incidents i left join areas a on a.id = i.area_id left join buildings b on b.id = i.building_id where i.id = ${id}`
  if (!r) throw new IncidentError('not_found', 'Incident not found')
  return r
}

const who = (inc: { team: string | null; responsible_org: string | null }) => (inc.team && inc.responsible_org && inc.team !== inc.responsible_org ? `${inc.team} (${inc.responsible_org})` : inc.team ?? inc.responsible_org ?? 'executor')
const isOpen = (status: string) => !['RESOLVED', 'VERIFIED', 'REJECTED'].includes(status)

/**
 * Every operator / team step. `actor` is the signed-in staff member; steps
 * taken on behalf of the responsible team are recorded as the team's, with
 * the staff member kept in the data (transparent, never impersonated).
 */
export async function incidentAction(sql: Sql, idOrCode: string, a: IncidentAction, actor = 'operator', now = new Date()) {
  const id = await incidentId(sql, idOrCode)
  if (a.action === 'scope') return { scope: await setScope(sql, id, a.scope, actor, now) }
  if (a.action === 'merge') return mergeIncident(sql, id, a.into, actor, now)
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const inc = await load(t, id)
    if (inc.merged_into_id) throw new IncidentError('merged', 'This incident was merged into another one.')
    const org = inc.responsible_org ?? 'executor'
    const team = `executor:${inc.team ?? org}`
    const by = { by: actor }
    let result: Record<string, unknown> = {}
    switch (a.action) {
      case 'route': {
        const target = a.org ?? org
        const teamName = a.team?.trim() || (inc.demo_session_id ? DEMO_TEAM : null)
        await t`update incidents set status = case when status in ('NEW', 'REJECTED') then 'ROUTED'::incident_status else status end, responsible_org = ${target}, team = ${teamName},
          routed_at = coalesce(routed_at, ${now}), assigned_at = ${now},
          accept_due_at = coalesce(accept_due_at, ${new Date(now.getTime() + ACCEPT_MINUTES * 60000)}),
          resolve_due_at = coalesce(resolve_due_at, ${new Date(now.getTime() + RESOLVE_HOURS[inc.priority] * 3600_000)}),
          needs_human_review = false where id = ${id}`
        const w = who({ team: teamName, responsible_org: target })
        await timeline(t, id, 'routed', `109 assigned ${w}`, actor, { org: target, team: teamName, ...by }, now, { source: 'operator' })
        await notifyFollowers(t, id, MSG.assigned(inc.code, w), 'assigned', { org: target, team: teamName }, now)
        if (inc.priority === 'CRITICAL' && !inc.routed_at && !inc.demo_session_id) {
          // A confirmed danger is announced to everyone whose home is in the scope.
          const place = [inc.designator, inc.house].filter(Boolean).join('/')
          const warn = MSG.warning((l) => incidentTitle(inc.service, l, inc.problem_kind, inc.risk_flags), place)
          result = { warned: await notifyInstallations(t, id, await audienceOf(t, id), warn, 'warning', now) }
        }
        break
      }
      case 'accept':
        await t`update incidents set status = case when status = 'ROUTED' then 'ACCEPTED'::incident_status else status end, accepted_at = coalesce(accepted_at, ${now}) where id = ${id}`
        await timeline(t, id, 'accepted', `${who(inc)} accepted the request`, team, by, now)
        break
      case 'commit': {
        const finish = new Date(a.finish_at)
        const start = a.start_at ? new Date(a.start_at) : null
        if (Number.isNaN(finish.getTime()) || finish.getTime() < now.getTime() - 60_000) throw new IncidentError('bad_deadline', 'The expected finish must be in the future.')
        if (start && start.getTime() > finish.getTime()) throw new IncidentError('bad_deadline', 'The start must come before the finish.')
        if (!isOpen(inc.status) || inc.status === 'EVIDENCE_SUBMITTED') throw new IncidentError('bad_state', 'The work is already reported as done.')
        if (inc.status === 'NEW') throw new IncidentError('bad_state', 'Assign a responsible team first.')
        const first = !inc.commit_finish_at
        if (!first && !a.reason?.trim()) throw new IncidentError('reason_required', 'Say why the deadline changes: residents see the reason.')
        await t`update incidents set commit_finish_at = ${finish}, commit_start_at = coalesce(${start}, commit_start_at), accepted_at = coalesce(accepted_at, ${now}),
          status = case when status = 'ROUTED' then 'ACCEPTED'::incident_status else status end,
          deadline_changes = deadline_changes + ${first ? 0 : 1} where id = ${id}`
        if (first) {
          await timeline(t, id, 'accepted', `${who(inc)} accepted the work`, team, { ...by, start_at: start?.toISOString() ?? null, finish_at: finish.toISOString() }, now)
          await timeline(t, id, 'deadline_set', `Deadline set: ${finish.toISOString()}`, team, { ...by, field: 'finish', from: null, to: finish.toISOString(), start_at: start?.toISOString() ?? null }, now)
          await notifyFollowers(t, id, MSG.accepted(who(inc), start?.toISOString() ?? null, finish.toISOString(), now), 'accepted', { finish_at: finish.toISOString(), start_at: start?.toISOString() ?? null }, now)
        } else {
          const from = new Date(inc.commit_finish_at!).toISOString()
          await timeline(t, id, 'deadline_changed', `Deadline changed: ${from} → ${finish.toISOString()} · ${a.reason}`, team, { ...by, field: 'finish', from, to: finish.toISOString(), reason: a.reason }, now)
          await notifyFollowers(t, id, MSG.deadline(from, finish.toISOString(), a.reason!.trim(), now), 'deadline_changed', { from, to: finish.toISOString(), reason: a.reason }, now)
        }
        break
      }
      case 'reject':
        await t`update incidents set status = 'NEW', returned_count = returned_count + 1, needs_human_review = true, routed_at = null, accept_due_at = null, assigned_at = null where id = ${id}`
        await timeline(t, id, 'returned', `${who(inc)} declined: “${a.reason}” · back to 109 for re-routing`, team, { reason: a.reason, ...by }, now)
        break
      case 'dispatch': {
        if (!['ROUTED', 'ACCEPTED', 'DISPUTED', 'IN_PROGRESS'].includes(inc.status)) throw new IncidentError('bad_state', 'Assign a team before work can start.')
        await t`update incidents set status = 'IN_PROGRESS', dispatched_at = ${now}, accepted_at = coalesce(accepted_at, ${now}) where id = ${id}`
        await timeline(t, id, 'dispatched', a.message ?? 'Work started', team, by, now)
        await notifyFollowers(t, id, MSG.started(who(inc), inc.commit_finish_at ? new Date(inc.commit_finish_at).toISOString() : null, now), 'work_started', {}, now)
        break
      }
      case 'update':
        await timeline(t, id, 'update', a.message, actor, by, now)
        await t`update incidents set updated_at = now() where id = ${id}`
        await notifyFollowers(t, id, MSG.update(inc.code, a.message), 'update', {}, now)
        break
      case 'evidence': {
        const photos = [...inc.evidence, ...a.photos].slice(-6)
        const check = checkEvidence(photos, { service: inc.service, point: inc.lat != null && inc.lon != null ? { lat: inc.lat, lon: inc.lon } : null, opened_at: new Date(inc.first_signal_at).toISOString() })
        await t`update incidents set evidence = ${t.json(photos as never)}, evidence_check = ${t.json(check as never)}, status = 'EVIDENCE_SUBMITTED' where id = ${id}`
        await timeline(t, id, 'evidence', `${a.photos.length} photo${a.photos.length === 1 ? '' : 's'} submitted · copilot: ${check.verdict.replace('_', ' ')}`, team, { check, ...by }, now)
        result = { evidence_check: check }
        break
      }
      case 'complete': {
        if (!['ROUTED', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED'].includes(inc.status)) throw new IncidentError('bad_state', 'Only work in progress can be reported as done.')
        const note = a.note.trim()
        if (note.length < 5) throw new IncidentError('note_required', 'Describe what was done.')
        const photos = [...inc.evidence.filter((p) => !(a.photos ?? []).some((q) => q.kind === p.kind)), ...(a.photos ?? [])].slice(-6)
        if (completionNeedsPhoto(inc.service, inc.problem_kind) && !photos.some((p) => p.kind === 'after')) throw new IncidentError('photo_required', 'An “after” photo is required for this kind of problem.')
        const check = photos.length ? checkEvidence(photos, { service: inc.service, point: inc.lat != null && inc.lon != null ? { lat: inc.lat, lon: inc.lon } : null, opened_at: new Date(inc.first_signal_at).toISOString() }) : null
        const completedAt = a.completed_at ? new Date(a.completed_at) : now
        // A new verification round: earlier answers were about earlier work.
        await t`update incidents set status = 'EVIDENCE_SUBMITTED', evidence = ${t.json(photos as never)}, evidence_check = ${check ? t.json(check as never) : null},
          completion_note = ${note.slice(0, 2000)}, completed_at = ${completedAt}, accepted_at = coalesce(accepted_at, ${now}), dispatched_at = coalesce(dispatched_at, ${now}),
          cause_text = coalesce(${a.cause?.trim() || null}, cause_text), cause_source = case when ${a.cause?.trim() || null}::text is not null then 'organization' else cause_source end,
          verify_round = verify_round + 1, verify_yes = 0, verify_no = 0, verify_partial = 0, verify_quality = null, verify_speed = null where id = ${id}`
        await timeline(t, id, 'completed', note, team, { ...by, photos: photos.length, completed_at: completedAt.toISOString(), check: check?.verdict ?? null, round: inc.verify_round + 1 }, now)
        if (check) await timeline(t, id, 'evidence', `Evidence check (copilot, advisory): ${check.verdict.replace('_', ' ')}`, 'copilot', { check }, now, { visibility: 'staff' })
        await notifyFollowers(t, id, MSG.completed(), 'verify_request', { round: inc.verify_round + 1 }, now)
        result = { evidence_check: check, round: inc.verify_round + 1 }
        break
      }
      case 'respond': {
        const check = checkResponse(a.text, { lang: inc.lang ?? 'ru', service: inc.service, designator: inc.designator, hasEvidence: inc.evidence.length > 0, needsEvidence: true })
        await t`update incidents set response_text = ${a.text}, response_check = ${t.json(check as never)} where id = ${id}`
        await timeline(t, id, 'qc', `Response quality: ${check.verdict.replace('_', ' ')} (${Math.round(check.score * 100)}%)`, 'copilot', { check }, now, { visibility: 'staff' })
        result = { response_check: check }
        break
      }
      case 'resolve': {
        if (!a.force && inc.response_check?.verdict === 'insufficient') throw new IncidentError('quality', 'Response quality is insufficient — fix the response before closing.')
        await t`update incidents set status = 'RESOLVED', resolved_at = ${now}, closed_by = 'operator', completed_at = coalesce(completed_at, ${now}),
          verify_round = greatest(verify_round, 1) where id = ${id}`
        await timeline(t, id, 'resolved', a.reason?.trim() ? `109 closed the request: ${a.reason.trim()}` : '109 closed the request', actor, { reason: a.reason ?? null, ...by }, now, { source: 'operator' })
        await notifyFollowers(t, id, MSG.closed(inc.code, a.reason?.trim() || null), 'resolved', {}, now)
        break
      }
      case 'close_rejected':
        await t`update incidents set status = 'REJECTED' where id = ${id}`
        await timeline(t, id, 'rejected', a.reason, actor, by, now, { source: 'operator' })
        await notifyFollowers(t, id, MSG.rejected(a.reason), 'rejected', {}, now)
        break
      case 'request_evidence':
        await t`update incidents set evidence_requested_at = ${now} where id = ${id}`
        await timeline(t, id, 'evidence_requested', a.note?.trim() || '109 asked the team for photos and a description of the work', actor, by, now, { source: 'operator', visibility: 'staff' })
        break
      case 'escalate': {
        const up: Record<PriorityLevel, PriorityLevel> = { LOW: 'NORMAL', NORMAL: 'HIGH', HIGH: 'CRITICAL', CRITICAL: 'CRITICAL' }
        await t`update incidents set priority = ${up[inc.priority]}, priority_source = 'operator', needs_human_review = false where id = ${id}`
        await timeline(t, id, 'escalated', `Escalated: ${a.reason}`, actor, { from: inc.priority, to: up[inc.priority], reason: a.reason, ...by }, now, { source: 'operator' })
        await refreshPriority(t, id, now)
        break
      }
      case 'reopen': {
        if (isOpen(inc.status) && inc.status !== 'EVIDENCE_SUBMITTED') throw new IncidentError('bad_state', 'The incident is still open.')
        await t`update incidents set status = 'DISPUTED', reopen_count = reopen_count + 1, reopened_at = ${now}, verified_at = null, closed_by = null where id = ${id}`
        await timeline(t, id, 'reopened', `109 reopened it: ${a.reason}`, actor, { reason: a.reason, ...by }, now, { source: 'operator' })
        await notifyFollowers(t, id, MSG.reopenedBy109(a.reason), 'reopened', {}, now)
        break
      }
      case 'title':
        await t`update incidents set public_title = ${a.title.trim().slice(0, 120) || null} where id = ${id}`
        await timeline(t, id, 'title', `Title set: ${a.title.trim()}`, actor, by, now, { source: 'operator', visibility: 'staff' })
        break
    }
    await audit(t, actor, `incident.${a.action}`, 'incident', id, null, a.action === 'evidence' || a.action === 'complete' ? { ...a, photos: (a.photos ?? []).length } : a)
    return result
  })
}

/** Operator merge: one physical problem reported twice becomes one incident; nobody is counted twice. */
export async function mergeIncident(sql: Sql, fromId: string, intoIdOrCode: string, actor: string, now = new Date()) {
  const intoId = await incidentId(sql, intoIdOrCode)
  if (fromId === intoId) throw new IncidentError('same', 'Cannot merge an incident into itself.')
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const from = await load(t, fromId)
    const into = await load(t, intoId)
    if (from.merged_into_id) throw new IncidentError('merged', 'Already merged.')
    if (!isOpen(into.status)) throw new IncidentError('closed', 'Merge into an open incident.')
    if ((from.demo_session_id ?? null) !== (into.demo_session_id ?? null)) throw new IncidentError('session', 'A demo-session incident merges only within its session.')
    const moved = await t`update incident_signals set incident_id = ${intoId}, decision = 'attached' where incident_id = ${fromId}`
    // Confirmations move unless the person is already counted on the target (as reporter or confirmer).
    await t`delete from incident_confirmations c where c.incident_id = ${fromId} and (
      exists (select 1 from incident_confirmations x where x.incident_id = ${intoId} and x.installation_id = c.installation_id)
      or exists (select 1 from incident_signals s where s.incident_id = ${intoId} and s.installation_id = c.installation_id))`
    await t`update incident_confirmations set incident_id = ${intoId} where incident_id = ${fromId}`
    await t`insert into incident_buildings (incident_id, building_id, source) select ${intoId}, building_id, source from incident_buildings where incident_id = ${fromId} on conflict do nothing`
    const [c] = await t<{ signals: number; confirms: number; last: Date }[]>`
      select (select count(*)::int from incident_signals where incident_id = ${intoId}) signals,
        (select count(*)::int from incident_confirmations where incident_id = ${intoId} and state = 'confirmed') confirms,
        (select max(created_at) from incident_signals where incident_id = ${intoId}) last`
    await t`update incidents set signal_count = ${c!.signals}, confirm_count = ${c!.confirms}, last_signal_at = greatest(last_signal_at, ${c!.last ?? now}) where id = ${intoId}`
    await t`update incidents set status = 'REJECTED', merged_into_id = ${intoId}, signal_count = 0, confirm_count = 0 where id = ${fromId}`
    await syncScopeAreas(t, intoId)
    await timeline(t, intoId, 'merged', `${from.code} merged into this incident (${moved.count} report${moved.count === 1 ? '' : 's'})`, actor, { from: from.code, from_id: fromId, signals: moved.count }, now, { source: 'operator' })
    await timeline(t, fromId, 'merged_into', `Merged into ${into.code}`, actor, { into: into.code, into_id: intoId }, now, { source: 'operator' })
    await notifyFollowers(t, intoId, MSG.merged(into.code), 'merged', { from: from.code }, now)
    await refreshPriority(t, intoId, now)
    await audit(t, actor, 'incident.merge', 'incident', fromId, null, { into: intoId })
    return { merged_into: intoId, code: into.code, moved: moved.count }
  })
}

// ── Verification: the affected residents decide together ────────────────────
export type VerifyInput = { answer: 'yes' | 'partial' | 'no'; quality?: number | null; speed?: number | null; comment?: string | null; photo?: ReportPhotoInput | null }

/**
 * One answer per person per completion round, only from people who reported
 * or confirmed the problem. The aggregate decides (city-core verificationOutcome):
 * enough "yes" closes it as verified, enough "no" reopens it, one vote never flips it.
 */
export async function verifyIncident(sql: Sql, idOrCode: string, installationId: string, input: VerifyInput | boolean, now = new Date()) {
  const v: VerifyInput = typeof input === 'boolean' ? { answer: input ? 'yes' : 'no' } : input
  const id = await incidentId(sql, idOrCode)
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const inc = await load(t, id)
    if (!['EVIDENCE_SUBMITTED', 'RESOLVED', 'VERIFIED'].includes(inc.status) || inc.verify_round < 1) throw new IncidentError('not_ready', 'Nothing to verify yet: the team has not reported completion.')
    const [el] = await t<{ reporter: number; confirmer: number }[]>`
      select (select count(*)::int from incident_signals where incident_id = ${id} and installation_id = ${installationId} and origin = 'resident') reporter,
        (select count(*)::int from incident_confirmations where incident_id = ${id} and installation_id = ${installationId} and state = 'confirmed') confirmer`
    // The seeded 109 scenario (not a live session) lets anyone try the check.
    const legacyDemo = inc.is_demo && !inc.demo_session_id
    if (!el!.reporter && !el!.confirmer && !legacyDemo) throw new IncidentError('not_eligible', 'Only residents who reported or confirmed this problem can verify it.')
    const round = inc.verify_round
    await t`
      insert into incident_verifications (incident_id, installation_id, round, fixed, answer, quality, speed, comment, photo, created_at, updated_at)
      values (${id}, ${installationId}, ${round}, ${v.answer === 'yes'}, ${v.answer}, ${v.quality ?? null}, ${v.speed ?? null}, ${v.comment?.trim().slice(0, 1000) || null},
        ${v.photo ? t.json(storedPhoto(v.photo) as never) : null}, ${now}, ${now})
      on conflict (incident_id, installation_id, round) do update set fixed = excluded.fixed, answer = excluded.answer,
        quality = coalesce(excluded.quality, incident_verifications.quality), speed = coalesce(excluded.speed, incident_verifications.speed),
        comment = coalesce(excluded.comment, incident_verifications.comment), photo = coalesce(excluded.photo, incident_verifications.photo), updated_at = excluded.updated_at`
    const [c] = await t<{ yes: number; partial: number; no: number; quality: number | null; speed: number | null; eligible: number }[]>`
      select count(*) filter (where answer = 'yes')::int yes, count(*) filter (where answer = 'partial')::int partial, count(*) filter (where answer = 'no')::int no,
        round(avg(quality)::numeric, 2)::float8 quality, round(avg(speed)::numeric, 2)::float8 speed,
        (select count(*)::int from (select installation_id from incident_signals where incident_id = ${id} and installation_id is not null and origin = 'resident'
          union select installation_id from incident_confirmations where incident_id = ${id} and state = 'confirmed') e) eligible
      from incident_verifications where incident_id = ${id} and round = ${round}`
    const tally = c!
    await t`update incidents set verify_yes = ${tally.yes}, verify_partial = ${tally.partial}, verify_no = ${tally.no}, verify_quality = ${tally.quality}, verify_speed = ${tally.speed} where id = ${id}`
    const out = verificationOutcome({ yes: tally.yes, partial: tally.partial, no: tally.no, eligible: tally.eligible })
    const pct = Math.round(out.yes_share * 100)
    if (out.state === 'verified' && inc.status !== 'VERIFIED') {
      await t`update incidents set status = 'VERIFIED', verified_at = ${now}, resolved_at = coalesce(resolved_at, ${now}), closed_by = coalesce(closed_by, 'residents') where id = ${id}`
      await timeline(t, id, 'verified', `Residents confirmed it is fixed: ${pct}% (${tally.yes} of ${out.n})`, 'resident',
        { yes: tally.yes, partial: tally.partial, no: tally.no, n: out.n, pct, round }, now, { source: 'resident' })
      await notifyFollowers(t, id, MSG.verified(pct, tally.yes, out.n), 'verified', { pct }, now)
    } else if (out.state === 'reopen') {
      await t`update incidents set status = 'DISPUTED', reopen_count = reopen_count + 1, reopened_at = ${now}, returned_count = returned_count + 1, verified_at = null, closed_by = null where id = ${id}`
      await timeline(t, id, 'disputed', `Reopened after residents checked: ${tally.no} of ${out.n} say it is not fixed`, 'resident',
        { yes: tally.yes, partial: tally.partial, no: tally.no, n: out.n, round }, now, { source: 'resident' })
      await notifyFollowers(t, id, MSG.reopened(tally.no, out.n), 'reopened', {}, now)
    }
    return { ...tally, round, outcome: out.state, n: out.n, quorum: out.quorum, pct }
  })
}

/** "The problem came back": a new incident at the same place, linked to the earlier repair. */
export async function reportReturned(sql: Sql, idOrCode: string, r: { installation_id: string | null; note?: string | null; photo?: ReportPhotoInput | null; origin?: 'resident' | 'staff' }) {
  const id = await incidentId(sql, idOrCode)
  const prev = await load(sql, id)
  if (isOpen(prev.status)) throw new IncidentError('still_open', 'This incident is still open: confirm it instead.')
  const title = incidentTitle(prev.service, 'ru', prev.problem_kind, prev.risk_flags)
  const place = [prev.designator && `${prev.designator} мкр`, prev.house && `дом ${prev.house}`].filter(Boolean).join(', ')
  const text = r.note?.trim() || `${title}, ${place}: проблема вернулась`
  const out = await submitSignal(sql, { text, channel: 'APP', installation_id: r.installation_id, returned_from: id, actor: 'resident', photo: r.photo ?? null, origin: r.origin ?? 'resident', session_id: prev.demo_session_id })
  return { incident_id: out.incident_id, previous_id: id }
}

// ── Read models ─────────────────────────────────────────────────────────────
type Row = {
  id: string; code: string; service: IncidentService; category: string; title: string; status: string; priority: PriorityLevel
  risk_flags: string[]; area_id: string | null; designator: string | null; area_name: string | null; area_name_ru: string | null; area_name_kk: string | null
  house: string | null; lat: number | null; lon: number | null; location_text: string | null; responsible_org: string | null; responsible_chain: unknown
  routing_confidence: number | null; routing_note: string | null; needs_human_review: boolean; city_event_id: string | null; signal_count: number
  first_signal_at: Date; last_signal_at: Date; accept_due_at: Date | null; resolve_due_at: Date | null; routed_at: Date | null; accepted_at: Date | null
  dispatched_at: Date | null; resolved_at: Date | null; verified_at: Date | null; returned_count: number; evidence: EvidencePhoto[]; evidence_check: unknown
  response_text: string | null; response_check: unknown; verify_yes: number; verify_no: number; is_demo: boolean; updated_at: Date
  channels: Record<string, number>; signals_last_hour: number; houses: string[]
  problem_kind: Intake['kind'] | null; public_title: string | null; scope_kind: ScopeKind | null; scope_radius_m: number | null; scope_source: string
  demo_session_id: string | null; confirm_count: number; priority_score: number | null; priority_reasons: PriorityReason[]; priority_source: string
  team: string | null; assigned_at: Date | null; commit_start_at: Date | null; commit_finish_at: Date | null; deadline_changes: number
  evidence_requested_at: Date | null; completion_note: string | null; completed_at: Date | null; cause_text: string | null; cause_source: string | null
  verify_round: number; verify_partial: number; verify_quality: number | null; verify_speed: number | null; reopen_count: number; reopened_at: Date | null
  closed_by: string | null; previous_incident_id: string | null; merged_into_id: string | null
  resident_signals: number; scope_houses: string[]; scope_areas: string[]; scope_buildings: number
}

const cols = (sql: Sql) => sql`
  i.id, i.code, i.service, i.category, i.title, i.status, i.priority, i.risk_flags, i.area_id, a.designator, a.name area_name, a.name_ru area_name_ru, a.name_kk area_name_kk,
  b.house_number house, ST_Y(i.point::geometry) lat, ST_X(i.point::geometry) lon, i.location_text, i.responsible_org, i.responsible_chain,
  i.routing_confidence, i.routing_note, i.needs_human_review, i.city_event_id, i.signal_count, i.first_signal_at, i.last_signal_at, i.accept_due_at,
  i.resolve_due_at, i.routed_at, i.accepted_at, i.dispatched_at, i.resolved_at, i.verified_at, i.returned_count, i.evidence, i.evidence_check,
  i.response_text, i.response_check, i.verify_yes, i.verify_no, i.is_demo, i.updated_at,
  i.problem_kind, i.public_title, i.scope_kind, i.scope_radius_m, i.scope_source, i.demo_session_id, i.confirm_count, i.priority_score, i.priority_reasons, i.priority_source,
  i.team, i.assigned_at, i.commit_start_at, i.commit_finish_at, i.deadline_changes, i.evidence_requested_at, i.completion_note, i.completed_at, i.cause_text, i.cause_source,
  i.verify_round, i.verify_partial, i.verify_quality, i.verify_speed, i.reopen_count, i.reopened_at, i.closed_by, i.previous_incident_id, i.merged_into_id,
  coalesce((select jsonb_object_agg(channel, n) from (select channel, count(*)::int n from incident_signals s where s.incident_id = i.id group by 1) x), '{}'::jsonb) channels,
  (select count(*)::int from incident_signals s where s.incident_id = i.id and s.created_at > now() - interval '1 hour') signals_last_hour,
  (select count(*)::int from incident_signals s where s.incident_id = i.id and s.origin = 'resident') resident_signals,
  coalesce((select array_agg(distinct bb.house_number) from incident_signals s join buildings bb on bb.id = s.building_id where s.incident_id = i.id and bb.area_id = i.area_id), '{}') houses,
  coalesce((select array_agg(sb.house_number order by sb.house_number_norm) from incident_buildings ib join buildings sb on sb.id = ib.building_id where ib.incident_id = i.id), '{}') scope_houses,
  coalesce((select array_agg(coalesce(sa.designator, sa.name)) from incident_areas ia join areas sa on sa.id = ia.area_id where ia.incident_id = i.id and ia.coverage = 'FULL'), '{}') scope_areas,
  case when i.scope_kind in ('building', 'buildings') then (select count(*)::int from incident_buildings ib where ib.incident_id = i.id)
       when i.scope_kind = 'radius' and i.point is not null then (select count(*)::int from buildings sb where ST_DWithin(sb.point, i.point, coalesce(i.scope_radius_m, 200)))
       else null end scope_buildings`

function project(r: Row, now = new Date()) {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)
  const sla = slaState({
    status: r.status, priority: r.priority, routed_at: iso(r.routed_at), accepted_at: iso(r.accepted_at), accept_due_at: iso(r.accept_due_at),
    resolve_due_at: iso(r.resolve_due_at), returned_count: r.returned_count, evidence_count: r.evidence.length, signal_count: r.signal_count,
    signals_last_hour: r.signals_last_hour, commit_finish_at: iso(r.commit_finish_at),
  }, now)
  const n = r.verify_yes + r.verify_partial + r.verify_no
  return {
    ...r,
    first_signal_at: iso(r.first_signal_at)!, last_signal_at: iso(r.last_signal_at)!, accept_due_at: iso(r.accept_due_at), resolve_due_at: iso(r.resolve_due_at),
    routed_at: iso(r.routed_at), accepted_at: iso(r.accepted_at), dispatched_at: iso(r.dispatched_at), resolved_at: iso(r.resolved_at), verified_at: iso(r.verified_at),
    updated_at: iso(r.updated_at)!, assigned_at: iso(r.assigned_at), commit_start_at: iso(r.commit_start_at), commit_finish_at: iso(r.commit_finish_at),
    evidence_requested_at: iso(r.evidence_requested_at), completed_at: iso(r.completed_at), reopened_at: iso(r.reopened_at),
    evidence: r.evidence.map((e) => ({ ...e })),
    /** Residents who reported (from any channel, staff excluded) or confirmed. */
    residents: r.resident_signals + r.confirm_count,
    verify_n: n,
    verify_pct: n ? Math.round((r.verify_yes / n) * 100) : null,
    sla,
  }
}
export type IncidentDTO = ReturnType<typeof project>

/** Public lists drop what residents must not see (the formal answer, evidence images). */
export function lite<T extends IncidentDTO>({ response_text: _r, evidence, ...i }: T) {
  return { ...i, evidence_count: evidence.length }
}

export async function listIncidents(sql: Sql, o: { open?: boolean; limit?: number; city?: boolean; sessionId?: string | null } = {}) {
  const rows = await sql<Row[]>`
    select ${cols(sql)} from incidents i left join areas a on a.id = i.area_id left join buildings b on b.id = i.building_id
    where ${o.open ? sql`(i.status not in ('VERIFIED', 'REJECTED') or i.updated_at > now() - interval '12 hours')` : sql`true`}
      and i.merged_into_id is null
      ${o.city ? sql`and i.demo_session_id is null` : sql``}
      ${o.sessionId ? sql`and i.demo_session_id = ${o.sessionId}` : sql``}
    order by case i.priority when 'CRITICAL' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end, i.last_signal_at desc
    limit ${o.limit ?? 100}`
  return rows.map((r) => project(r))
}

const PUBLIC_KINDS = new Set(['created', 'signal', 'confirmed', 'official', 'recurrence', 'scope', 'priority', 'routed', 'accepted', 'deadline_set', 'deadline_changed',
  'returned', 'dispatched', 'update', 'completed', 'evidence', 'resolved', 'verified', 'disputed', 'reopened', 'rejected', 'merged', 'merged_into', 'escalated'])

export async function incidentDetail(sql: Sql, idOrCode: string, o: { includeSignalText?: boolean; installation_id?: string | null; now?: Date } = {}) {
  const byCode = /^INC-\d+$/i.test(idOrCode)
  if (!byCode && !/^[0-9a-f-]{36}$/i.test(idOrCode)) return null
  const [r] = await sql<Row[]>`
    select ${cols(sql)} from incidents i left join areas a on a.id = i.area_id left join buildings b on b.id = i.building_id
    where ${byCode ? sql`i.code = ${idOrCode.toUpperCase()}` : sql`i.id = ${idOrCode}::uuid`}`
  if (!r) return null
  const staff = !!o.includeSignalText
  const iid = o.installation_id ?? null
  const [tl, sigs, official, mine, confirmations, prev, merged, session, home] = await Promise.all([
    sql<{ id: string; seq: number; kind: string; message: string; actor: string; source: string; visibility: string; data: Record<string, unknown>; created_at: Date }[]>`
      select id, seq, kind, message, actor, source, visibility, data, created_at from incident_timeline
      where incident_id = ${r.id} ${staff ? sql`` : sql`and visibility = 'public'`} order by created_at, seq`,
    sql<{ id: string; channel: string; lang: string; raw_text: string; intake: Intake; match_score: number | null; match_reasons: string[]; decision: string; created_at: Date; house: string | null; designator: string | null; installation_id: string | null; origin: string; photo: { image: string } | null; check_result: (ReportCheck & { sent_anyway?: boolean }) | null }[]>`
      select s.id, s.channel, s.lang, s.raw_text, s.intake, s.match_score, s.match_reasons, s.decision, s.created_at, b.house_number house, a.designator, s.installation_id, s.origin,
        ${staff ? sql`s.photo, s.check_result` : sql`null::jsonb photo, null::jsonb check_result`}
      from incident_signals s left join buildings b on b.id = s.building_id left join areas a on a.id = s.area_id where s.incident_id = ${r.id} order by s.created_at`,
    r.city_event_id ? sql<{ id: string; title: string; status: string; reported_authority: string | null; reason: string | null }[]>`select id, title, status, reported_authority, reason from city_events where id = ${r.city_event_id}` : Promise.resolve([]),
    iid ? sql<{ answer: string; quality: number | null; speed: number | null; round: number }[]>`select answer, quality, speed, round from incident_verifications where incident_id = ${r.id} and installation_id = ${iid} order by round desc limit 1` : Promise.resolve([]),
    sql<{ id: string; installation_id: string; state: string; context: string; distance_m: number | null; note: string | null; photo: { image: string } | null; created_at: Date; house: string | null; designator: string | null }[]>`
      select c.id, c.installation_id, c.state, c.context, c.distance_m, ${staff ? sql`c.note, c.photo` : sql`null::text note, null::jsonb photo`}, c.created_at, b.house_number house, a.designator
      from incident_confirmations c left join buildings b on b.id = c.building_id left join areas a on a.id = b.area_id
      where c.incident_id = ${r.id} ${staff ? sql`` : sql`and c.installation_id = ${iid ?? ''}`} order by c.created_at`,
    r.previous_incident_id ? sql<{ id: string; code: string; closed_at: Date | null; responsible_org: string | null; team: string | null; verify_quality: number | null; verify_yes: number; verify_partial: number; verify_no: number; completion_note: string | null }[]>`
      select id, code, coalesce(verified_at, resolved_at) closed_at, responsible_org, team, verify_quality, verify_yes, verify_partial, verify_no, completion_note from incidents where id = ${r.previous_incident_id}` : Promise.resolve([]),
    r.merged_into_id ? sql<{ id: string; code: string }[]>`select id, code from incidents where id = ${r.merged_into_id}` : Promise.resolve([]),
    r.demo_session_id ? sessionById(sql, r.demo_session_id) : Promise.resolve(null),
    iid ? resolveLocation(sql, { installation_id: iid }, 'en') : Promise.resolve(null),
  ])
  // Who may answer the residents' check: counted here, because the public view loads only the viewer's own confirmation.
  const [{ eligible } = { eligible: 0 }] = await sql<{ eligible: number }[]>`
    select count(*)::int eligible from (
      select installation_id from incident_signals where incident_id = ${r.id} and installation_id is not null and origin = 'resident'
      union select installation_id from incident_confirmations where incident_id = ${r.id} and state = 'confirmed') e`
  const d = project(r, o.now)
  // My place relative to the scope (never echoing coordinates).
  let my: { relevance: string; distance_m: number | null } | null = null
  if (home && home.ctx.kind !== 'city') {
    const facts = await scopeFacts(sql, r.id, { building_id: home.building_id, point: home.point })
    const aff = incidentAffects(facts, { building_id: home.building_id, area_ids: home.area_ids })
    my = { relevance: aff.relevance, distance_m: facts.distance_m != null ? Math.round(facts.distance_m) : null }
  }
  const myConfirmation = confirmations.find((c) => c.installation_id === iid) ?? null
  const reporter = !!iid && sigs.some((s) => s.installation_id === iid)
  const vout = verificationOutcome({ yes: r.verify_yes, partial: r.verify_partial, no: r.verify_no, eligible })
  const deadlines = tl.filter((x) => x.kind === 'deadline_set' || x.kind === 'deadline_changed')
    .map((x) => ({ at: new Date(x.created_at).toISOString(), from: (x.data.from as string | null) ?? null, to: x.data.to as string, reason: (x.data.reason as string | null) ?? null, actor: x.actor }))
  return {
    ...d,
    timeline: tl.filter((x) => staff || PUBLIC_KINDS.has(x.kind)).map((x) => ({ ...x, created_at: new Date(x.created_at).toISOString() })),
    signals: sigs.map((s) => ({
      id: s.id, channel: s.channel, lang: s.lang, created_at: new Date(s.created_at).toISOString(), house: s.house, designator: s.designator, origin: s.origin,
      match_score: s.match_score, match_reasons: s.match_reasons, decision: s.decision, mine: !!iid && s.installation_id === iid,
      ...(staff ? { raw_text: s.raw_text, intake: s.intake, photo: s.photo?.image ?? null, check: s.check_result } : {}),
    })),
    confirmations: staff ? confirmations.map(({ installation_id: _i, photo, ...c }) => ({ ...c, photo: photo?.image ?? null, created_at: new Date(c.created_at).toISOString() })) : [],
    official: official[0] ?? null,
    previous: prev[0] ? { ...prev[0], closed_at: prev[0].closed_at ? new Date(prev[0].closed_at).toISOString() : null } : null,
    merged_into: merged[0] ?? null,
    session: session ? { id: session.id, code: session.code, title: session.title, venue: session.venue } : null,
    deadlines,
    verification: { round: r.verify_round, yes: r.verify_yes, partial: r.verify_partial, no: r.verify_no, eligible, quorum: vout.quorum, outcome: vout.state, pct: d.verify_pct, quality: r.verify_quality, speed: r.verify_speed },
    needs_after_photo: completionNeedsPhoto(r.service, r.problem_kind),
    my_signal: reporter,
    my_relation: reporter ? 'reporter' : (myConfirmation?.state ?? null) as 'reporter' | 'confirmed' | 'not_affected' | 'withdrawn' | null,
    my_place: my,
    my_verification: mine[0] && mine[0].round === r.verify_round ? mine[0].answer === 'yes' : null,
    my_answer: mine[0] && mine[0].round === r.verify_round ? mine[0] : null,
    can_verify: ((!!iid && sigs.some((s) => s.installation_id === iid && s.origin === 'resident')) || myConfirmation?.state === 'confirmed' || (r.is_demo && !r.demo_session_id))
      && ['EVIDENCE_SUBMITTED', 'RESOLVED', 'VERIFIED'].includes(r.status) && r.verify_round > 0,
  }
}
export type IncidentDetailDTO = NonNullable<Awaited<ReturnType<typeof incidentDetail>>>

export async function pendingSignals(sql: Sql) {
  const rows = await sql<{ id: string; channel: string; raw_text: string; lang: string; created_at: Date; is_demo: boolean; demo_session_id: string | null }[]>`
    select id, channel, raw_text, lang, created_at, is_demo, demo_session_id from incident_signals where decision = 'pending' order by created_at desc limit 30`
  return Promise.all(rows.map(async (r) => ({ ...r, created_at: new Date(r.created_at).toISOString(), preview: await previewSignal(sql, r.raw_text, { now: new Date(r.created_at), sessionId: r.demo_session_id }) })))
}

export async function incidentsGeoJSON(sql: Sql) {
  const list = await listIncidents(sql, { open: true, city: true })
  const sigs = await sql<{ incident_id: string; lat: number; lon: number }[]>`
    select s.incident_id, ST_Y(s.point::geometry) lat, ST_X(s.point::geometry) lon from incident_signals s join incidents i on i.id = s.incident_id
    where s.point is not null and i.demo_session_id is null and i.merged_into_id is null and (i.status not in ('VERIFIED', 'REJECTED') or i.updated_at > now() - interval '12 hours')`
  const features = [
    ...list.filter((i) => i.lat != null).map((i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [i.lon, i.lat] }, properties: {
      layer: 'incident', id: i.id, code: i.code, service: i.service, status: i.status, priority: i.priority, signals: i.signal_count, residents: i.residents,
      sla: i.sla.level, is_demo: i.is_demo, reopened: i.reopen_count > 0, overdue: i.sla.level === 'breached', verified: i.status === 'VERIFIED',
    } })),
    // Deterministic jitter so signals from the same building fan out a little.
    ...sigs.map((s, k) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon + Math.sin(k * 2.39) * 0.00022, s.lat + Math.cos(k * 2.39) * 0.00016] }, properties: { layer: 'signal', id: s.incident_id } })),
  ]
  return { type: 'FeatureCollection', features, incidents: list }
}

export async function myIncidentMessages(sql: Sql, installationId: string, limit = 50) {
  return sql<{ id: string; incident_id: string; code: string; title: string; body: string; kind: string; data: Record<string, unknown>; created_at: Date }[]>`
    select m.id, m.incident_id, i.code, m.title, m.body, m.kind, m.data, m.created_at from incident_messages m join incidents i on i.id = m.incident_id
    where m.installation_id = ${installationId} order by m.created_at desc limit ${limit}`
}

/** Incidents this installation reported or confirmed. */
export async function myIncidents(sql: Sql, installationId: string) {
  const ids = await sql<{ incident_id: string }[]>`
    select distinct incident_id from incident_signals where installation_id = ${installationId} and incident_id is not null
    union select incident_id from incident_confirmations where installation_id = ${installationId} and state = 'confirmed'`
  if (!ids.length) return []
  const all = await listIncidents(sql, { limit: 200 })
  const set = new Set(ids.map((r) => r.incident_id))
  return all.filter((i) => set.has(i.id))
}

/**
 * Operator analytics from real incident data (city incidents only; demo
 * sessions and the seeded scenario are excluded unless asked for).
 */
export async function incidentAnalytics(sql: Sql, o: { days?: number; includeDemo?: boolean } = {}) {
  const since = new Date(Date.now() - (o.days ?? 30) * 86400_000)
  const demo = o.includeDemo ? sql`` : sql`and is_demo = false`
  const [a] = await sql<{
    active: number; overdue: number; response_min: number | null; resolution_h: number | null; closed: number; verified: number; reopened: number; recurring: number
    first_time: number; residents: number; merged: number
  }[]>`
    select
      (select count(*)::int from incidents where status not in ('RESOLVED', 'VERIFIED', 'REJECTED') and merged_into_id is null ${demo}) active,
      (select count(*)::int from incidents where status in ('ROUTED', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED') ${demo}
        and ((commit_finish_at is not null and commit_finish_at < now()) or (commit_finish_at is null and resolve_due_at < now()) or (status = 'ROUTED' and accepted_at is null and accept_due_at < now()))) overdue,
      (select round(avg(extract(epoch from assigned_at - first_signal_at) / 60))::int from incidents where assigned_at is not null and assigned_at > ${since} ${demo}) response_min,
      (select round((avg(extract(epoch from coalesce(completed_at, resolved_at) - first_signal_at) / 3600))::numeric, 1)::float8 from incidents
        where coalesce(completed_at, resolved_at) > ${since} and status in ('RESOLVED', 'VERIFIED') ${demo}) resolution_h,
      (select count(*)::int from incidents where status in ('RESOLVED', 'VERIFIED') and coalesce(verified_at, resolved_at) > ${since} ${demo}) closed,
      (select count(*)::int from incidents where status = 'VERIFIED' and verified_at > ${since} ${demo}) verified,
      (select count(*)::int from incidents where reopen_count > 0 and coalesce(reopened_at, updated_at) > ${since} ${demo}) reopened,
      (select count(*)::int from incidents where previous_incident_id is not null and created_at > ${since} ${demo}) recurring,
      (select count(*)::int from incidents x where x.status in ('RESOLVED', 'VERIFIED') and coalesce(x.verified_at, x.resolved_at) > ${since} and x.reopen_count = 0
        and not exists (select 1 from incidents y where y.previous_incident_id = x.id) ${o.includeDemo ? sql`` : sql`and x.is_demo = false`}) first_time,
      (select coalesce(sum(signal_count + confirm_count), 0)::int from incidents where created_at > ${since} ${demo}) residents,
      (select count(*)::int from incident_signals where decision = 'attached' and created_at > ${since} ${o.includeDemo ? sql`` : sql`and is_demo = false`}) merged`
  const s = a!
  return {
    days: o.days ?? 30, ...s,
    verified_rate: s.closed ? s.verified / s.closed : null,
    first_time_fix_rate: s.closed ? s.first_time / s.closed : null,
  }
}

export async function opsStats(sql: Sql) {
  const [s] = await sql<{ signals_today: number; signals_attached_today: number; confirmations_today: number; incidents_open: number; incidents_new: number; resolved_7d: number; verified_7d: number; disputed_open: number; avg_accept_min: number | null; phone_calls: number }[]>`
    select
      (select count(*)::int from incident_signals where created_at > now() - interval '24 hours') signals_today,
      (select count(*)::int from incident_signals where created_at > now() - interval '24 hours' and decision = 'attached') signals_attached_today,
      (select count(*)::int from incident_confirmations where created_at > now() - interval '24 hours' and state = 'confirmed') confirmations_today,
      (select count(*)::int from incidents where status not in ('RESOLVED', 'VERIFIED', 'REJECTED')) incidents_open,
      (select count(*)::int from incidents where status = 'NEW') incidents_new,
      (select count(*)::int from incidents where resolved_at > now() - interval '7 days') resolved_7d,
      (select count(*)::int from incidents where verified_at > now() - interval '7 days') verified_7d,
      (select count(*)::int from incidents where status = 'DISPUTED') disputed_open,
      (select round(avg(extract(epoch from accepted_at - routed_at) / 60))::int from incidents where accepted_at is not null and routed_at is not null and accepted_at > routed_at) avg_accept_min,
      (select count(*)::int from incident_signals where channel = 'PHONE') phone_calls`
  const list = await listIncidents(sql, { open: true })
  const intervention = list.filter((i) => i.sla.level === 'at_risk' || i.sla.level === 'breached')
  const calls = await sql<{ raw_text: string; intake: Intake }[]>`select raw_text, intake from incident_signals where channel = 'PHONE' order by created_at desc limit 200`
  const qa = calls.map((c) => callQa(c.raw_text, { service: c.intake.service, designator: c.intake.designator, house: c.intake.house, lang: c.intake.lang }))
  const incoming = s!.signals_today + s!.confirmations_today
  return {
    ...s!,
    intervention: intervention.length,
    // Share of resident signals (reports + confirmations) that joined an existing incident instead of opening a new one.
    merge_ratio: incoming ? (s!.signals_attached_today + s!.confirmations_today) / incoming : 0,
    call_qa: { total: qa.length, review: qa.filter((q) => q.review).length },
    analytics: await incidentAnalytics(sql, { includeDemo: true }),
  }
}

export async function cityPulse(sql: Sql) {
  const [p] = await sql<{ open: number; signals: number; merged: number; verified: number; areas: number; confirmations: number }[]>`
    select (select count(*)::int from incidents where status not in ('RESOLVED', 'VERIFIED', 'REJECTED') and demo_session_id is null) open,
      (select count(*)::int from incident_signals where demo_session_id is null) signals,
      (select count(*)::int from incident_signals where decision = 'attached' and demo_session_id is null) merged,
      (select count(*)::int from incidents where status = 'VERIFIED' and demo_session_id is null) verified,
      (select count(*)::int from incident_confirmations where state = 'confirmed' and demo_session_id is null) confirmations,
      (select count(distinct area_id)::int from incidents where status not in ('VERIFIED', 'REJECTED') and demo_session_id is null) areas`
  return p!
}

/**
 * Periodic upkeep (lifecycle job): priority follows duration, and a completion
 * nobody could verify in 24 h is left for an operator (never auto-closed).
 */
export async function incidentSweep(sql: Sql, now = new Date()) {
  // Incidents opened before scopes existed get one inferred from their first report.
  const unscoped = await sql<{ id: string; intake: Intake; area_id: string | null; building_id: string | null; lat: number | null; lon: number | null; session: string | null }[]>`
    select i.id, s.intake, i.area_id, i.building_id, ST_Y(i.point::geometry) lat, ST_X(i.point::geometry) lon, i.demo_session_id session
    from incidents i join lateral (select intake from incident_signals x where x.incident_id = i.id order by x.created_at limit 1) s on true
    where i.scope_kind is null and i.status not in ('REJECTED') and i.merged_into_id is null limit 200`
  for (const u of unscoped) {
    const scope: ScopeProposal = u.session ? { kind: 'demo_session', radius_m: null, reason: 'demo_session' }
      : inferScope(u.intake, { building_id: u.building_id, area_id: u.area_id, has_point: u.lat != null })
    if (!scope.kind) continue
    await sql.begin((tx) => applyScope(tx as unknown as Sql, u.id, scope, { area_id: u.area_id, area_name: null, building_id: u.building_id, lat: u.lat, lon: u.lon }, u.session))
  }
  const open = await sql<{ id: string }[]>`select id from incidents where status not in ('RESOLVED', 'VERIFIED', 'REJECTED') and merged_into_id is null limit 500`
  for (const r of open) await refreshPriority(sql, r.id, now)
  return { scoped: unscoped.length, reprioritised: open.length }
}

// ── Demo scenario (is_demo = true, labelled DEMO everywhere) ─────────────────
type DemoSignal = { text: string; channel: Channel; ago: number }
type DemoIncident = {
  signals: DemoSignal[]
  status: 'NEW' | 'ROUTED' | 'ACCEPTED' | 'IN_PROGRESS' | 'EVIDENCE_SUBMITTED' | 'RESOLVED' | 'VERIFIED' | 'DISPUTED'
  routedAgo?: number; acceptedAgo?: number; dispatchedAgo?: number; resolvedAgo?: number
  /** Deadline the team committed to, relative to acceptance (hours). */
  commitHours?: number
  updates?: Array<{ ago: number; message: string }>
  response?: string
  evidence?: 'garbage' | 'streetlight_day'
  returned?: number
  verify?: { yes: number; no: number }
  rejectedBy?: { ago: number; reason: string }
}

const H = 3600_000, M = 60_000

/** The most recent 13:10 in Aqtau (UTC+5) — a daylight photo for the streetlight check. */
function localOnePm(now: Date) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 10))
  return d > now ? new Date(d.getTime() - 24 * H) : d
}

function demoScenario(): DemoIncident[] {
  const water14: DemoSignal[] = [
    { text: 'Алло, 14 микрорайон, 21 дом, уже с утра воды нет, соседи тоже говорят нет.', channel: 'PHONE', ago: 3.2 * H },
    { text: '14 мкр 19 дом нет воды с 8 утра', channel: 'WHATSAPP', ago: 3.1 * H },
    { text: '14 ш/а 22 үйде су жоқ таңертеңнен', channel: 'KOMEK109', ago: 3 * H },
    { text: 'Воды нет в 14 микрорайоне, дом 17, весь подъезд', channel: 'INSTAGRAM', ago: 2.9 * H },
    { text: 'Оператор: 109, слушаю.\nЖитель: 14 мкр дом 25, воды нет с утра.\nОператор: Номер заявки сообщу по SMS.', channel: 'PHONE', ago: 2.8 * H },
    { text: 'Нет воды 14 мкр 20 дом', channel: 'APP', ago: 2.6 * H },
    { text: '14 микрорайон дом 23 нет воды, дети дома', channel: 'WHATSAPP', ago: 2.5 * H },
    { text: '15 мкр 3 дом тоже нет воды с утра', channel: 'KOMEK109', ago: 2.4 * H },
    { text: '14 шағын аудан 18 үй су жоқ', channel: 'APP', ago: 2.2 * H },
    { text: 'Когда дадут воду? 14 мкр, 24 дом', channel: 'INSTAGRAM', ago: 2 * H },
    { text: 'Оператор: 109, слушаю.\nЖитель: Воды нет, 14 мкр 21.\nОператор: Уточните подъезд. Номер обращения INC-1040.', channel: 'PHONE', ago: 1.8 * H },
    { text: '14 мкр 16 дом нет холодной воды', channel: 'WHATSAPP', ago: 1.5 * H },
    { text: 'Нет воды 15 микрорайон дом 5', channel: 'APP', ago: 1.3 * H },
    { text: '14 мкр 26 су жоқ', channel: 'KOMEK109', ago: 1 * H },
    { text: 'До сих пор нет воды 14 мкр 19', channel: 'WHATSAPP', ago: 0.6 * H },
    { text: '14 мкр дом 22 без воды уже полдня', channel: 'APP', ago: 0.3 * H },
  ]
  return [
    { signals: water14, status: 'ACCEPTED', routedAgo: 2.9 * H, acceptedAgo: 2.7 * H, commitHours: 6, updates: [{ ago: 2 * H, message: 'KZhSA: damage on the distribution main is being localised.' }] },
    {
      signals: [
        { text: '15 мкр возле дома 7 не горят фонари уже неделю, темно, дети ходят', channel: 'KOMEK109', ago: 5 * 24 * H },
        { text: 'Во дворе 15 микрорайона темно, освещение не работает', channel: 'PHONE', ago: 4 * 24 * H },
        { text: '15 мкр 8 дом фонари не горят', channel: 'WHATSAPP', ago: 3 * 24 * H },
        { text: 'Опять темно во дворе, 15 мкр, дом 6', channel: 'APP', ago: 2 * 24 * H },
        { text: '15 шағын аудан 7 үй жанында шамдар жанбайды', channel: 'KOMEK109', ago: 1 * 24 * H },
        { text: 'Темный двор 15 мкр 9 дом, страшно вечером', channel: 'INSTAGRAM', ago: 9 * H },
        { text: 'Третий раз пишу: 15 мкр, дом 7, освещение', channel: 'APP', ago: 2 * H },
      ],
      status: 'ROUTED', routedAgo: 4.8 * 24 * H, returned: 1, rejectedBy: { ago: 3.5 * 24 * H, reason: 'Not on our balance sheet' },
    },
    {
      signals: [
        { text: 'В 14 мкр возле дома 20 висит опасный внешний блок кондиционера, может упасть на людей', channel: 'PHONE', ago: 40 * M },
        { text: '14 мкр 20 дом кондиционер висит на проводах над входом', channel: 'WHATSAPP', ago: 22 * M },
      ],
      status: 'NEW',
    },
    {
      signals: [
        { text: '12 мкр возле дома 45 мусор не вывозят третий день, контейнеры переполнены', channel: 'APP', ago: 30 * H },
        { text: '12 мкр 45 дом свалка у контейнеров', channel: 'INSTAGRAM', ago: 26 * H },
        { text: '12 шағын аудан 44 үй қоқыс шығарылмаған', channel: 'KOMEK109', ago: 20 * H },
      ],
      status: 'EVIDENCE_SUBMITTED', routedAgo: 29 * H, acceptedAgo: 28 * H, dispatchedAgo: 5 * H, commitHours: 26, evidence: 'garbage',
      response: '23 сентября в 10:40 контейнерная площадка у дома 45 в 12 мкр очищена, мусор вывезен (4 контейнера), вывоз восстановлен по графику. Причина — поломка мусоровоза. Вы вправе обжаловать ответ.',
    },
    {
      signals: [
        { text: '3Б микрорайон дом 12 нет горячей воды второй день', channel: 'PHONE', ago: 26 * H },
        { text: 'В 3Б мкр горячей воды нет, 14 дом', channel: 'APP', ago: 20 * H },
        { text: '3Б мкр 12 ыстық су жоқ', channel: 'KOMEK109', ago: 8 * H },
      ],
      status: 'IN_PROGRESS', routedAgo: 25 * H, acceptedAgo: 22 * H, dispatchedAgo: 6 * H, commitHours: 30, response: 'Работы проведены.',
    },
    {
      signals: [
        { text: '4 мкр у дома 38 не горит фонарь, темно у остановки', channel: 'APP', ago: 28 * H },
        { text: '4 мкр 38 үй жанында шам жанбайды', channel: 'KOMEK109', ago: 24 * H },
      ],
      status: 'EVIDENCE_SUBMITTED', routedAgo: 27 * H, acceptedAgo: 25 * H, dispatchedAgo: 8 * H, commitHours: 24, evidence: 'streetlight_day',
      response: 'Сегодня в 13:10 в 4 мкр у дома 38 заменена лампа светильника, освещение работает. Вы вправе обжаловать ответ.',
    },
    {
      signals: [
        { text: '27 мкр возле дома 14 демонтировали лежачий полицейский, машины гоняют у школы', channel: 'KOMEK109', ago: 60 * H },
        { text: '27 мкр 14 дом нужен лежачий полицейский, дети', channel: 'APP', ago: 20 * H },
      ],
      status: 'ROUTED', routedAgo: 58 * H, updates: [{ ago: 30 * H, message: 'Executor asked for 5 working days.' }],
    },
    {
      signals: [
        { text: '11 мкр дом 30 лифт не работает второй подъезд, пожилые люди', channel: 'PHONE', ago: 20 * H },
        { text: '11 мкр 30 лифт стоит', channel: 'APP', ago: 18 * H },
      ],
      status: 'RESOLVED', routedAgo: 19 * H, acceptedAgo: 18.5 * H, dispatchedAgo: 16 * H, resolvedAgo: 3 * H, commitHours: 8,
      response: 'Сегодня в 11:20 в доме 30, 11 мкр заменён датчик дверей лифта во 2 подъезде, лифт работает. Причина — износ датчика. Вы вправе обжаловать ответ.',
    },
    {
      signals: [
        { text: '5 мкр дом 20 нет света во всем доме', channel: 'PHONE', ago: 30 * H },
        { text: '5 мкр 21 үй жарық жоқ', channel: 'KOMEK109', ago: 29.5 * H },
        { text: '5 мкр нет света у соседей тоже, дом 19', channel: 'WHATSAPP', ago: 29 * H },
        { text: 'Нет электричества 5 микрорайон 22 дом', channel: 'APP', ago: 28.8 * H },
      ],
      status: 'VERIFIED', routedAgo: 29.8 * H, acceptedAgo: 29.6 * H, dispatchedAgo: 29.2 * H, resolvedAgo: 26 * H, commitHours: 4, verify: { yes: 3, no: 0 },
      response: '22 сентября в 19:05 в 5 мкр восстановлено электроснабжение домов 19–22: заменён кабельный наконечник на ТП-512. Причина — перегрев соединения. Вы вправе обжаловать ответ.',
    },
    {
      signals: [
        { text: '7 мкр дом 6 вода очень слабый напор, почти нет воды', channel: 'APP', ago: 50 * H },
        { text: '7 мкр 5 дом воды нет вечером', channel: 'WHATSAPP', ago: 44 * H },
      ],
      status: 'DISPUTED', routedAgo: 49 * H, acceptedAgo: 48 * H, dispatchedAgo: 40 * H, resolvedAgo: 20 * H, commitHours: 12, verify: { yes: 0, no: 2 }, returned: 1,
      response: '22 сентября промыт участок сети у домов 5–6 в 7 мкр, давление восстановлено. Вы вправе обжаловать ответ.',
    },
  ]
}

/**
 * Demo evidence: real photographs (Wikimedia Commons, credited on You → Data
 * sources), never the actual place. Hashes and brightness are what the browser
 * computes for a submitted photo; the copilot checks run on them.
 */
export const DEMO_EVIDENCE_PHOTOS = {
  garbage_before: { src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bb/Overflowing_Hamburg_street_garbage_bin.jpg/960px-Overflowing_Hamburg_street_garbage_bin.jpg', credit: 'Wikimedia Commons, public domain' },
  garbage_after: { src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f4/%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B%2C_%D0%BC%D1%83%D1%81%D0%BE%D1%80%D0%BD%D1%8B%D0%B9_%D0%B1%D0%B0%D0%BA_%D0%BD%D0%B0_%D0%BF%D0%BB%D0%BE%D1%89%D0%B0%D0%B4%D0%B8_%D0%90%D1%81%D1%82%D0%B0%D0%BD%D0%B0.jpg/960px-%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B%2C_%D0%BC%D1%83%D1%81%D0%BE%D1%80%D0%BD%D1%8B%D0%B9_%D0%B1%D0%B0%D0%BA_%D0%BD%D0%B0_%D0%BF%D0%BB%D0%BE%D1%89%D0%B0%D0%B4%D0%B8_%D0%90%D1%81%D1%82%D0%B0%D0%BD%D0%B0.jpg', credit: 'Nikolai Bulykin, CC BY-SA 4.0' },
  lamp_day: { src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/eb/Lamp_post_in_Pasir_Gudang.jpg/960px-Lamp_post_in_Pasir_Gudang.jpg', credit: 'Wee Hong, CC BY-SA 4.0' },
} as const

function svgPhoto(kind: 'garbage_before' | 'garbage_after' | 'lamp_day'): { image: string; hash: string; brightness: number } {
  const hashes = { garbage_before: 'f0f0e0c081818fff', garbage_after: '00000000ff7e7e00', lamp_day: '1818181818183cff' }
  const bright = { garbage_before: 0.52, garbage_after: 0.74, lamp_day: 0.78 }
  return { image: DEMO_EVIDENCE_PHOTOS[kind].src, hash: hashes[kind], brightness: bright[kind] }
}

export async function clearIncidentDemo(sql: Sql) {
  // Live sessions keep their own incidents (deleted with the session).
  const r = await sql`delete from incidents where is_demo = true and demo_session_id is null`
  await sql`delete from incident_signals where is_demo = true and demo_session_id is null`
  await sql`select setval('incident_code_seq', greatest(1040, (select coalesce(max(substr(code, 5)::int), 1039) + 1 from incidents)), false)`
  return r.count
}

export async function seedIncidentDemo(sql: Sql, actor = 'system:demo', now = new Date()) {
  await clearIncidentDemo(sql)
  const ids: string[] = []
  for (const d of demoScenario()) {
    const first = d.signals[0]!
    const t = (ago: number) => new Date(now.getTime() - ago)
    const r = await submitSignal(sql, { text: first.text, channel: first.channel, create: true, is_demo: true, now: t(first.ago), installation_id: 'demo-resident-0', actor: 'copilot' })
    const id = r.incident_id!
    ids.push(id)
    for (const [k, s] of d.signals.slice(1).entries()) {
      await submitSignal(sql, { text: s.text, channel: s.channel, attach_to: id, is_demo: true, now: t(s.ago), installation_id: `demo-resident-${k + 1}`, actor: 'operator' })
    }
    const inc = await load(sql, id)
    if (d.routedAgo) await incidentAction(sql, id, { action: 'route' }, 'operator', t(d.routedAgo))
    if (d.rejectedBy) {
      await incidentAction(sql, id, { action: 'reject', reason: d.rejectedBy.reason }, 'operator', t(d.rejectedBy.ago))
      await incidentAction(sql, id, { action: 'route' }, 'operator', t(d.rejectedBy.ago - 2 * H))
    }
    if (d.acceptedAgo) {
      if (d.commitHours) await incidentAction(sql, id, { action: 'commit', finish_at: new Date(now.getTime() - d.acceptedAgo + d.commitHours * H).toISOString() }, 'operator', t(d.acceptedAgo))
      else await incidentAction(sql, id, { action: 'accept' }, 'operator', t(d.acceptedAgo))
    }
    if (d.dispatchedAgo) await incidentAction(sql, id, { action: 'dispatch', message: 'Repair team dispatched.' }, 'operator', t(d.dispatchedAgo))
    for (const u of d.updates ?? []) await incidentAction(sql, id, { action: 'update', message: u.message }, `executor:${inc.responsible_org}`, t(u.ago))
    if (d.evidence) {
      const pt = { lat: inc.lat ?? 43.65, lon: inc.lon ?? 51.15 }
      const photos: EvidencePhoto[] = d.evidence === 'garbage'
        ? [{ kind: 'before', ...pt, captured_at: t(4.5 * H).toISOString(), ...svgPhoto('garbage_before') }, { kind: 'after', lat: pt.lat + 0.0002, lon: pt.lon, captured_at: t(3 * H).toISOString(), ...svgPhoto('garbage_after') }]
        : [{ kind: 'after', ...pt, captured_at: localOnePm(now).toISOString(), ...svgPhoto('lamp_day') }]
      await incidentAction(sql, id, { action: 'complete', note: d.response ?? 'Работы выполнены.', photos }, 'operator', t(3 * H))
    }
    if (d.response) await incidentAction(sql, id, { action: 'respond', text: d.response }, `executor:${inc.responsible_org}`, t(2.5 * H))
    if (d.resolvedAgo) {
      if (!d.evidence) await incidentAction(sql, id, { action: 'complete', note: d.response ?? 'Работы выполнены.' }, 'operator', t(d.resolvedAgo + 10 * M))
      await incidentAction(sql, id, { action: 'resolve', force: true }, 'operator', t(d.resolvedAgo))
    }
    if (d.verify) {
      for (let k = 0; k < d.verify.yes; k++) await verifyIncident(sql, id, `demo-resident-${k}`, { answer: 'yes', quality: 4, speed: 4 }, t(d.resolvedAgo! - (k + 1) * 20 * M))
      for (let k = 0; k < d.verify.no; k++) await verifyIncident(sql, id, `demo-resident-${k}`, { answer: 'no' }, t(d.resolvedAgo! - (k + 1) * 30 * M))
    }
    if (d.returned && !d.rejectedBy) await sql`update incidents set returned_count = ${d.returned} where id = ${id}`
  }
  // Two signals waiting in the operator queue: one clear duplicate, one new.
  await submitSignal(sql, { text: '14 ш/а 23 үйде су жоқ', channel: 'KOMEK109', is_demo: true, installation_id: 'demo-resident-q1', now: new Date(now.getTime() - 2 * M) })
  await submitSignal(sql, { text: '8 мкр дом 12, затопило подвал, канализация, запах', channel: 'WHATSAPP', is_demo: true, installation_id: 'demo-resident-q2', now: new Date(now.getTime() - 6 * M) })
  await audit(sql, actor, 'incident.demo.seed', 'incident', null, null, { incidents: ids.length })
  return { incidents: ids.length }
}
