// Live demo sessions. A QR audience is one more scope: scanning the code joins
// the session (no account, no GPS: the code is the location), the presenter
// reports a problem into the session through the normal report pipeline, and
// from there it is the same incident, the same confirmations, the same
// operator flow, completion and resident verification as anywhere in Aktau.
import { randomInt } from 'node:crypto'
import { verificationOutcome } from '@aktau/city-core'
import type { Lang } from '@aktau/types'
import { audit } from './audit.ts'
import type { Sql } from './db/client.ts'
import { lite, listIncidents, sessionById, type SessionRow } from './incidents.ts'
import { registerDevice } from './me.ts'

// No 0/o, 1/l/i: the code is read aloud and typed from a projector.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

export async function createSession(sql: Sql, s: { title: string; venue: string; actor: string; lat?: number | null; lon?: number | null }) {
  for (let k = 0; k < 6; k++) {
    const [r] = await sql<{ id: string }[]>`
      insert into demo_sessions (code, title, venue, point, created_by)
      values (${newCode()}, ${s.title.trim().slice(0, 120)}, ${s.venue.trim().slice(0, 120)},
        ${s.lat != null && s.lon != null ? sql`ST_SetSRID(ST_MakePoint(${s.lon}, ${s.lat}), 4326)::geography` : null}, ${s.actor})
      on conflict (code) do nothing returning id`
    if (r) {
      await audit(sql, s.actor, 'live.create', 'demo_session', r.id, null, { title: s.title, venue: s.venue })
      return (await sessionById(sql, r.id))!
    }
  }
  throw new Error('Could not allocate a session code')
}

export async function listSessions(sql: Sql, limit = 20) {
  const rows = await sql<(SessionRow & { members: number; incidents: number })[]>`
    select s.id, s.code, s.title, s.venue, null::float8 lat, null::float8 lon, s.status, s.created_by, s.created_at, s.ended_at,
      (select count(*)::int from demo_session_members m where m.session_id = s.id) members,
      (select count(*)::int from incidents i where i.demo_session_id = s.id) incidents
    from demo_sessions s order by s.created_at desc limit ${limit}`
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString(), ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null }))
}

export async function endSession(sql: Sql, idOrCode: string, actor: string) {
  const s = await sessionById(sql, idOrCode)
  if (!s) return null
  await sql`update demo_sessions set status = 'ended', ended_at = now() where id = ${s.id} and status = 'active'`
  await sql`insert into realtime_outbox (topic, kind, entity_id, payload) values ('incidents', 'session_ended', ${s.id}, ${sql.json({ session: s.id })})`
  await audit(sql, actor, 'live.end', 'demo_session', s.id, null, null)
  return { id: s.id }
}

/** Deletes a session with everything reported into it (demo data only). */
export async function deleteSession(sql: Sql, idOrCode: string, actor: string) {
  const s = await sessionById(sql, idOrCode)
  if (!s) return null
  await sql`delete from demo_sessions where id = ${s.id}`
  await audit(sql, actor, 'live.delete', 'demo_session', s.id, null, { code: s.code })
  return { id: s.id }
}

/** Scanning the QR code: the installation joins the session's audience. */
export async function joinSession(sql: Sql, code: string, installationId: string, lang: Lang) {
  const s = await sessionById(sql, code)
  if (!s) return null
  if (s.status !== 'active') return { session: s, joined: false }
  await registerDevice(sql, { installation_id: installationId, platform: 'web', language: lang })
  await sql`insert into demo_session_members (session_id, installation_id) values (${s.id}, ${installationId})
    on conflict (session_id, installation_id) do update set last_seen_at = now()`
  return { session: s, joined: true }
}

/**
 * Everything a screen in the session needs, from the database: the audience
 * phone (its own relation to each problem) and the presenter (live counts,
 * verification, the final tally). Staff-created signals never count as residents.
 */
export async function sessionState(sql: Sql, code: string, installationId: string | null) {
  const s = await sessionById(sql, code)
  if (!s) return null
  const [counts, list, mine] = await Promise.all([
    sql<{ members: number }[]>`select count(*)::int members from demo_session_members where session_id = ${s.id}`,
    listIncidents(sql, { sessionId: s.id, limit: 20 }),
    installationId
      ? sql<{ id: string; member: boolean; relation: string | null; my_answer: string | null }[]>`
          select i.id, exists (select 1 from demo_session_members m where m.session_id = ${s.id} and m.installation_id = ${installationId}) member,
            case when exists (select 1 from incident_signals x where x.incident_id = i.id and x.installation_id = ${installationId} and x.origin = 'resident') then 'reporter'
              when exists (select 1 from incident_signals x where x.incident_id = i.id and x.installation_id = ${installationId}) then 'staff_reporter'
              else (select c.state from incident_confirmations c where c.incident_id = i.id and c.installation_id = ${installationId}) end relation,
            (select v.answer from incident_verifications v where v.incident_id = i.id and v.installation_id = ${installationId} and v.round = i.verify_round) my_answer
          from incidents i where i.demo_session_id = ${s.id}`
      : Promise.resolve([]),
  ])
  const member = installationId ? (await sql<{ n: number }[]>`select count(*)::int n from demo_session_members where session_id = ${s.id} and installation_id = ${installationId}`)[0]!.n > 0 : false
  const byId = new Map(mine.map((m) => [m.id, m]))
  const incidents = list.filter((i) => !i.merged_into_id).sort((a, b) => b.first_signal_at.localeCompare(a.first_signal_at)).map((i) => {
    const m = byId.get(i.id)
    const relation = (m?.relation ?? null) as 'reporter' | 'staff_reporter' | 'confirmed' | 'not_affected' | 'withdrawn' | null
    const eligible = relation === 'reporter' || relation === 'confirmed'
    const verifying = ['EVIDENCE_SUBMITTED', 'RESOLVED', 'VERIFIED'].includes(i.status) && i.verify_round > 0
    return {
      ...lite(i), relation, my_answer: m?.my_answer ?? null,
      ask: verifying && eligible && !m?.my_answer && i.status !== 'VERIFIED' ? 'verify' as const
        : member && !relation && ['NEW', 'ROUTED', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED'].includes(i.status) ? 'confirm' as const : null,
    }
  })
  const current = incidents.find((i) => i.status !== 'REJECTED') ?? null
  let live: null | {
    timeline: Array<{ id: string; kind: string; message: string; source: string; data: Record<string, unknown>; created_at: string }>
    participants: number; resident_signals: number; eligible: number; outcome: string; quorum: number
  } = null
  if (current) {
    const [tl, [p]] = await Promise.all([
      sql<{ id: string; kind: string; message: string; source: string; data: Record<string, unknown>; created_at: Date }[]>`
        select id, kind, message, source, data, created_at from incident_timeline where incident_id = ${current.id} and visibility = 'public' order by created_at, seq`,
      sql<{ participants: number; resident_signals: number; eligible: number }[]>`
        select
          (select count(distinct x.iid)::int from (
            select installation_id iid from incident_confirmations where incident_id = ${current.id} and state = 'confirmed'
            union select installation_id from incident_verifications where incident_id = ${current.id}
            union select installation_id from incident_signals where incident_id = ${current.id} and origin = 'resident' and installation_id is not null) x) participants,
          ((select count(*) from incident_signals where incident_id = ${current.id} and origin = 'resident')
            + (select count(*) from incident_confirmations where incident_id = ${current.id} and state = 'confirmed'))::int resident_signals,
          (select count(*)::int from (select installation_id from incident_signals where incident_id = ${current.id} and installation_id is not null and origin = 'resident'
            union select installation_id from incident_confirmations where incident_id = ${current.id} and state = 'confirmed') e) eligible`,
    ])
    const out = verificationOutcome({ yes: current.verify_yes, partial: current.verify_partial, no: current.verify_no, eligible: p!.eligible })
    live = {
      timeline: tl.map((x) => ({ ...x, created_at: new Date(x.created_at).toISOString() })),
      participants: p!.participants, resident_signals: p!.resident_signals, eligible: p!.eligible, outcome: out.state, quorum: out.quorum,
    }
  }
  return {
    session: { id: s.id, code: s.code, title: s.title, venue: s.venue, status: s.status, created_at: new Date(s.created_at).toISOString() },
    members: counts[0]!.members,
    member,
    incidents,
    current,
    live,
    generated_at: new Date().toISOString(),
  }
}
export type SessionStateDTO = NonNullable<Awaited<ReturnType<typeof sessionState>>>
