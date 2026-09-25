// Writing city state. Candidate → (dedupe) → new CityEvent or evidence on an
// existing one. Every state change writes a city_event_updates row; nothing
// important is overwritten without history. Conflicts are resolved by
// recency × authority, and the losing claim is kept as CONTRADICTING evidence.
import { duplicateScore, type DedupSubject } from '@aktau/normalization/dedup'
import { effectiveAuthority, resolveClaim, verificationFor, type SourceLike } from '@aktau/source-ranking'
import { ExtractionSchema, type Category, type EventStatus, type Extraction, type Severity } from '@aktau/types'
import { normalizeHouseNumber } from '@aktau/normalization/text'
import { audit } from './audit.ts'
import type { Sql } from './db/client.ts'
import { log } from './log.ts'
import { notifyEventChange } from './notify.ts'
import type { ChangeKind } from '@aktau/city-core'

type Tx = Sql
type SourceRow = SourceLike & { id: string; name: string }
type ItemRow = { id: string; source_id: string; published_at: Date | null; fetched_at: Date; reported_authority: string | null; is_demo: boolean; title: string | null }
type EventRow = {
  id: string; category: Category; event_type: string; status: EventStatus; starts_at: Date | null; expected_ends_at: Date | null
  actual_ends_at: Date | null; reason: string | null; reported_authority: string | null; last_confirmed_at: Date; primary_source_id: string; is_demo: boolean
}

export class PublishError extends Error {}

function severityFor(e: Extraction, buildingCount: number): Severity {
  if (e.category === 'EMERGENCY') return 'MAJOR'
  if (e.event_type === 'emergency_outage') return e.areas.length >= 3 ? 'CRITICAL' : 'MAJOR'
  if (e.areas.length >= 4) return 'MAJOR'
  if (e.category === 'ROAD') return e.event_type === 'road_closure' ? 'MODERATE' : 'MINOR'
  if (e.event_type === 'planned_outage') return buildingCount > 0 && buildingCount <= 10 ? 'MINOR' : 'MODERATE'
  return 'MINOR'
}

async function resolveAreas(tx: Tx, designators: string[]) {
  if (!designators.length) return []
  const rows = await tx<{ id: string; designator: string }[]>`select id, designator from areas where designator = any(${designators}::text[]) and area_type = 'MICRODISTRICT'`
  const missing = designators.filter((d) => !rows.some((r) => r.designator === d))
  if (missing.length) throw new PublishError(`Unknown microdistrict(s): ${missing.join(', ')}. Fix the designator in the review form.`)
  return rows
}

/** Houses the source listed. Unknown to our building index → created (point unknown) so nothing the source said is dropped. */
async function resolveBuildings(tx: Tx, houses: string[], areas: Array<{ id: string; designator: string }>) {
  const out: Array<{ id: string; area_id: string }> = []
  for (const h of houses) {
    const norm = normalizeHouseNumber(h)
    const found = await tx<{ id: string; area_id: string }[]>`select id, area_id from buildings where house_number_norm = ${norm} and area_id = any(${areas.map((a) => a.id)}::uuid[])`
    if (found.length === 1) { out.push(found[0]!); continue }
    if (found.length > 1) throw new PublishError(`House ${h} exists in several listed districts — split this notice per district.`)
    const area = areas[0]
    if (!area) throw new PublishError(`House ${h} listed without a district.`)
    const [created] = await tx<{ id: string; area_id: string }[]>`
      insert into buildings (area_id, house_number, house_number_norm, display_address, external_ids)
      select ${area.id}, ${h}, ${norm}, coalesce(a.name_ru, a.name) || ', ' || ${h}, '{"source":"announcement"}'::jsonb from areas a where a.id = ${area.id}
      on conflict (area_id, house_number_norm) do update set house_number = buildings.house_number
      returning id, area_id`
    out.push(created!)
  }
  return out
}

async function findDuplicate(tx: Tx, e: Extraction, isDemo: boolean) {
  const family: Record<string, string[]> = { WATER: ['WATER', 'HOT_WATER'], HOT_WATER: ['WATER', 'HOT_WATER'], HEATING: ['HEATING', 'GAS'], GAS: ['HEATING', 'GAS'] }
  const cats = family[e.category] ?? [e.category]
  const rows = await tx<(EventRow & { designators: string[]; houses: string[] })[]>`
    select e.id, e.category, e.event_type, e.status, e.starts_at, e.expected_ends_at, e.reason, e.reported_authority,
      coalesce(array_agg(distinct a.designator) filter (where a.designator is not null), '{}') designators,
      coalesce(array_agg(distinct b.house_number_norm) filter (where b.id is not null), '{}') houses
    from city_events e
    left join event_areas ea on ea.event_id = e.id left join areas a on a.id = ea.area_id
    left join event_buildings eb on eb.event_id = e.id left join buildings b on b.id = eb.building_id
    where e.category::text = any(${cats}::text[]) and e.is_demo = ${isDemo}
      and (e.status not in ('RESOLVED', 'CANCELLED') or e.resolved_at > now() - interval '12 hours')
      and e.created_at > now() - interval '30 days'
    group by e.id`
  const subject: DedupSubject = {
    category: e.category, event_type: e.event_type, areas: e.areas, buildings: e.buildings,
    starts_at: e.starts_at ? new Date(e.starts_at) : null, expected_ends_at: e.expected_ends_at ? new Date(e.expected_ends_at) : null,
    reason: e.reason, authority: e.authority,
  }
  let best: { id: string; score: number; verdict: string } | null = null
  for (const r of rows) {
    const s = duplicateScore(subject, {
      category: r.category, event_type: r.event_type, areas: r.designators, buildings: r.houses, starts_at: r.starts_at,
      expected_ends_at: r.expected_ends_at, reason: r.reason, authority: r.reported_authority,
    })
    if (!best || s.score > best.score) best = { id: r.id, score: s.score, verdict: s.verdict }
  }
  return best
}

export async function scoreCandidateDuplicates(sql: Sql, candidateId: string) {
  const [c] = await sql<{ extracted: Extraction; is_demo: boolean }[]>`
    select c.extracted, si.is_demo from event_candidates c join source_items si on si.id = c.source_item_id where c.id = ${candidateId}`
  if (!c) return null
  const best = await findDuplicate(sql, c.extracted, c.is_demo)
  await sql`update event_candidates set duplicate_of_event_id = ${best && best.verdict !== 'different' ? best.id : null},
    duplicate_score = ${best?.score ?? null} where id = ${candidateId}`
  return best
}

type Pending = { eventId: string; change: ChangeKind; updateId: string | null }

async function addUpdate(tx: Tx, eventId: string, u: {
  source_item_id: string | null; update_type: string; previous_status?: EventStatus | null; new_status?: EventStatus | null
  previous_expected_end?: Date | null; new_expected_end?: Date | null; message: string; actor: string
}) {
  const [r] = await tx<{ id: string }[]>`
    insert into city_event_updates (event_id, source_item_id, update_type, previous_status, new_status, previous_expected_end, new_expected_end, message, actor)
    values (${eventId}, ${u.source_item_id}, ${u.update_type}, ${u.previous_status ?? null}, ${u.new_status ?? null},
      ${u.previous_expected_end ?? null}, ${u.new_expected_end ?? null}, ${u.message}, ${u.actor}) returning id`
  return r!.id
}

/**
 * Approve an extraction candidate. `mergeInto` forces attaching to an existing
 * event; `forceNew` forces a new event even if a duplicate is detected.
 */
export async function publishCandidate(sql: Sql, candidateId: string, opts: { actor: string; edits?: Partial<Extraction>; mergeInto?: string | null; forceNew?: boolean; autoApproved?: boolean; now?: Date }) {
  const pending: Pending[] = []
  const result = await sql.begin(async (t) => {
    const tx = t as unknown as Sql
    const [c] = await tx<{ id: string; status: string; extracted: Extraction; source_item_id: string; segment_text: string }[]>`
      select id, status, extracted, source_item_id, segment_text from event_candidates where id = ${candidateId} for update`
    if (!c) throw new PublishError('Candidate not found')
    if (c.status !== 'REVIEW_REQUIRED') throw new PublishError(`Candidate already ${c.status.toLowerCase()}`)
    const parsed = ExtractionSchema.safeParse({ ...c.extracted, ...opts.edits })
    if (!parsed.success) throw new PublishError(`Invalid event: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
    const e = parsed.data
    if (e.category === 'OTHER') throw new PublishError('Choose the service category before approving.')
    if (!e.areas.length && !e.buildings.length) throw new PublishError('Add at least one microdistrict before approving.')

    const [item] = await tx<ItemRow[]>`select id, source_id, published_at, fetched_at, reported_authority, is_demo, title from source_items where id = ${c.source_item_id}`
    const [source] = await tx<SourceRow[]>`select id, slug, name, source_type, authority_level from sources where id = ${item!.source_id}`
    const authority = e.authority ?? item!.reported_authority
    const areas = await resolveAreas(tx, e.areas)
    const buildings = await resolveBuildings(tx, e.buildings, areas)

    const dup = opts.forceNew ? null : opts.mergeInto ? { id: opts.mergeInto, score: 1, verdict: 'same' } : await findDuplicate(tx, e, item!.is_demo)
    const observedAt = item!.published_at ?? item!.fetched_at

    // ── Merge into an existing event ────────────────────────────────────────
    if (dup && dup.verdict === 'same') {
      const [ev] = await tx<EventRow[]>`select * from city_events where id = ${dup.id} for update`
      if (!ev) throw new PublishError('Merge target not found')
      const [primary] = await tx<SourceRow[]>`select id, slug, name, source_type, authority_level from sources where id = ${ev.primary_source_id}`
      const current = { authority: effectiveAuthority(primary!, ev.reported_authority), observedAt: ev.last_confirmed_at }
      const incoming = { authority: effectiveAuthority(source!, authority), observedAt }
      const wantsResolve = e.event_type === 'restoration' || e.status === 'RESOLVED'
      const wantsCancel = e.status === 'CANCELLED'
      const newEnd = e.expected_ends_at ? new Date(e.expected_ends_at) : null
      const etaChanged = !wantsResolve && newEnd && (!ev.expected_ends_at || Math.abs(newEnd.getTime() - ev.expected_ends_at.getTime()) >= 60_000)
      const statusChanged = (wantsResolve && ev.status !== 'RESOLVED') || (wantsCancel && ev.status !== 'CANCELLED')
        || (!wantsResolve && !wantsCancel && e.status === 'ACTIVE' && ev.status === 'SCHEDULED')

      let relationship: 'CONFIRMING' | 'UPDATE' | 'CONTRADICTING' = 'CONFIRMING'
      if (statusChanged || etaChanged) {
        const claim = resolveClaim({ value: ev.status, ...current }, { value: e.status, ...incoming })
        if (claim.winner === 'incoming') {
          relationship = 'UPDATE'
          if (wantsResolve || wantsCancel) {
            const to: EventStatus = wantsResolve ? 'RESOLVED' : 'CANCELLED'
            const endedAt = wantsResolve ? newEnd ?? observedAt : null
            await tx`update city_events set status = ${to}, resolved_at = ${observedAt}, actual_ends_at = ${endedAt}, last_confirmed_at = greatest(last_confirmed_at, ${observedAt}) where id = ${ev.id}`
            const uid = await addUpdate(tx, ev.id, { source_item_id: item!.id, update_type: 'STATUS_CHANGED', previous_status: ev.status, new_status: to, message: `${to === 'RESOLVED' ? 'Restored' : 'Cancelled'} per ${source!.name}${authority ? ` (${authority})` : ''}.`, actor: opts.actor })
            pending.push({ eventId: ev.id, change: 'STATUS_CHANGED', updateId: uid })
          } else {
            const nextStatus: EventStatus = e.status === 'ACTIVE' && ev.status === 'SCHEDULED' ? 'ACTIVE' : etaChanged && ev.status === 'ACTIVE' && ev.expected_ends_at && newEnd! > ev.expected_ends_at ? 'DELAYED' : ev.status
            await tx`update city_events set status = ${nextStatus}, expected_ends_at = ${etaChanged ? newEnd : ev.expected_ends_at},
              official_eta = ${etaChanged ? ['OFFICIAL', 'GOVERNMENT'].includes(source!.source_type) || !!authority : false},
              last_confirmed_at = greatest(last_confirmed_at, ${observedAt}) where id = ${ev.id}`
            if (nextStatus !== ev.status) {
              const uid = await addUpdate(tx, ev.id, { source_item_id: item!.id, update_type: 'STATUS_CHANGED', previous_status: ev.status, new_status: nextStatus, message: `Status ${nextStatus.toLowerCase()} per ${source!.name}.`, actor: opts.actor })
              pending.push({ eventId: ev.id, change: 'STATUS_CHANGED', updateId: uid })
            }
            if (etaChanged) {
              const uid = await addUpdate(tx, ev.id, { source_item_id: item!.id, update_type: 'ETA_CHANGED', previous_expected_end: ev.expected_ends_at, new_expected_end: newEnd, new_status: nextStatus, message: `Restoration estimate updated by ${source!.name}${authority ? ` (${authority})` : ''}.`, actor: opts.actor })
              pending.push({ eventId: ev.id, change: 'ETA_CHANGED', updateId: uid })
            }
          }
        } else {
          relationship = 'CONTRADICTING'
          await addUpdate(tx, ev.id, { source_item_id: item!.id, update_type: 'CONFLICT_NOTED', previous_status: ev.status, new_status: ev.status, new_expected_end: newEnd, message: `${source!.name} reports differently; kept current state (${claim.reason}).`, actor: opts.actor })
        }
      } else {
        await tx`update city_events set last_confirmed_at = greatest(last_confirmed_at, ${observedAt}) where id = ${ev.id}`
        await addUpdate(tx, ev.id, { source_item_id: item!.id, update_type: 'CONFIRMED', previous_status: ev.status, new_status: ev.status, message: `Also reported by ${source!.name}.`, actor: opts.actor })
      }
      // Newly listed houses/districts extend the footprint (with history).
      for (const a of areas) {
        await tx`insert into event_areas (event_id, area_id, coverage_type)
          values (${ev.id}, ${a.id}, ${buildings.some((b) => b.area_id === a.id) ? 'BUILDINGS_ONLY' : e.partial_area ? 'PARTIAL' : 'FULL'}) on conflict do nothing`
      }
      for (const b of buildings) await tx`insert into event_buildings (event_id, building_id) values (${ev.id}, ${b.id}) on conflict do nothing`
      await tx`insert into event_sources (event_id, source_item_id, relationship) values (${ev.id}, ${item!.id}, ${relationship}) on conflict do nothing`
      await tx`update event_candidates set status = 'MERGED', created_event_id = ${ev.id}, duplicate_of_event_id = ${ev.id}, duplicate_score = ${dup.score},
        reviewed_by = ${opts.actor}, reviewed_at = now(), extracted = ${tx.json(e as never)} where id = ${c.id}`
      await tx`update source_items set processing_status = 'EXTRACTED' where id = ${item!.id}`
      await audit(tx, opts.actor, 'candidate.merge', 'city_event', ev.id, { status: ev.status, expected_ends_at: ev.expected_ends_at }, { candidate: c.id, relationship, extraction: e })
      return { event_id: ev.id, action: 'merged' as const, relationship }
    }

    // ── New event ───────────────────────────────────────────────────────────
    const now = opts.now ?? new Date()
    const starts = e.starts_at ? new Date(e.starts_at) : null
    let ends = e.expected_ends_at ? new Date(e.expected_ends_at) : null
    let status = e.status
    let actualEnd: Date | null = null
    let resolvedAt: Date | null = null
    if (e.event_type === 'restoration' || status === 'RESOLVED') { status = 'RESOLVED'; actualEnd = ends ?? observedAt; resolvedAt = observedAt; ends = null }
    if (status === 'CANCELLED') resolvedAt = observedAt
    if (status === 'SCHEDULED' && starts && starts <= now && (!ends || ends > now)) status = 'ACTIVE'
    const verification = verificationFor(source!, { reportedAuthority: authority, manualReview: !opts.autoApproved })
    const coverageFor = (areaId: string) => (buildings.some((b) => b.area_id === areaId) ? 'BUILDINGS_ONLY' : e.partial_area ? 'PARTIAL' : 'FULL')

    const [ev] = await tx<{ id: string }[]>`
      insert into city_events (category, event_type, title, summary, status, severity, starts_at, expected_ends_at, actual_ends_at, reason,
        official_eta, confidence, verification_status, reported_authority, primary_source_id, created_from_source_item_id, time_text, location_text,
        last_confirmed_at, is_demo, resolved_at)
      values (${e.category}, ${e.event_type}, ${e.title}, ${e.summary}, ${status}, ${severityFor(e, buildings.length)}, ${starts}, ${ends}, ${actualEnd}, ${e.reason},
        ${!!ends && (['OFFICIAL', 'GOVERNMENT'].includes(source!.source_type) || !!authority)}, ${e.confidence}, ${verification}, ${authority},
        ${source!.id}, ${item!.id}, ${e.time_text}, ${e.location_text}, ${observedAt}, ${item!.is_demo}, ${resolvedAt})
      returning id`
    for (const a of areas) await tx`insert into event_areas (event_id, area_id, coverage_type) values (${ev!.id}, ${a.id}, ${coverageFor(a.id)})`
    for (const b of buildings) await tx`insert into event_buildings (event_id, building_id) values (${ev!.id}, ${b.id}) on conflict do nothing`
    await tx`insert into event_sources (event_id, source_item_id, relationship) values (${ev!.id}, ${item!.id}, 'PRIMARY')`
    const uid = await addUpdate(tx, ev!.id, { source_item_id: item!.id, update_type: 'CREATED', new_status: status, new_expected_end: ends, message: `Published from ${source!.name}${authority && authority !== source!.slug.toUpperCase() ? ` (authority: ${authority})` : ''}.`, actor: opts.actor })
    pending.push({ eventId: ev!.id, change: 'CREATED', updateId: uid })
    await tx`update event_candidates set status = ${opts.autoApproved ? 'AUTO_APPROVED' : 'APPROVED'}, created_event_id = ${ev!.id}, reviewed_by = ${opts.actor},
      reviewed_at = now(), extracted = ${tx.json(e as never)}, duplicate_score = ${dup?.score ?? null} where id = ${c.id}`
    await tx`update source_items set processing_status = 'EXTRACTED' where id = ${item!.id}`
    await audit(tx, opts.actor, opts.autoApproved ? 'candidate.auto_approve' : 'candidate.approve', 'city_event', ev!.id, null, { candidate: c.id, extraction: e, edits: opts.edits ?? null })
    return { event_id: ev!.id, action: 'created' as const, relationship: 'PRIMARY' as const }
  })
  for (const p of pending) {
    await notifyEventChange(sql, p.eventId, p.change, p.updateId).catch((err) => log('error', 'notify.failed', { event_id: p.eventId, err }))
  }
  log('info', 'candidate.published', { candidate: candidateId, ...result })
  return result
}

export async function rejectCandidate(sql: Sql, candidateId: string, actor: string, note: string | null) {
  const [c] = await sql<{ id: string; status: string; source_item_id: string }[]>`update event_candidates set status = 'REJECTED', reviewed_by = ${actor}, reviewed_at = now(), review_note = ${note}
    where id = ${candidateId} and status = 'REVIEW_REQUIRED' returning id, status, source_item_id`
  if (!c) throw new PublishError('Candidate not found or already reviewed')
  const [row] = await sql<{ open: number }[]>`select count(*)::int open from event_candidates where source_item_id = ${c.source_item_id} and status = 'REVIEW_REQUIRED'`
  if (!row?.open) await sql`update source_items set processing_status = 'IGNORED' where id = ${c.source_item_id} and processing_status <> 'EXTRACTED'`
  await audit(sql, actor, 'candidate.reject', 'event_candidate', candidateId, null, { note })
}

/**
 * Manual lifecycle change by an admin (status, ETA, resolve). The admin acts
 * as the source: the change is recorded with actor and optional note.
 */
export async function adminUpdateEvent(sql: Sql, eventId: string, patch: { status?: EventStatus; expected_ends_at?: string | null; message?: string | null }, actor: string) {
  const pending: Pending[] = []
  await sql.begin(async (t) => {
    const tx = t as unknown as Sql
    const [ev] = await tx<EventRow[]>`select * from city_events where id = ${eventId} for update`
    if (!ev) throw new PublishError('Event not found')
    const before = { status: ev.status, expected_ends_at: ev.expected_ends_at }
    const now = new Date()
    if (patch.expected_ends_at !== undefined) {
      const end = patch.expected_ends_at ? new Date(patch.expected_ends_at) : null
      if (end?.getTime() !== ev.expected_ends_at?.getTime()) {
        await tx`update city_events set expected_ends_at = ${end}, official_eta = false, last_confirmed_at = ${now} where id = ${ev.id}`
        const uid = await addUpdate(tx, ev.id, { source_item_id: null, update_type: 'ETA_CHANGED', previous_expected_end: ev.expected_ends_at, new_expected_end: end, new_status: patch.status ?? ev.status, message: patch.message ?? 'Estimate updated by editor.', actor })
        pending.push({ eventId: ev.id, change: 'ETA_CHANGED', updateId: uid })
      }
    }
    if (patch.status && patch.status !== ev.status) {
      const closing = patch.status === 'RESOLVED' || patch.status === 'CANCELLED'
      await tx`update city_events set status = ${patch.status}, resolved_at = ${closing ? now : null}, actual_ends_at = ${patch.status === 'RESOLVED' ? now : null},
        last_confirmed_at = ${now} where id = ${ev.id}`
      const uid = await addUpdate(tx, ev.id, { source_item_id: null, update_type: 'STATUS_CHANGED', previous_status: ev.status, new_status: patch.status, message: patch.message ?? `Status set to ${patch.status.toLowerCase()} by editor.`, actor })
      pending.push({ eventId: ev.id, change: 'STATUS_CHANGED', updateId: uid })
    }
    await audit(tx, actor, 'event.update', 'city_event', ev.id, before, patch)
  })
  for (const p of pending) await notifyEventChange(sql, p.eventId, p.change, p.updateId).catch((err) => log('error', 'notify.failed', { event_id: p.eventId, err }))
}
