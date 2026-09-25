import { describe, expect, it } from 'vitest'
import { assessPriority, etaWords, incidentAffects, inferScope, intake, matchScore, verificationOutcome, completionNeedsPhoto, type PriorityInput } from '../src/index.ts'

const NOW = new Date('2026-09-24T09:00:00Z') // 14:00 in Aktau

describe('intake: leaks and open manholes', () => {
  it('a leak is water damage, not an outage', () => {
    const i = intake('В 14 микрорайоне возле дома 37 течёт вода', NOW)
    expect(i.service).toBe('water')
    expect(i.kind).toBe('damage')
    expect(intake('Сильная течь возле дома 37, 14 мкр', NOW).service).toBe('water')
    expect(intake('14 мкр 21 дом нет воды с утра', NOW).kind).toBe('outage')
  })
  it('an open manhole is an imminent hazard', () => {
    const i = intake('29 мкр во дворе дома 12 открытый люк, дети играют рядом', NOW)
    expect(i.risk).toBe('imminent')
    expect(i.risk_flags).toContain('open_manhole')
  })
})

describe('affected scope', () => {
  const at = { building_id: 'b37', area_id: 'a14', has_point: true }
  it('streetlight → 150 m; open manhole → 200 m; leak → 150 m', () => {
    expect(inferScope(intake('14 мкр возле дома 37 не горит фонарь', NOW), at)).toMatchObject({ kind: 'radius', radius_m: 150 })
    expect(inferScope(intake('14 мкр возле дома 37 открытый люк', NOW), at)).toMatchObject({ kind: 'radius', radius_m: 200 })
    expect(inferScope(intake('14 мкр возле дома 37 течёт вода', NOW), at)).toMatchObject({ kind: 'radius', radius_m: 150 })
  })
  it('a water outage starts with the reported building; "whole microdistrict" widens it', () => {
    expect(inferScope(intake('14 мкр дом 37 нет воды', NOW), at).kind).toBe('buildings')
    expect(inferScope(intake('Во всём микрорайоне 14 нет воды', NOW), { ...at, building_id: null }).kind).toBe('area')
  })
  it('"no water in my flat" / "only us" → nobody else yet; the reporter\'s house is not put in the scope', () => {
    for (const t of ['14 мкр дом 37, нет воды в квартире', 'нет света только у нас, 14 мкр 37', '14 ш/а 37 үй, пәтерде су жоқ', '14 ш/а 37 үй, бізде ғана жарық жоқ', '14 mkr house 37, no water in my flat']) {
      const i = intake(t, NOW)
      expect(i.scope, t).toBe('household')
      expect(i.priority, t).toBe('NORMAL')
      expect(i.missing, t).not.toContain('neighbours')
      expect(inferScope(i, at), t).toMatchObject({ kind: 'buildings', reason: 'one_household' })
    }
    // Neighbours or the whole building said: the building, as before.
    expect(intake('14 мкр 37, нет воды в квартире и у соседей', NOW).scope).toBe('multiple')
    expect(intake('14 мкр 37 нет воды во всем доме, в квартире тоже', NOW).scope).toBe('building')
    expect(intake('14 мкр 37, в квартирах нет воды', NOW).scope).toBe('single')
  })
  it('no location → nobody is targeted until an operator sets it', () => {
    expect(inferScope(intake('нет воды', NOW), { building_id: null, area_id: null, has_point: false }).kind).toBeNull()
  })
  it('affects: inside the radius DIRECT, close by NEARBY, far NO; sessions only for members', () => {
    const s = { kind: 'radius' as const, radius_m: 150, building_ids: [], area_ids_full: [], session_id: null }
    expect(incidentAffects({ ...s, distance_m: 90 }, { building_id: 'x', area_ids: [] }).relevance).toBe('DIRECT')
    expect(incidentAffects({ ...s, distance_m: 400 }, { building_id: 'x', area_ids: [] }).relevance).toBe('NEARBY')
    expect(incidentAffects({ ...s, distance_m: 5000 }, { building_id: 'x', area_ids: [] }).relevance).toBe('NO')
    const b = { kind: 'buildings' as const, radius_m: null, building_ids: ['b38', 'b40'], area_ids_full: [], session_id: null, distance_m: 60 }
    expect(incidentAffects(b, { building_id: 'b38', area_ids: [] }).relevance).toBe('DIRECT')
    expect(incidentAffects(b, { building_id: 'b42', area_ids: [] }).relevance).toBe('NEARBY')
    const d = { kind: 'demo_session' as const, radius_m: null, building_ids: [], area_ids_full: [], session_id: 's1', distance_m: null }
    expect(incidentAffects(d, { building_id: null, area_ids: [], session_ids: ['s1'] }).relevance).toBe('DIRECT')
    expect(incidentAffects(d, { building_id: null, area_ids: [], session_ids: [] }).relevance).toBe('NO')
  })
})

describe('priority is explained, and a crowd cannot outrank a hazard', () => {
  const base: PriorityInput = { service: 'other', kind: 'complaint', risk: 'none', risk_flags: [], scope_kind: 'radius', buildings: 0, areas_full: 0, residents: 1, first_signal_at: NOW.toISOString(), recurring: false, sensitive: [], official: false, now: NOW }
  it('open manhole near a school with 3 confirmations → critical', () => {
    const p = assessPriority({ ...base, service: 'sewer', kind: 'hazard', risk: 'imminent', risk_flags: ['open_manhole', 'children'], residents: 3, sensitive: ['school'] })
    expect(p.level).toBe('CRITICAL')
    expect(p.reasons[0]!.key).toBe('open_manhole')
  })
  it('overflowing garbage with 40 confirmations → medium', () => {
    expect(assessPriority({ ...base, service: 'garbage', kind: 'damage', residents: 40 }).level).toBe('NORMAL')
  })
  it('a water leak confirmed by 23 residents, 3 h+, 4 buildings → high, with reasons in order', () => {
    const p = assessPriority({ ...base, service: 'water', kind: 'damage', residents: 23, buildings: 4, first_signal_at: new Date(NOW.getTime() - 3.5 * 3600_000).toISOString() })
    expect(p.level).toBe('HIGH')
    expect(p.reasons.map((r) => r.key)).toEqual(['service_water', 'residents', 'duration', 'buildings'])
    expect(p.reasons.find((r) => r.key === 'residents')!.n).toBe(23)
  })
  it('a 3-hour outage in 12 buildings is high; the same after two days is critical', () => {
    const outage = { ...base, service: 'water' as const, kind: 'outage' as const, residents: 16, buildings: 12 }
    expect(assessPriority({ ...outage, first_signal_at: new Date(NOW.getTime() - 3.2 * 3600_000).toISOString() }).level).toBe('HIGH')
    expect(assessPriority({ ...outage, scope_kind: 'area', buildings: 0, areas_full: 1, first_signal_at: new Date(NOW.getTime() - 50 * 3600_000).toISOString() }).level).toBe('CRITICAL')
  })
  it('Wi-Fi at a venue with 24 confirmations → medium; the first report sets a floor', () => {
    expect(assessPriority({ ...base, residents: 24 }).level).toBe('NORMAL')
    expect(assessPriority({ ...base, floor: 'HIGH' }).level).toBe('HIGH')
  })
})

describe('resident verification', () => {
  it('needs a quorum; 60% "yes, fully" closes it', () => {
    expect(verificationOutcome({ yes: 2, partial: 0, no: 0, eligible: 3 }).state).toBe('pending')
    expect(verificationOutcome({ yes: 2, partial: 0, no: 1, eligible: 3 })).toMatchObject({ state: 'verified', n: 3 })
    const r = verificationOutcome({ yes: 14, partial: 2, no: 2, eligible: 23 })
    expect(r.state).toBe('verified')
    expect(Math.round(r.yes_share * 100)).toBe(78)
    expect(Math.round(verificationOutcome({ yes: 17, partial: 3, no: 1, eligible: 24 }).yes_share * 100)).toBe(81)
  })
  it('one negative vote never reopens; two with half the answers do', () => {
    expect(verificationOutcome({ yes: 1, partial: 1, no: 1, eligible: 3 }).state).toBe('review')
    expect(verificationOutcome({ yes: 1, partial: 0, no: 2, eligible: 3 }).state).toBe('reopen')
    expect(verificationOutcome({ yes: 0, partial: 0, no: 1, eligible: 1 }).state).toBe('reopen')
    expect(verificationOutcome({ yes: 0, partial: 0, no: 1, eligible: 20 }).state).toBe('pending')
  })
  it('an "after" photo is required where the fix is visible, not for outages', () => {
    expect(completionNeedsPhoto('streetlight', 'outage')).toBe(true)
    expect(completionNeedsPhoto('water', 'damage')).toBe(true)
    expect(completionNeedsPhoto('water', 'outage')).toBe(false)
    expect(completionNeedsPhoto('other', 'complaint')).toBe(false)
  })
})

describe('intake: the house as people write it', () => {
  const house = (t: string) => intake(t, NOW).house
  it('letters, blocks and slashes', () => {
    expect(house('13 мкр, 24Д, воняет канализацией')).toBe('24Д')
    expect(house('15 ш/а 21к үй жарық сөнді')).toBe('21К')
    expect(house('15 мкр, 7 к1, нет воды')).toBe('7К1')
    expect(house('Нет воды в квартире 21-й мкр, д. 31/1б')).toBe('31/1Б')
    expect(house('3 ш/а 39 / 40 үйде, кәріз бітелген')).toBe('39/40')
    expect(house('5 мкр, 14/2 кв 3')).toBe('14/2')
    expect(house('дом 38 В, 16 мкр нет воды')).toBe('38В')
  })
  it('"д 142" without the dot, and in Latin letters', () => {
    expect(house('30-й мкр д 142 лифт не работает')).toBe('142')
    expect(house('mkr shygys-2 d 210/1 opyat bez sveta')).toBe('210/1')
  })
  it('a word after the number is not its letter; days and hours are not houses', () => {
    expect(house('16 мкр. д.38 в кране нет воды')).toBe('38')
    expect(house('дом 5 к сожалению нет воды 14 мкр')).toBe('5')
    expect(house('32Б мкр, 5. В квартире нет воды')).toBe('5')
    expect(house('14 мкр, 5 дней нет воды')).toBeNull()
    expect(house('14 ш/а 3 сағат су жоқ')).toBeNull()
    expect(house('нет света с 5.30 утра, 14 мкр')).toBeNull()
  })
  it('a flooded basement is the sewer, even misspelt or in Latin; people in a basement are not', () => {
    expect(intake('30 мкр. д.31 затпоило подвал', NOW).service).toBe('sewer')
    expect(intake('Канлаизация течёт в подвал 15 мкр. д.16', NOW).service).toBe('sewer')
    expect(intake('allo, 24 mkr, dom 24/1, zatopilo podval', NOW).service).toBe('sewer')
    expect(intake('в подвале живут бомжи, 14 мкр 5', NOW).service).toBe('other')
    expect(intake('9 mkr house 12 no electrciity', NOW).service).toBe('electricity')
    expect(intake('net gvs 32a mkr 8 dom', NOW).service).toBe('hot_water')
  })
})

describe('matching', () => {
  const inc = { id: 'i', code: 'INC-1', service: 'streetlight' as const, status: 'NEW', area_id: 'a14', designator: '14', house: '37', last_signal_at: NOW.toISOString(), first_signal_at: NOW.toISOString(), signal_count: 3, lat: 43.6558, lon: 51.1435, precise: true }
  it('a city report never matches a demo-session incident', () => {
    expect(matchScore({ service: 'streetlight', designator: '14', house: '37', area_id: 'a14', at: NOW }, { ...inc, session_id: 's1' }).score).toBe(0)
  })
  it('the same streetlight problem 1 km away in the same microdistrict is a different problem', () => {
    const near = matchScore({ service: 'streetlight', designator: '14', house: '38', area_id: 'a14', at: NOW, lat: 43.6555, lon: 51.1426, precise: true }, inc)
    const far = matchScore({ service: 'streetlight', designator: '14', house: '2', area_id: 'a14', at: NOW, lat: 43.6468, lon: 51.1435, precise: true }, inc)
    expect(near.score).toBeGreaterThanOrEqual(0.8)
    expect(near.reasons).toContain('very_close')
    expect(far.reasons).toContain('far_apart')
    expect(far.score).toBeLessThan(0.8)
  })
  it('two smells of gas 1 km apart are two leaks, so both get warned', () => {
    const gas = { ...inc, service: 'gas' as const, house: null }
    const far = matchScore({ service: 'gas', designator: '14', house: '2', area_id: 'a14', at: NOW, lat: 43.6468, lon: 51.1435, precise: true, kind: 'hazard' }, { ...gas, near_m: 1000 })
    expect(far.reasons).toContain('far_apart')
    expect(far.score).toBeLessThan(0.8)
  })
})

describe('deadlines in words', () => {
  it('close deadlines are relative, others are a day and a time', () => {
    expect(etaWords('ru', new Date(NOW.getTime() + 10 * 60_000).toISOString(), NOW)).toMatchObject({ rel: 'через 10 минут', when: 'сегодня, 14:10' })
    expect(etaWords('ru', new Date(NOW.getTime() + 20 * 3600_000).toISOString(), NOW).when).toBe('завтра, 10:00')
    expect(etaWords('en', new Date(NOW.getTime() - 60_000).toISOString(), NOW).overdue).toBe(true)
  })
})
