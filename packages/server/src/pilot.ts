// Pilot simulation: a week of 10 000 resident messages through the 109 engine.
//
//   scenario (pilot-scenario.ts)  what really happened + what people sent about it
//   engine   (this file)          the same decisions the live system makes, in memory:
//                                 intake → place → "already reported?" (matching) → attach /
//                                 confirm / new incident → scope → priority → route →
//                                 anti-spam gate → team completes → residents verify
//   metrics  (this file)          every number is checked against the ground truth
//
// The decisions call the same city-core functions as packages/server/src/incidents.ts
// and report-check.ts (intake, bestMatches, inferScope, incidentAffects,
// assessPriority, route, spamRules, reportDecision, verificationOutcome).
// What the database does there (find the building, list open incidents, grow a
// scope, count buildings in a radius) is mirrored here rule for rule; the
// tests/pilot.test.ts cross-check runs the same reports through the real
// database pipeline and compares the result.
//
// Honest limits: the texts are generated from templates (real messages vary
// more); AI review is not called (rules only); every "same problem?" question
// a resident or operator would answer is decided by the engine alone
// (it attaches at ≥ 80 % and opens a new incident below), which is stricter
// than the pilot, where people and operators correct it.
import {
  MATCH_LIKELY, MATCH_POSSIBLE, assessPriority, bestMatches, contentWords, incidentAffects, incidentTitle, inferScope, intake as runIntake,
  metresBetween, normaliseReport, photoRequirement, reportDecision, route as runRoute, spamRules, verificationOutcome,
  type IncidentService, type Intake, type OpenIncident, type PriorityLevel, type PriorityReason, type Route, type ScopeKind, type ScopeProposal,
} from '@aktau/city-core'
import type { Sql } from './db/client.ts'
import { loadPilotCity, resolveSimPlace, type PilotCity, type SimPlace } from './pilot-city.ts'
import { generateScenario, rngFrom, specOf, zoneUsers, type Channel, type Report, type Scenario, type ScenarioOptions } from './pilot-scenario.ts'

const H = 3600_000
const M = 60_000
const CLOSED = new Set(['RESOLVED', 'VERIFIED', 'REJECTED'])
const OUTAGE = new Set<IncidentService>(['water', 'hot_water', 'electricity', 'heating'])
const RELATED: Array<[IncidentService, IncidentService]> = [['water', 'hot_water'], ['heating', 'hot_water'], ['sewer', 'water']]
const related = (a: IncidentService, b: IncidentService) => a === b || RELATED.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

// ── The in-memory 109 store ──────────────────────────────────────────────────
type Status = 'NEW' | 'ROUTED' | 'EVIDENCE_SUBMITTED' | 'DISPUTED' | 'RESOLVED' | 'VERIFIED' | 'REJECTED'

export type SimIncident = {
  n: number; code: string; service: IncidentService; kind: Intake['kind']; status: Status
  area_id: string | null; building: number | null; lat: number | null; lon: number | null
  first_signal_at: number; last_signal_at: number; updated_at: number; created_at: number
  signal_count: number; confirm_count: number
  words: string[]
  risk_flags: string[]
  /** Intakes of the incident's signals (risk and flags feed the priority). */
  signal_risk: Intake['risk'][]; signal_flags: Set<string>; floor: PriorityLevel
  scope: { kind: ScopeKind | null; radius_m: number | null; source: 'inferred' | 'operator' }
  scopeBuildings: Set<number>; scopeAreas: Set<string>
  priority: PriorityLevel; priority_score: number; priority_reasons: PriorityReason[]
  route: Route; route_at_create: Route; rerouted: boolean
  previous: number | null
  routed_at: number | null; completed_at: number | null; verified_at: number | null; resolved_at: number | null
  verify_round: number; yes: number; partial: number; no: number; answered: Set<number>; reopen_count: number
  fake_closures: number; fake_caught: number
  /** Report ids that reached it (signals and confirmations), and whose they are. */
  reports: number[]; signalReporters: Set<number>; confirmers: Set<number>
  /** App users who follow it: residents who reported from the app or confirmed. */
  followers: Map<number, number>
  first_match: { incident: number; score: number; reasons: string[] } | null
  /** The first report had a shared location and no address: its point is precise without a building. */
  gps: boolean
  /** The report check flagged it (e.g. a burst from one phone). */
  flagged: boolean
  had_critical_at_first_report: boolean
  warned: number
}

type Preview = { intake: Intake; place: SimPlace; matches: Array<{ incident: SimIncident; score: number; reasons: string[] }>; scope: ScopeProposal; words: string[] }

class Store {
  incidents: SimIncident[] = []
  private byService = new Map<IncidentService, SimIncident[]>()
  private history = new Map<string, number>()

  constructor(private city: PilotCity, private sc: Scenario) {}

  /** openIncidents(): not verified/rejected, or changed in the last 24 h; never merged. */
  private candidates(service: IncidentService, now: number): SimIncident[] {
    const out: SimIncident[] = []
    for (const [s, list] of this.byService) {
      if (!related(s, service)) continue
      for (const i of list) if (!(i.status === 'VERIFIED' || i.status === 'REJECTED') || i.updated_at > now - 24 * H) out.push(i)
    }
    // openIncidents(): oldest first, so equal scores go to the older incident.
    return out.sort((a, b) => a.n - b.n)
  }

  private asOpen(i: SimIncident, at: { lat: number; lon: number } | null): OpenIncident {
    const precise = i.building != null || i.gps
    const a = i.area_id ? this.city.areaById.get(i.area_id) : null
    const b = i.building != null ? this.city.buildings[i.building]! : null
    // openIncidents(): distance from a precise report to the incident's point (if precise) or any building in its scope.
    let near: number | null = null
    if (at) {
      if (precise && i.lat != null && i.lon != null) near = metresBetween(at, { lat: i.lat, lon: i.lon })
      for (const sb of i.scopeBuildings) { const x = this.city.buildings[sb]!; const d = metresBetween(at, { lat: x.lat, lon: x.lon }); if (near == null || d < near) near = d }
    }
    return {
      id: String(i.n), code: i.code, service: i.service, status: i.status, area_id: i.area_id, designator: a?.designator ?? null, house: b?.house ?? null,
      last_signal_at: new Date(i.last_signal_at).toISOString(), first_signal_at: new Date(i.first_signal_at).toISOString(), signal_count: i.signal_count,
      confirm_count: i.confirm_count, lat: i.lat, lon: i.lon, precise, kind: i.kind, words: i.words, session_id: null, near_m: near,
    }
  }

  preview(text: string, now: number, gps: { lat: number; lon: number } | null): Preview {
    const i = runIntake(text, new Date(now))
    const place = resolveSimPlace(this.city, i.designator, i.house, gps)
    const words = contentWords(text)
    const precise = place.building != null || (gps != null && !i.designator)
    const at = precise && place.lat != null && place.lon != null ? { lat: place.lat, lon: place.lon } : null
    const open = this.candidates(i.service, now).map((c) => this.asOpen(c, at))
    const matches = bestMatches({
      service: i.service, designator: i.designator, house: i.house, area_id: place.area_id, at: new Date(now), lat: place.lat, lon: place.lon,
      precise, kind: i.kind, words, session_id: null,
    }, open, place.area_id ? this.city.adjacency.get(place.area_id) ?? new Set() : new Set())
      .map((m) => ({ incident: this.incidents[Number(m.incident.id)]!, score: m.score, reasons: m.reasons }))
    const scope = inferScope(i, { building_id: place.building != null ? 'b' : null, area_id: place.area_id, has_point: place.lat != null && place.lon != null })
    return { intake: i, place, matches, scope, words }
  }

  private routingHistory(service: IncidentService, areaId: string | null): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [k, n] of this.history) {
      const [s, a, org] = k.split('|')
      if (s === service && (!areaId || a === areaId)) out[org!] = (out[org!] ?? 0) + n
    }
    return out
  }
  noteResolved(i: SimIncident) { const k = `${i.service}|${i.area_id}|${i.route.org}`; this.history.set(k, (this.history.get(k) ?? 0) + 1) }

  /** createFromSignal() */
  create(r: Report, p: Preview, now: number, gps = false): SimIncident {
    const i = p.intake
    const prev = this.previousAtPlace(i.service, p.place, now)
    const route = runRoute(i, this.routingHistory(i.service, p.place.area_id))
    const inc: SimIncident = {
      n: this.incidents.length, code: `SIM-${String(this.incidents.length + 1).padStart(4, '0')}`, service: i.service, kind: i.kind, status: 'NEW',
      area_id: p.place.area_id, building: p.place.building, lat: p.place.lat, lon: p.place.lon,
      first_signal_at: i.started_at ? Math.min(new Date(i.started_at).getTime(), now) : now, last_signal_at: now, updated_at: now, created_at: now,
      signal_count: 1, confirm_count: 0, words: p.words, risk_flags: [...i.risk_flags], signal_risk: [i.risk], signal_flags: new Set(i.risk_flags), floor: i.priority,
      scope: { kind: p.scope.kind, radius_m: p.scope.radius_m, source: 'inferred' }, scopeBuildings: new Set(), scopeAreas: new Set(),
      priority: i.priority, priority_score: 0, priority_reasons: [],
      route, route_at_create: route, rerouted: false,
      previous: prev?.n ?? null, routed_at: null, completed_at: null, verified_at: null, resolved_at: null,
      verify_round: 0, yes: 0, partial: 0, no: 0, answered: new Set(), reopen_count: 0, fake_closures: 0, fake_caught: 0,
      reports: [r.id], signalReporters: new Set(r.resident != null ? [r.resident] : []), confirmers: new Set(), followers: new Map(),
      first_match: p.matches[0] ? { incident: p.matches[0].incident.n, score: p.matches[0].score, reasons: p.matches[0].reasons } : null,
      gps: gps && !i.designator, flagged: false, had_critical_at_first_report: false, warned: 0,
    }
    if (r.resident != null) inc.followers.set(r.resident, r.id)
    // applyScope()
    if ((p.scope.kind === 'building' || p.scope.kind === 'buildings') && p.place.building != null && p.scope.reason !== 'one_household') inc.scopeBuildings.add(p.place.building)
    if ((p.scope.kind === 'area' || p.scope.kind === 'areas') && p.place.area_id) inc.scopeAreas.add(p.place.area_id)
    this.incidents.push(inc)
    if (!this.byService.has(inc.service)) this.byService.set(inc.service, [])
    this.byService.get(inc.service)!.push(inc)
    this.refreshPriority(inc, now)
    inc.had_critical_at_first_report = inc.priority === 'CRITICAL'
    return inc
  }

  /** attach(): one more signal on an existing incident. */
  attach(inc: SimIncident, r: Report, p: Preview, now: number) {
    inc.signal_count++
    inc.last_signal_at = Math.max(inc.last_signal_at, now)
    inc.updated_at = now
    inc.reports.push(r.id)
    inc.signal_risk.push(p.intake.risk)
    for (const f of p.intake.risk_flags) inc.signal_flags.add(f)
    if (r.resident != null) { inc.signalReporters.add(r.resident); inc.followers.set(r.resident, r.id) }
    if (p.place.building != null && p.intake.scope !== 'household') this.growScope(inc, p.place.building)
    this.refreshPriority(inc, now)
  }

  /** confirmIncident(): "Yes, it is the same problem" from the app. */
  confirm(inc: SimIncident, r: Report, now: number, sharedLocation: boolean): 'confirmed' | 'already_reported' | 'unchanged' | 'resolved' {
    const res = r.resident!
    if (inc.status === 'RESOLVED' || inc.status === 'VERIFIED') return 'resolved'
    if (inc.signalReporters.has(res)) return 'already_reported'
    if (inc.confirmers.has(res)) return 'unchanged'
    inc.confirmers.add(res)
    inc.followers.set(res, r.id)
    inc.confirm_count++
    inc.reports.push(r.id)
    inc.last_signal_at = Math.max(inc.last_signal_at, now)
    inc.updated_at = now
    const who = this.sc.residents[res]!
    // With a shared location the answer is recorded as "here" / "elsewhere": only a saved home grows the scope.
    if (who.hasHome && !sharedLocation) {
      const b = this.city.buildings[who.building]!
      const aff = incidentAffects(this.scopeFacts(inc, { building: who.building, lat: b.lat, lon: b.lon }), { building_id: String(who.building), area_ids: b.area_id ? [b.area_id] : [] })
      if (aff.relevance === 'DIRECT') this.growScope(inc, who.building)
      else if (aff.relevance === 'NEARBY' && OUTAGE.has(inc.service) && inc.kind === 'outage') this.growScope(inc, who.building)
    }
    this.refreshPriority(inc, now)
    return 'confirmed'
  }

  /** growScope(): a house joins near the first report (500 m) or next to a house already in the outage (300 m). */
  private growScope(inc: SimIncident, building: number) {
    if (!(inc.scope.kind === 'building' || inc.scope.kind === 'buildings') || inc.scope.source !== 'inferred') return
    if (inc.scopeBuildings.has(building)) return
    const b = this.city.buildings[building]!
    const nearPoint = inc.lat == null || inc.lon == null || metresBetween({ lat: b.lat, lon: b.lon }, { lat: inc.lat, lon: inc.lon }) <= 500
    const nextTo = !nearPoint && [...inc.scopeBuildings].some((x) => { const y = this.city.buildings[x]!; return metresBetween({ lat: b.lat, lon: b.lon }, { lat: y.lat, lon: y.lon }) <= 300 })
    if (!nearPoint && !nextTo) return
    inc.scopeBuildings.add(building)
    inc.scope.kind = 'buildings'
    this.maybeReroute(inc)
  }

  /**
   * suggestNetworkRoute(): an outage in several houses is the network's, not one house's.
   * Before assignment the suggestion changes; after it the Copilot asks 109 to re-route,
   * and the simulated operator does.
   */
  private maybeReroute(inc: SimIncident) {
    if (!REROUTE || inc.scopeBuildings.size < 2 || !['water', 'sewer', 'hot_water', 'heating', 'electricity'].includes(inc.service)) return
    if (['RESOLVED', 'VERIFIED', 'REJECTED', 'EVIDENCE_SUBMITTED'].includes(inc.status)) return
    const next = runRoute({ service: inc.service, scope: 'multiple', risk: 'none', risk_flags: inc.risk_flags, designator: null, house: null, kind: inc.kind })
    if (next.org !== inc.route.org) { inc.route = next; inc.rerouted = true }
  }

  scopeFacts(inc: SimIncident, where: { building: number | null; lat: number | null; lon: number | null }) {
    const d = where.lat != null && where.lon != null && inc.lat != null && inc.lon != null ? metresBetween({ lat: where.lat, lon: where.lon }, { lat: inc.lat, lon: inc.lon }) : null
    return { kind: inc.scope.kind, radius_m: inc.scope.radius_m, building_ids: [...inc.scopeBuildings].map(String), area_ids_full: [...inc.scopeAreas], session_id: null, distance_m: d }
  }

  /** refreshPriority() */
  refreshPriority(inc: SimIncident, now: number) {
    const risk: Intake['risk'] = inc.signal_risk.includes('imminent') ? 'imminent' : inc.signal_risk.includes('elevated') ? 'elevated' : 'none'
    const buildings = inc.scope.kind === 'building' || inc.scope.kind === 'buildings' ? inc.scopeBuildings.size
      : inc.scope.kind === 'radius' && inc.lat != null && inc.lon != null ? this.city.grid.within(inc.lat, inc.lon, inc.scope.radius_m ?? 200).length : 0
    const sensitive = inc.lat == null || inc.lon == null ? [] : [...new Set(this.city.sensitive.filter((s) => metresBetween({ lat: s.lat, lon: s.lon }, { lat: inc.lat!, lon: inc.lon! }) <= 150).map((s) => s.kind))]
    const pr = assessPriority({
      service: inc.service, kind: inc.kind, risk, risk_flags: [...new Set([...inc.risk_flags, ...inc.signal_flags])], scope_kind: inc.scope.kind,
      buildings, areas_full: inc.scopeAreas.size, residents: inc.signal_count + inc.confirm_count, first_signal_at: new Date(inc.first_signal_at).toISOString(),
      recurring: inc.previous != null, sensitive, official: false, floor: inc.floor, now: new Date(now),
    })
    inc.priority = pr.level
    inc.priority_score = pr.score
    inc.priority_reasons = pr.reasons
  }

  /** previousAtPlace(): the same problem closed at the same place (a street problem: the same spot, 150 m) in the last 60 days. */
  private previousAtPlace(service: IncidentService, place: SimPlace, now: number): SimIncident | null {
    if (place.building == null && !place.area_id) return null
    const spot = ['streetlight', 'garbage', 'road', 'yard', 'transport'].includes(service) && place.lat != null && place.lon != null
    let best: SimIncident | null = null
    for (const i of this.byService.get(service) ?? []) {
      if (!(i.status === 'RESOLVED' || i.status === 'VERIFIED')) continue
      const closed = i.verified_at ?? i.resolved_at ?? 0
      if (closed < now - 60 * 86400_000) continue
      if (spot ? i.lat == null || i.lon == null || metresBetween({ lat: i.lat, lon: i.lon }, { lat: place.lat!, lon: place.lon! }) > 150
        : place.building != null ? i.building !== place.building : !(i.area_id === place.area_id && i.building == null)) continue
      if (!best || closed > (best.verified_at ?? best.resolved_at ?? 0)) best = i
    }
    return best
  }

  /** App users whose saved home is inside the scope (nearbyFor: DIRECT). Unclassified reports are not put to neighbours. */
  audience(inc: SimIncident): number[] {
    if (inc.service === 'other') return []
    const out = new Set<number>()
    const homes = (bs: Iterable<number>) => { for (const b of bs) for (const u of this.sc.residentsIn.get(b) ?? []) if (this.sc.residents[u]!.hasHome) out.add(u) }
    switch (inc.scope.kind) {
      case 'building': case 'buildings': homes(inc.scopeBuildings); break
      case 'area': case 'areas': for (const a of inc.scopeAreas) homes(this.city.buildingsIn.get(a) ?? []); break
      case 'radius': if (inc.lat != null && inc.lon != null) homes(this.city.grid.within(inc.lat, inc.lon, inc.scope.radius_m ?? 200)); break
      default: break
    }
    return [...out]
  }
}

/** The simulation's own switch for the "route follows the evidence" rule (the live engine has it too). */
let REROUTE = true

// ── Time ordered events (team, operator, residents) ──────────────────────────
type Ev =
  | { t: number; kind: 'assign'; inc: number }
  | { t: number; kind: 'complete'; inc: number; fake: boolean }
  | { t: number; kind: 'answer'; inc: number; resident: number; round: number }
  | { t: number; kind: 'close'; inc: number; round: number }
  | { t: number; kind: 'reject'; inc: number }

class Heap {
  private a: Ev[] = []
  push(e: Ev) { const a = this.a; a.push(e); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p]!.t <= a[i]!.t) break; [a[p], a[i]] = [a[i]!, a[p]!]; i = p } }
  peek() { return this.a[0] }
  pop(): Ev | undefined {
    const a = this.a
    if (!a.length) return undefined
    const top = a[0]!, last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l]!.t < a[m]!.t) m = l; if (r < a.length && a[r]!.t < a[m]!.t) m = r; if (m === i) break; [a[m], a[i]] = [a[i]!, a[m]!]; i = m }
    }
    return top
  }
}

// ── The run ──────────────────────────────────────────────────────────────────
export type PilotOptions = {
  reports?: number; days?: number; seed?: number; spamShare?: number; now?: Date; reroute?: boolean
  /** false: no team, operator or resident steps (every incident stays new), for the database cross-check. */
  lifecycle?: boolean
  debug?: boolean
}
export type Progress = { processed: number; total: number; incidents: number; joined: number; blocked: number; ms: number }

type Brief = { intake: Pick<Intake, 'service' | 'designator' | 'house' | 'risk' | 'lang'>; place_area: string | null; place_building: number | null }
type Outcome = Brief & {
  action: 'created' | 'attached' | 'confirmed' | 'repeat' | 'blocked' | 'stopped'
  incident: number | null; score: number | null; reasons: string[]; code?: string; retried?: 'home_button' | 'gps' | 'operator_address'
  /** The reading of the words as sent (before any address was added). */
  first: Brief
  /** What finally went in (after the resident or operator added a place): replayed by the database cross-check. */
  input: { text: string; lat: number | null; lon: number | null }
}

export async function runPilot(sql: Sql, o: PilotOptions = {}, onProgress?: (p: Progress) => void | Promise<void>) {
  const t0 = performance.now()
  const city = await loadPilotCity(sql)
  const loadMs = performance.now() - t0
  const result = await simulatePilot(city, o, onProgress)
  return { ...result, timing: { ...result.timing, load_ms: Math.round(loadMs) } }
}

export async function simulatePilot(city: PilotCity, o: PilotOptions = {}, onProgress?: (p: Progress) => void | Promise<void>) {
  const opts: Required<Omit<PilotOptions, 'now' | 'spamShare' | 'reroute' | 'debug' | 'lifecycle'>> & { now: number; spamShare: number } = {
    reports: Math.max(200, Math.min(50_000, Math.round(o.reports ?? 10_000))), days: Math.max(1, Math.min(30, o.days ?? 7)), seed: o.seed ?? 2026,
    now: (o.now ?? new Date()).getTime(), spamShare: o.spamShare ?? 0.04,
  }
  REROUTE = o.reroute ?? true
  const tg = performance.now()
  const sc = generateScenario(city, { reports: opts.reports, days: opts.days, seed: opts.seed, now: opts.now, spamShare: opts.spamShare } satisfies ScenarioOptions)
  const genMs = performance.now() - tg
  const r = rngFrom(opts.seed ^ 0x5eed)
  const store = new Store(city, sc)
  const heap = new Heap()
  const outcomes: Outcome[] = new Array(sc.reports.length)
  const stored = new Map<number, Array<{ at: number; norm: string; code: string | null }>>()
  const steps = { assigned: 0, verify_request: 0, verified: 0, reopened: 0, resolved: 0, rejected: 0 }
  const messages = { followers: 0, warnings: 0 }
  const lifecycle = { completed: 0, fake: 0, fake_caught: 0, verified: 0, reopened: 0, resolved_by_operator: 0, rejected: 0, answers: 0 }
  let engineMs = 0

  const problemOf = (reportId: number) => sc.reports[reportId]!.problem
  const majority = (inc: SimIncident): number | null => {
    const c = new Map<number, number>()
    for (const id of inc.reports) { const p = problemOf(id); if (p != null) c.set(p, (c.get(p) ?? 0) + 1) }
    let best: number | null = null, bn = 0
    for (const [p, n] of c) if (n > bn) { best = p; bn = n }
    return best
  }
  const notify = (inc: SimIncident, step: keyof typeof steps) => { steps[step]++; messages.followers += inc.followers.size }

  const assignDelay = (p: PriorityLevel) => (p === 'CRITICAL' ? r.real(4, 20) * M : p === 'HIGH' ? r.real(15, 90) * M : p === 'NORMAL' ? r.real(1, 6) * H : r.real(2, 12) * H)

  const handle = (e: Ev) => {
    const inc = store.incidents[e.inc]!
    switch (e.kind) {
      case 'assign': {
        if (inc.status !== 'NEW') return
        const truth0 = majority(inc)
        if (truth0 == null && (inc.service === 'other' || inc.flagged)) { inc.status = 'REJECTED'; inc.updated_at = e.t; lifecycle.rejected++; notify(inc, 'rejected'); return }
        inc.status = 'ROUTED'; inc.routed_at = e.t; inc.updated_at = e.t
        notify(inc, 'assigned')
        if (inc.priority === 'CRITICAL') { const aud = store.audience(inc); inc.warned = aud.length; messages.warnings += aud.length }
        const truth = majority(inc)
        if (truth == null) { heap.push({ t: e.t + r.real(0.5, 4) * H, kind: 'reject', inc: inc.n }); return }
        const p = sc.problems[truth]!
        const fake = p.end - e.t > 3 * H && r.chance(0.1)
        const at = fake ? e.t + r.real(1 * H, (p.end - e.t) * 0.6) : Math.max(p.end, e.t + 30 * M) + r.real(0, 45) * M
        if (at < sc.end) heap.push({ t: at, kind: 'complete', inc: inc.n, fake })
        return
      }
      case 'complete': {
        if (!(inc.status === 'ROUTED' || inc.status === 'DISPUTED')) return
        inc.status = 'EVIDENCE_SUBMITTED'; inc.completed_at = e.t; inc.updated_at = e.t
        inc.verify_round++; inc.yes = inc.partial = inc.no = 0; inc.answered = new Set()
        lifecycle.completed++
        if (e.fake) { inc.fake_closures++; lifecycle.fake++ }
        notify(inc, 'verify_request')
        for (const res of inc.followers.keys()) if (r.chance(0.55)) { const t = e.t + r.exp(2.5 * H); if (t < sc.end) heap.push({ t, kind: 'answer', inc: inc.n, resident: res, round: inc.verify_round }) }
        heap.push({ t: e.t + 24 * H, kind: 'close', inc: inc.n, round: inc.verify_round })
        return
      }
      case 'answer': {
        if (e.round !== inc.verify_round || !['EVIDENCE_SUBMITTED', 'RESOLVED', 'VERIFIED'].includes(inc.status) || inc.answered.has(e.resident)) return
        const pid = problemOf(inc.followers.get(e.resident)!)
        if (pid == null) return
        const fixed = e.t >= sc.problems[pid]!.end
        const ans = fixed ? r.weighted([['yes', 94], ['partial', 4], ['no', 2]] as const) : r.weighted([['no', 85], ['partial', 10], ['yes', 5]] as const)
        inc.answered.add(e.resident)
        inc[ans]++
        lifecycle.answers++
        const out = verificationOutcome({ yes: inc.yes, partial: inc.partial, no: inc.no, eligible: inc.followers.size })
        if (out.state === 'verified' && inc.status !== 'VERIFIED') {
          inc.status = 'VERIFIED'; inc.verified_at = e.t; inc.resolved_at ??= e.t; inc.updated_at = e.t
          lifecycle.verified++; notify(inc, 'verified'); store.noteResolved(inc)
        } else if (out.state === 'reopen') {
          inc.status = 'DISPUTED'; inc.reopen_count++; inc.verified_at = null; inc.updated_at = e.t
          lifecycle.reopened++; notify(inc, 'reopened')
          if (inc.fake_closures > inc.fake_caught) { inc.fake_caught++; lifecycle.fake_caught++ }
          const truth = majority(inc)
          if (truth != null) {
            const at = Math.max(sc.problems[truth]!.end, e.t + H) + r.real(0, 60) * M
            if (at < sc.end) heap.push({ t: at, kind: 'complete', inc: inc.n, fake: false })
          }
        }
        return
      }
      case 'close': {
        if (e.round !== inc.verify_round || inc.status !== 'EVIDENCE_SUBMITTED') return
        inc.status = 'RESOLVED'; inc.resolved_at = e.t; inc.updated_at = e.t
        lifecycle.resolved_by_operator++; notify(inc, 'resolved'); store.noteResolved(inc)
        return
      }
      case 'reject': {
        if (CLOSED.has(inc.status)) return
        inc.status = 'REJECTED'; inc.updated_at = e.t
        lifecycle.rejected++; notify(inc, 'rejected')
      }
    }
  }
  const drain = (until: number) => { while (heap.peek() && heap.peek()!.t <= until) handle(heap.pop()!) }

  const created = (inc: SimIncident, t: number) => { if (o.lifecycle !== false) heap.push({ t: t + assignDelay(inc.priority), kind: 'assign', inc: inc.n }) }

  let joined = 0, blocked = 0
  for (const rep of sc.reports) {
    drain(rep.at)
    const te = performance.now()
    outcomes[rep.id] = processReport(store, sc, city, rep, stored, created)
    engineMs += performance.now() - te
    const oc = outcomes[rep.id]!
    if (oc.action === 'attached' || oc.action === 'confirmed' || oc.action === 'repeat') joined++
    if (oc.action === 'blocked' || oc.action === 'stopped') blocked++
    if (onProgress && (rep.id + 1) % 500 === 0) {
      await onProgress({ processed: rep.id + 1, total: sc.reports.length, incidents: store.incidents.length, joined, blocked, ms: Math.round(engineMs) })
    }
  }
  drain(sc.end)
  const metrics = measure(city, sc, store, outcomes, majority)
  if (o.debug) Object.assign(metrics, { debug: { sc, outcomes, incidents: store.incidents } })
  return {
    params: { reports: opts.reports, days: opts.days, seed: opts.seed, spam_share: opts.spamShare, start: new Date(sc.start).toISOString(), end: new Date(sc.end).toISOString() },
    city: { microdistricts: city.areas.length, buildings: city.buildings.length, app_users: sc.residents.length, with_saved_home: sc.residents.filter((x) => x.hasHome).length, sensitive_places: city.sensitive.length },
    ...metrics,
    lifecycle: { ...lifecycle, steps, messages, still_open: store.incidents.filter((i) => !CLOSED.has(i.status)).length },
    timing: { generate_ms: Math.round(genMs), engine_ms: Math.round(engineMs), per_report_ms: Number((engineMs / sc.reports.length).toFixed(3)) },
  }
}
export type PilotResult = Awaited<ReturnType<typeof simulatePilot>> & { timing: { load_ms?: number } }

// ── One message through the engine ───────────────────────────────────────────
function processReport(store: Store, sc: Scenario, city: PilotCity, rep: Report, stored: Map<number, Array<{ at: number; norm: string; code: string | null }>>, created: (i: SimIncident, t: number) => void): Outcome {
  const brief = (pp: Preview): Brief => ({ intake: { service: pp.intake.service, designator: pp.intake.designator, house: pp.intake.house, risk: pp.intake.risk, lang: pp.intake.lang }, place_area: pp.place.area_id, place_building: pp.place.building })
  let gps = rep.lat != null && rep.lon != null ? { lat: rep.lat, lon: rep.lon } : null
  let text = rep.text
  let p = store.preview(text, rep.at, gps)
  const first = brief(p)
  let retried: Outcome['retried']
  const out = (action: Outcome['action'], incident: number | null, m: Preview['matches'][number] | null, code?: string): Outcome =>
    ({ action, incident, score: m?.score ?? null, reasons: m?.reasons ?? [], code, retried, first, input: { text, lat: gps?.lat ?? null, lon: gps?.lon ?? null }, ...brief(p) })

  if (rep.channel !== 'APP') {
    // A 109 operator takes the call or message and asks for the address when it is missing.
    if (!p.place.area_id && rep.problem != null) {
      const b = city.buildings[rep.building]!
      text = `${text}\n${addressLine(city.areaById.get(b.area_id!)!.designator, b.house)}`
      gps = null
      p = store.preview(text, rep.at, null)
      retried = 'operator_address'
    }
    const likely = p.matches[0] && p.matches[0].score >= MATCH_LIKELY ? p.matches[0] : null
    if (likely) { store.attach(likely.incident, rep, p, rep.at); return out('attached', likely.incident.n, likely) }
    const inc = store.create(rep, p, rep.at, false)
    created(inc, rep.at)
    return out('created', inc.n, p.matches[0] ?? null)
  }

  const res = sc.residents[rep.resident!]!
  // The app does not send a report without a place: the resident adds it (the home button or the location).
  const noPlace = (pp: Preview) => pp.intake.missing.includes('address') && !pp.place.area_id
  if (noPlace(p)) {
    if (rep.problem == null) return out('stopped', null, null)
    const home = city.buildings[res.building]!
    const pr = sc.problems[rep.problem]!
    if (res.hasHome && res.building === rep.building) {
      text = `${text}, ${addressLine(city.areaById.get(home.area_id!)!.designator, home.house)}`
      retried = 'home_button'
      gps = null
      p = store.preview(text, rep.at, null)
    } else {
      gps = specOf(pr.key).where === 'home' && res.building === rep.building ? { lat: home.lat, lon: home.lon } : { lat: pr.lat, lon: pr.lon }
      retried = 'gps'
      p = store.preview(text, rep.at, gps)
    }
    if (noPlace(p)) return out('stopped', null, null)
  }
  const likely = p.matches[0] && p.matches[0].score >= MATCH_LIKELY ? p.matches[0] : null
  if (likely) {
    const c = store.confirm(likely.incident, rep, rep.at, gps != null)
    if (c === 'confirmed') return out('confirmed', likely.incident.n, likely)
    if (c !== 'resolved') return out('repeat', likely.incident.n, likely)
  }
  // The anti-spam gate (report-check.ts, rules only: the AI review is not called in the simulation).
  const norm = normaliseReport(text)
  const mine = stored.get(res.i) ?? []
  const recent = mine.filter((x) => x.at > rep.at - 24 * H)
  const dup = recent.find((x) => x.norm === norm)
  const rules = spamRules(text, { duplicate_of: dup ? dup.code ?? 'pending' : null, recent_count: recent.filter((x) => x.at > rep.at - H).length, photo_seen_elsewhere: false })
  const decision = reportDecision({ rules, ai: null, photo_required: photoRequirement(p.intake) === 'required', has_photo: rep.photo, risk: p.intake.risk })
  if (decision.outcome === 'block') return out('blocked', null, null, decision.code)
  const inc = store.create(rep, p, rep.at, gps != null)
  created(inc, rep.at)
  if (decision.flags.some((f) => f !== 'ai_unavailable')) inc.flagged = true
  mine.push({ at: rep.at, norm, code: inc.code })
  stored.set(res.i, mine)
  return out('created', inc.n, p.matches[0] ?? null, rules.includes('burst') ? 'burst' : undefined)
}

/** The address as the app's "At my home" button (and an operator) writes it. */
const addressLine = (designator: string, house: string) => `${designator}${/^\d/.test(designator) ? ' мкр' : ''}, дом ${house}`

// ── Metrics: every number against the ground truth ───────────────────────────
function measure(city: PilotCity, sc: Scenario, store: Store, outcomes: Outcome[], majority: (i: SimIncident) => number | null) {
  const reports = sc.reports
  const genuine = reports.filter((x) => x.problem != null && x.spam == null)
  const inc = store.incidents
  const maj = inc.map((i) => majority(i))
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)

  // ── Input ─────────────────────────────────────────────────────────────────
  const count = <K extends string>(xs: K[]) => xs.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {} as Record<K, number>)
  const hours = Math.ceil((sc.end - sc.start) / H)
  const perHour = Array.from({ length: hours }, () => ({ reports: 0, incidents: 0, joined: 0, blocked: 0 }))
  for (const x of reports) {
    const h = Math.min(hours - 1, Math.max(0, Math.floor((x.at - sc.start) / H)))
    const oc = outcomes[x.id]!
    perHour[h]!.reports++
    if (oc.action === 'created') perHour[h]!.incidents++
    else if (oc.action === 'blocked' || oc.action === 'stopped') perHour[h]!.blocked++
    else perHour[h]!.joined++
  }

  // ── Duplicates: one real problem ↔ one incident ───────────────────────────
  const problemsReached = new Set<number>()
  const reportsOf = new Map<number, number[]>()
  for (const x of genuine) {
    const oc = outcomes[x.id]!
    if (oc.incident == null) continue
    problemsReached.add(x.problem!)
    if (!reportsOf.has(x.problem!)) reportsOf.set(x.problem!, [])
    reportsOf.get(x.problem!)!.push(x.id)
  }
  const incidentsOf = new Map<number, number[]>()
  inc.forEach((i, k) => { const m = maj[k]; if (m != null) { if (!incidentsOf.has(m)) incidentsOf.set(m, []); incidentsOf.get(m)!.push(i.n) } })
  const realIncidents = inc.filter((_, k) => maj[k] != null).length
  const fakeIncidents = inc.length - realIncidents
  let placedRight = 0, placedTotal = 0
  const mixed: Array<{ incident: SimIncident; problems: Map<number, number> }> = []
  inc.forEach((i, k) => {
    const c = new Map<number, number>()
    for (const id of i.reports) { const p = problemOf(sc, id); if (p != null) c.set(p, (c.get(p) ?? 0) + 1) }
    for (const [p, n] of c) { placedTotal += n; if (p === maj[k]) placedRight += n }
    if (c.size > 1) mixed.push({ incident: i, problems: c })
  })
  // A second incident for one problem is a duplicate only if the first was still open when it was opened;
  // opened after the first was closed (e.g. closed too early) it is "the problem came back".
  const closedAt = (i: SimIncident) => (CLOSED.has(i.status) ? i.verified_at ?? i.resolved_at ?? i.updated_at : Infinity)
  const extras: number[] = []
  let reopenedAsNew = 0
  for (const [, is] of incidentsOf) {
    const byTime = [...is].sort((a, b) => inc[a]!.created_at - inc[b]!.created_at)
    for (const n of byTime.slice(1)) {
      const t = inc[n]!.created_at
      if (byTime.some((m) => m !== n && inc[m]!.created_at < t && closedAt(inc[m]!) > t)) extras.push(n)
      else reopenedAsNew++
    }
  }
  const split = [...incidentsOf.entries()].filter(([, is]) => is.some((n) => extras.includes(n)))
  const extra = extras.length
  const flaggedSplits = extras.filter((n) => { const i = inc[n]!; return i.first_match && i.first_match.score >= MATCH_POSSIBLE && maj[i.first_match.incident] === maj[n] }).length
  const hidden = [...problemsReached].filter((p) => !incidentsOf.has(p))
  // B-cubed over reports that reached an incident.
  let bp = 0, br = 0, bn = 0
  const byIncident = new Map<number, number[]>()
  for (const x of genuine) { const oc = outcomes[x.id]!; if (oc.incident == null) continue; if (!byIncident.has(oc.incident)) byIncident.set(oc.incident, []); byIncident.get(oc.incident)!.push(x.id) }
  for (const x of genuine) {
    const oc = outcomes[x.id]!
    if (oc.incident == null) continue
    const same = byIncident.get(oc.incident)!
    const mates = reportsOf.get(x.problem!)!
    const both = same.filter((y) => reports[y]!.problem === x.problem).length
    bp += both / same.length; br += both / mates.length; bn++
  }
  const b3p = bn ? bp / bn : 0, b3r = bn ? br / bn : 0

  // ── Understanding (intake) ────────────────────────────────────────────────
  const und = { service_ok: 0, place_ok: 0, house_ok: 0, house_total: 0, n: 0, by_lang: {} as Record<string, { n: number; service_ok: number; place_ok: number }> }
  for (const x of genuine) {
    if (x.lat != null) continue
    const f = outcomes[x.id]!.first
    const p = sc.problems[x.problem!]!
    const tb = city.buildings[x.building]!
    const L = x.lang
    und.by_lang[L] ??= { n: 0, service_ok: 0, place_ok: 0 }
    und.n++; und.by_lang[L].n++
    if (f.intake.service === p.service) { und.service_ok++; und.by_lang[L].service_ok++ }
    if (f.place_area === tb.area_id) { und.place_ok++; und.by_lang[L].place_ok++ }
    und.house_total++
    if (f.place_building === tb.i) und.house_ok++
  }

  // ── Anti-spam and the app's own checks ────────────────────────────────────
  const spam = reports.filter((x) => x.spam && x.spam !== 'resend')
  const resends = reports.filter((x) => x.spam === 'resend')
  const byKind = (k: string) => spam.filter((x) => x.spam === k)
  const gate = {
    spam: spam.length,
    stopped_no_address: spam.filter((x) => outcomes[x.id]!.action === 'stopped').length,
    blocked_by_rules: spam.filter((x) => outcomes[x.id]!.action === 'blocked').length,
    reached_109: spam.filter((x) => outcomes[x.id]!.incident != null).length,
    by_kind: Object.fromEntries((['advert', 'gibberish', 'chatter', 'troll'] as const).map((k) => [k, {
      n: byKind(k).length, stopped: byKind(k).filter((x) => ['blocked', 'stopped'].includes(outcomes[x.id]!.action)).length,
      flagged: byKind(k).filter((x) => outcomes[x.id]!.code === 'burst').length,
    }])),
    resends: resends.length,
    resends_absorbed: resends.filter((x) => outcomes[x.id]!.action !== 'created').length,
    genuine_blocked: genuine.filter((x) => outcomes[x.id]!.action === 'blocked').length,
    genuine_stopped: genuine.filter((x) => outcomes[x.id]!.action === 'stopped').length,
    genuine_retried: genuine.filter((x) => outcomes[x.id]!.retried).length,
    examples: {
      blocked: spam.filter((x) => outcomes[x.id]!.action === 'blocked').slice(0, 4).map((x) => ({ text: x.text, code: outcomes[x.id]!.code ?? null })),
      reached: spam.filter((x) => outcomes[x.id]!.incident != null).slice(0, 4).map((x) => ({ text: x.text, kind: x.spam, incident: inc[outcomes[x.id]!.incident!]!.code })),
      genuine_blocked: genuine.filter((x) => outcomes[x.id]!.action === 'blocked').slice(0, 5).map((x) => ({ text: x.text, code: outcomes[x.id]!.code ?? null })),
    },
  }

  // ── Who was told: residents in the zone vs residents really affected ─────
  // Told = shown "this affects your home" (the incident's scope covers their saved home).
  // Right = a problem in that incident really affects them (exact buildings for outages;
  // for problems at a point, within its radius + 60 m, because an address is only the nearest house).
  const audience = inc.map((i) => new Set(store.audience(i)))
  const exact = sc.problems.map((p) => new Set(zoneUsers(city, sc.residentsIn, p.zone).filter((u) => sc.residents[u]!.hasHome)))
  const tolerant = sc.problems.map((p, id) => p.zone.kind === 'radius'
    ? new Set(zoneUsers(city, sc.residentsIn, { ...p.zone, radius: p.zone.radius + 60 }).filter((u) => sc.residents[u]!.hasHome)) : exact[id]!)
  const problemsIn = inc.map((i) => new Set(i.reports.map((id) => problemOf(sc, id)).filter((x): x is number => x != null)))
  const group = (id: number) => { const p = sc.problems[id]!; return p.key.endsWith('_net') ? 'outages' : p.danger ? 'dangers' : specOf(p.key).where === 'home' ? 'building' : 'street' }
  let notifiedPairs = 0, notifiedRight = 0
  const byBuilding = new Map<number, { right: number; wrong: number; missed: number }>()
  const bump = (b: number, k: 'right' | 'wrong' | 'missed') => { const x = byBuilding.get(b) ?? { right: 0, wrong: 0, missed: 0 }; x[k]++; byBuilding.set(b, x) }
  const precisionBy: Record<string, { n: number; right: number }> = {}
  const toldAbout = new Map<number, Set<number>>()
  inc.forEach((i, k) => {
    const ps = [...problemsIn[k]!]
    const g = maj[k] != null ? group(maj[k]!) : 'false_reports'
    precisionBy[g] ??= { n: 0, right: 0 }
    for (const u of audience[k]!) {
      notifiedPairs++; precisionBy[g].n++
      const ok = ps.some((p) => tolerant[p]!.has(u))
      if (ok) { notifiedRight++; precisionBy[g].right++ }
      bump(sc.residents[u]!.building, ok ? 'right' : 'wrong')
      for (const p of ps) { if (!toldAbout.has(p)) toldAbout.set(p, new Set()); toldAbout.get(p)!.add(u) }
    }
  })
  const followersOf = new Map<number, Set<number>>()
  inc.forEach((i, k) => { for (const p of problemsIn[k]!) { if (!followersOf.has(p)) followersOf.set(p, new Set()); for (const u of i.followers.keys()) followersOf.get(p)!.add(u) } })
  let truthPairs = 0, truthCovered = 0
  const recallBy: Record<string, { n: number; covered: number }> = {}
  sc.problems.forEach((p, id) => {
    if (!problemsReached.has(id)) return
    const told = toldAbout.get(id) ?? new Set(), fol = followersOf.get(id) ?? new Set()
    const g = group(id)
    recallBy[g] ??= { n: 0, covered: 0 }
    for (const u of exact[id]!) {
      truthPairs++; recallBy[g].n++
      if (told.has(u) || fol.has(u)) { truthCovered++; recallBy[g].covered++ } else bump(sc.residents[u]!.building, 'missed')
    }
  })
  const perResident = new Map<number, number>()
  audience.forEach((a) => a.forEach((u) => perResident.set(u, (perResident.get(u) ?? 0) + 1)))
  const informed = new Set<number>([...perResident.keys(), ...inc.flatMap((i) => [...i.followers.keys()])])

  // ── Danger first ──────────────────────────────────────────────────────────
  const dangers = sc.problems.filter((p) => p.danger && problemsReached.has(p.id))
  const dangerIncidents = dangers.map((p) => {
    const first = (reportsOf.get(p.id) ?? []).map((id) => outcomes[id]!).find((oc) => oc.incident != null)
    const i = first ? inc[first.incident!]! : null
    return { problem: p, incident: i, critical: !!i && i.priority === 'CRITICAL', detected: first?.intake.risk === 'imminent' }
  })

  // ── Routing ───────────────────────────────────────────────────────────────
  const routed = inc.map((i, k) => ({ i, m: maj[k] })).filter((x) => x.m != null)
  const routeOk = routed.filter((x) => x.i.route.org === sc.problems[x.m!]!.org).length
  const routeOkAtCreate = routed.filter((x) => x.i.route_at_create.org === sc.problems[x.m!]!.org).length

  // ── Recurrence ────────────────────────────────────────────────────────────
  const returns = sc.problems.filter((p) => p.recurrenceOf != null && problemsReached.has(p.id))
  const linked = returns.filter((p) => (incidentsOf.get(p.id) ?? []).some((n) => { const prev = inc[n]!.previous; return prev != null && maj[prev] === p.recurrenceOf }))
  const kept = returns.filter((p) => (incidentsOf.get(p.id) ?? []).length > 0 && !(incidentsOf.get(p.id) ?? []).some((n) => (incidentsOf.get(p.recurrenceOf!) ?? []).includes(n)))

  // ── Mistakes, explained ───────────────────────────────────────────────────
  const place = (i: SimIncident) => ({ designator: i.area_id ? city.areaById.get(i.area_id)?.designator ?? null : null, house: i.building != null ? city.buildings[i.building]!.house : null })
  const probLabel = (id: number) => {
    const p = sc.problems[id]!
    const b = city.buildings[p.anchor]!
    return { key: p.key, service: p.service, kind: p.kind, designator: city.areaById.get(b.area_id!)?.designator ?? null, house: b.house, buildings: p.zone.kind === 'buildings' ? p.zone.buildings.length : p.zone.kind === 'areas' ? p.zone.areas.length : null, zone: p.zone.kind }
  }
  const sample = (ids: number[]) => ids.slice(0, 2).map((id) => reports[id]!.text.split('\n').find((l) => !/^Оператор:/.test(l))?.replace(/^(?:Житель|Тұрғын):\s*/, '') ?? reports[id]!.text)
  const errors: Array<Record<string, unknown>> = []
  for (const { incident: i, problems } of mixed.sort((a, b) => b.incident.reports.length - a.incident.reports.length)) {
    const m = maj[i.n]!
    for (const [p, n] of problems) {
      if (p === m) continue
      const ids = i.reports.filter((id) => reports[id]!.problem === p)
      const scores = ids.map((id) => outcomes[id]!.score ?? 0)
      const best = ids.map((id) => outcomes[id]!).filter((oc) => oc.action !== 'created').sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
      errors.push({ type: 'merged', incident: i.code, into: probLabel(m), other: probLabel(p), reports: n, score: Math.max(...scores), samples: sample(ids), reasons: best?.reasons ?? [] })
    }
  }
  for (const [p, is] of split) {
    for (const n of is.filter((x) => extras.includes(x))) {
      const i = inc[n]!
      errors.push({ type: 'split', incident: i.code, of: inc[is[0]!]!.code, problem: probLabel(p), reports: i.reports.length, possible: !!i.first_match && i.first_match.score >= MATCH_POSSIBLE && maj[i.first_match.incident] === p,
        score: i.first_match && maj[i.first_match.incident] === p ? i.first_match.score : null, reasons: i.first_match && maj[i.first_match.incident] === p ? i.first_match.reasons : [], samples: sample(i.reports.slice(0, 1)), place: place(i) })
    }
  }
  for (const d of dangerIncidents.filter((x) => !x.critical)) errors.push({ type: 'danger_missed', problem: probLabel(d.problem.id), incident: d.incident?.code ?? null, priority: d.incident?.priority ?? null, samples: sample(reportsOf.get(d.problem.id) ?? []) })
  for (const x of genuine.filter((y) => outcomes[y.id]!.action === 'blocked')) errors.push({ type: 'blocked', problem: probLabel(x.problem!), code: outcomes[x.id]!.code, samples: [x.text] })
  for (const x of routed.filter((y) => y.i.route.org !== sc.problems[y.m!]!.org).sort((a, b) => b.i.reports.length - a.i.reports.length).slice(0, 12)) {
    errors.push({ type: 'route', incident: x.i.code, problem: probLabel(x.m!), suggested: x.i.route.org, expected: sc.problems[x.m!]!.org, reports: x.i.reports.length, samples: sample(x.i.reports.slice(0, 1)) })
  }

  // ── The biggest incidents ─────────────────────────────────────────────────
  const top = inc.map((i, k) => ({ i, k })).sort((a, b) => b.i.reports.length - a.i.reports.length).slice(0, 14).map(({ i, k }) => {
    const m = maj[k]
    const langs = count(i.reports.map((id) => reports[id]!.lang))
    const channels = count(i.reports.map((id) => reports[id]!.channel))
    const truthReports = m != null ? (reportsOf.get(m) ?? []).length : 0
    return {
      code: i.code, service: i.service, kind: i.kind, risk_flags: [...new Set([...i.risk_flags, ...i.signal_flags])], ...place(i),
      title: { ru: incidentTitle(i.service, 'ru', i.kind, i.risk_flags), kk: incidentTitle(i.service, 'kk', i.kind, i.risk_flags), en: incidentTitle(i.service, 'en', i.kind, i.risk_flags) },
      reports: i.reports.length, signals: i.signal_count, confirmations: i.confirm_count, scope: { kind: i.scope.kind, buildings: i.scopeBuildings.size, areas: i.scopeAreas.size, radius_m: i.scope.radius_m },
      notified: audience[k]!.size, priority: i.priority, route: i.route.org, route_ok: m != null && i.route.org === sc.problems[m]!.org, status: i.status,
      truth: m != null ? { ...probLabel(m), reports: truthReports, captured: pct(i.reports.filter((id) => reports[id]!.problem === m).length, truthReports) } : null,
      langs, channels,
    }
  })

  // ── Map layer ─────────────────────────────────────────────────────────────
  const mapBuildings = [...byBuilding.entries()].map(([b, v]) => [Number(city.buildings[b]!.lat.toFixed(5)), Number(city.buildings[b]!.lon.toFixed(5)), v.right, v.wrong, v.missed])
  const incidentsLayer = inc.filter((i) => i.lat != null).map((i) => [Number(i.lat!.toFixed(5)), Number(i.lon!.toFixed(5)), i.reports.length, i.service, i.priority === 'CRITICAL' ? 1 : 0, maj[i.n] == null ? 0 : 1] as const)

  // The city as dots (every building), for the map: [lat, lon, lat, lon, …] at ~10 m.
  const cityDots = city.buildings.flatMap((b) => [Number(b.lat.toFixed(4)), Number(b.lon.toFixed(4))])
  return {
    input: {
      reports: reports.length, genuine: genuine.length, spam: spam.length, resends: resends.length, problems: sc.problems.length, problems_reported: problemsReached.size,
      by_channel: count(reports.map((x) => x.channel as Channel)), by_lang: count(reports.map((x) => x.lang)),
      by_service: count(genuine.map((x) => sc.problems[x.problem!]!.service)),
      per_hour: perHour,
    },
    dedup: {
      problems: problemsReached.size, incidents: inc.length, real_incidents: realIncidents, fake_incidents: fakeIncidents,
      joined: outcomes.filter((x) => x.action === 'attached' || x.action === 'confirmed' || x.action === 'repeat').length,
      attached: outcomes.filter((x) => x.action === 'attached').length, confirmed: outcomes.filter((x) => x.action === 'confirmed').length,
      repeats: outcomes.filter((x) => x.action === 'repeat').length, created: outcomes.filter((x) => x.action === 'created').length,
      reports_placed_right: pct(placedRight, placedTotal), placed_right: placedRight, placed_total: placedTotal,
      split_problems: split.length, extra_incidents: extra, extra_flagged_possible: flaggedSplits, reopened_as_new: reopenedAsNew,
      mixed_incidents: mixed.length, wrongly_merged_reports: placedTotal - placedRight, hidden_problems: hidden.length,
      b3_precision: Number(b3p.toFixed(4)), b3_recall: Number(b3r.toFixed(4)), b3_f1: Number(((2 * b3p * b3r) / (b3p + b3r || 1)).toFixed(4)),
      operator_cards: inc.length, cards_saved_pct: pct(reports.length - inc.length, reports.length),
    },
    understanding: {
      reports: und.n, service_ok: pct(und.service_ok, und.n), place_ok: pct(und.place_ok, und.n), house_ok: pct(und.house_ok, und.house_total),
      by_lang: Object.fromEntries(Object.entries(und.by_lang).map(([k, v]) => [k, { n: v.n, service_ok: pct(v.service_ok, v.n), place_ok: pct(v.place_ok, v.n) }])),
    },
    gate,
    notify: {
      informed_residents: informed.size, notified_pairs: notifiedPairs, precision: pct(notifiedRight, notifiedPairs), outside_zone: notifiedPairs - notifiedRight,
      recall: pct(truthCovered, truthPairs), affected_pairs: truthPairs, missed: truthPairs - truthCovered,
      recall_by: Object.fromEntries(Object.entries(recallBy).map(([k, v]) => [k, { n: v.n, recall: pct(v.covered, v.n) }])),
      precision_by: Object.fromEntries(Object.entries(precisionBy).map(([k, v]) => [k, { n: v.n, precision: pct(v.right, v.n) }])),
      max_per_resident: Math.max(0, ...perResident.values()), avg_per_notified: perResident.size ? Number(([...perResident.values()].reduce((a, b) => a + b, 0) / perResident.size).toFixed(2)) : 0,
      duplicate_messages: 0,
    },
    safety: {
      dangers: dangers.length, critical: dangerIncidents.filter((x) => x.critical).length, detected_in_text: dangerIncidents.filter((x) => x.detected).length,
      blocked: dangers.reduce((s, p) => s + (reportsOf.get(p.id) ?? []).filter((id) => outcomes[id]!.action === 'blocked').length, 0),
      critical_incidents: inc.filter((i) => i.priority === 'CRITICAL').length,
      warned_residents: inc.reduce((s, i) => s + i.warned, 0),
      list: dangerIncidents.map((x) => ({ ...probLabel(x.problem.id), incident: x.incident?.code ?? null, priority: x.incident?.priority ?? null, critical: x.critical, reports: (reportsOf.get(x.problem.id) ?? []).length })),
    },
    routing: {
      incidents: routed.length, correct: pct(routeOk, routed.length), correct_at_first_report: pct(routeOkAtCreate, routed.length),
      rerouted: inc.filter((i) => i.rerouted).length, needs_review: inc.filter((i) => i.route.needs_review).length,
    },
    recurrence: { returned: returns.length, new_incident: kept.length, linked_to_previous: linked.length },
    errors: (['merged', 'split', 'danger_missed', 'blocked', 'route'] as const).flatMap((t) => errors.filter((e) => e.type === t).slice(0, 25)),
    error_counts: count(errors.map((e) => e.type as string)),
    top,
    map: { city: cityDots, buildings: mapBuildings, incidents: incidentsLayer },
  }
}

const problemOf = (sc: Scenario, reportId: number) => sc.reports[reportId]!.problem

