import { describe, expect, it } from 'vitest'
import { resolveClaim } from '@aktau/source-ranking'
import {
  affectsPersonally, dedupeKey, deriveServiceStatus, displayStatus, doesEventAffectLocation, eventFreshness, isCurrent,
  notificationTypeFor, shouldNotify, classifyIntent, findWindow, phrasingPreservesFacts,
} from '../src/index.ts'
import type { AlertPreferences } from '@aktau/types'

const MKR14 = 'area-14', MKR15 = 'area-15', H21 = 'b-14-21', H42 = 'b-14-42'
const outage = { status: 'SCHEDULED' as const, category: 'ELECTRICITY' as const, areas: [{ area_id: MKR14, coverage: 'BUILDINGS_ONLY' as const }], building_ids: ['b-14-19', 'b-14-20', H21, 'b-14-22', 'b-14-23'] }

describe('doesEventAffectLocation', () => {
  it('exact building → DIRECT', () => {
    expect(doesEventAffectLocation(outage, { building_id: H21, area_ids: [MKR14] })).toEqual({ relevance: 'DIRECT', reason: 'building' })
  })
  it('building exception: listed houses only → other houses in 14 mkr are AREA, never DIRECT', () => {
    const m = doesEventAffectLocation(outage, { building_id: H42, area_ids: [MKR14] })
    expect(m).toEqual({ relevance: 'AREA', reason: 'area_other_buildings' })
    expect(affectsPersonally(m)).toBe(false)
  })
  it('whole-microdistrict event → DIRECT for everyone in it', () => {
    const full = { ...outage, areas: [{ area_id: MKR14, coverage: 'FULL' as const }], building_ids: [] }
    expect(doesEventAffectLocation(full, { building_id: H42, area_ids: [MKR14] }).relevance).toBe('DIRECT')
    expect(doesEventAffectLocation(full, { building_id: null, area_ids: [MKR14] }).relevance).toBe('DIRECT')
  })
  it('partial coverage → AREA (might be affected)', () => {
    const part = { ...outage, areas: [{ area_id: MKR14, coverage: 'PARTIAL' as const }], building_ids: [] }
    const m = doesEventAffectLocation(part, { building_id: H42, area_ids: [MKR14] })
    expect(m.relevance).toBe('AREA')
    expect(affectsPersonally(m)).toBe(true)
  })
  it('other microdistrict within radius → NEARBY; far → NO', () => {
    expect(doesEventAffectLocation({ ...outage, distance_m: 600 }, { building_id: null, area_ids: [MKR15] }).relevance).toBe('NEARBY')
    expect(doesEventAffectLocation({ ...outage, distance_m: 4000 }, { building_id: null, area_ids: [MKR15] }).relevance).toBe('NO')
  })
  it('resolved event does not affect anyone', () => {
    expect(doesEventAffectLocation({ ...outage, status: 'RESOLVED' }, { building_id: H21, area_ids: [MKR14] }).relevance).toBe('NO')
  })
})

describe('freshness', () => {
  const now = new Date('2026-09-23T15:00:00Z')
  const active = { status: 'ACTIVE' as const, starts_at: new Date('2026-09-23T06:00:00Z'), expected_ends_at: new Date('2026-09-23T12:00:00Z'), last_confirmed_at: new Date('2026-09-23T06:10:00Z'), source_type: 'OFFICIAL' as const }
  it('an outage expected to end 3 h ago with no update is not "Active" any more', () => {
    expect(eventFreshness(active, now)).toBe('stale')
    expect(displayStatus(active, now)).toBe('UNCONFIRMED')
  })
  it('a fresh confirmation keeps it active', () => {
    const confirmed = { ...active, expected_ends_at: new Date('2026-09-23T18:00:00Z'), last_confirmed_at: new Date('2026-09-23T14:30:00Z') }
    expect(displayStatus(confirmed, now)).toBe('ACTIVE')
  })
  it('resolved event does not appear as current', () => {
    expect(isCurrent({ ...active, status: 'RESOLVED' }, now)).toBe(false)
  })
})

describe('service status is derived', () => {
  const now = new Date('2026-09-23T15:00:00Z')
  const fresh = new Date('2026-09-23T14:50:00Z')
  it('NORMAL requires a recent source check; otherwise UNKNOWN', () => {
    expect(deriveServiceStatus('water', [], fresh, now).state).toBe('NORMAL')
    expect(deriveServiceStatus('water', [], null, now).state).toBe('UNKNOWN')
    expect(deriveServiceStatus('water', [], new Date('2026-09-22T00:00:00Z'), now).state).toBe('UNKNOWN')
  })
  it('DIRECT active → DISRUPTED; scheduled → PLANNED_ISSUE; resolved ignored', () => {
    const ev = { id: 'e', category: 'WATER' as const, starts_at: new Date('2026-09-23T10:00:00Z'), relevance: 'DIRECT' as const }
    expect(deriveServiceStatus('water', [{ ...ev, display_status: 'ACTIVE' }], fresh, now).state).toBe('DISRUPTED')
    expect(deriveServiceStatus('water', [{ ...ev, display_status: 'SCHEDULED', starts_at: new Date('2026-09-24T05:00:00Z') }], fresh, now).state).toBe('PLANNED_ISSUE')
    expect(deriveServiceStatus('water', [{ ...ev, display_status: 'RESOLVED' }], fresh, now).state).toBe('NORMAL')
  })
})

describe('conflict resolution', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 8, 23, h))
  it('newer official update wins current state', () => {
    expect(resolveClaim({ value: '15:00', authority: 100, observedAt: t(9) }, { value: '18:30', authority: 100, observedAt: t(10) }).winner).toBe('incoming')
  })
  it('a newer but much weaker source does not override an official one', () => {
    expect(resolveClaim({ value: 'ACTIVE', authority: 100, observedAt: t(9) }, { value: 'RESOLVED', authority: 20, observedAt: t(10) }).winner).toBe('current')
  })
})

describe('notifications', () => {
  const prefs: AlertPreferences = { water: true, electricity: true, heating: true, road: true, transport: false, weather: true, emergency: true, events: false, affects_me_only: true, minimum_severity: 'MINOR' }
  it('a confirmation from another source produces no notification', () => {
    expect(notificationTypeFor('CONFIRMED', 'SCHEDULED')).toBeNull()
    expect(notificationTypeFor('CREATED', 'SCHEDULED')).toBe('PLANNED')
    expect(notificationTypeFor('ETA_CHANGED', 'DELAYED')).toBe('UPDATED')
    expect(notificationTypeFor('STATUS_CHANGED', 'RESOLVED')).toBe('RESOLVED')
  })
  it('dedupe keys: identical for repeats, distinct per new ETA', () => {
    expect(dedupeKey('in_app:i1', 'e1', 'PLANNED', null)).toBe(dedupeKey('in_app:i1', 'e1', 'PLANNED', '2026-09-24T12:30:00Z'))
    expect(dedupeKey('in_app:i1', 'e1', 'UPDATED', 'a')).not.toBe(dedupeKey('in_app:i1', 'e1', 'UPDATED', 'b'))
  })
  it('respects preferences and "only what affects me"', () => {
    const e = { category: 'ELECTRICITY' as const, severity: 'MODERATE' as const }
    expect(shouldNotify(prefs, e, { relevance: 'DIRECT', reason: 'building' })).toBe(true)
    expect(shouldNotify(prefs, e, { relevance: 'AREA', reason: 'area_other_buildings' })).toBe(false)
    expect(shouldNotify({ ...prefs, electricity: false }, e, { relevance: 'DIRECT', reason: 'building' })).toBe(false)
    expect(shouldNotify({ ...prefs, emergency: false }, { category: 'EMERGENCY', severity: 'MAJOR' }, { relevance: 'NEARBY', reason: 'radius' })).toBe(true)
  })
})

describe('Ask intent layer', () => {
  it('classifies the flagship questions', () => {
    const q = classifyIntent('Will I have electricity tomorrow at 3 PM?')
    expect(q.intent).toBe('UPCOMING_OUTAGE')
    expect(q.entities.service).toBe('electricity')
    expect(q.entities.window?.kind).toBe('point')
    expect(classifyIntent('Будет ли завтра утром вода в 14 мкр?').entities).toMatchObject({ service: 'water', district: '14' })
    expect(classifyIntent('How windy is it at the coast?').intent).toBe('WEATHER')
    expect(classifyIntent('Where can I eat after 11 PM?').intent).toBe('PLACE_SEARCH')
  })
  it('"tomorrow morning" is 05:00–12:00 Aktau time', () => {
    const w = findWindow('tomorrow morning', new Date('2026-09-23T15:00:00Z'))!
    expect([w.start.toISOString(), w.end.toISOString()]).toEqual(['2026-09-24T00:00:00.000Z', '2026-09-24T07:00:00.000Z'])
  })
  it('LLM phrasing must keep every time and number', () => {
    expect(phrasingPreservesFacts('Not between 09:00 and 15:00.', 'No water from 09:00 to 15:00.')).toBe(true)
    expect(phrasingPreservesFacts('Not between 09:00 and 15:00.', 'No water in the morning.')).toBe(false)
  })
})
