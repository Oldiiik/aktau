import { describe, expect, it } from 'vitest'
import { describeConditions, seaWord, swimVerdict, windWord } from '../src/index.ts'

describe('swimVerdict', () => {
  const official = [{ id: 'soldatsky', distance_m: 20, operational: 'UNKNOWN' as const }]
  it('prohibited wins even when an official beach is also near', () => {
    expect(swimVerdict({ distance_to_shore_m: 5, prohibited: [{ id: 'riviera', distance_m: 90 }], official })).toEqual({ kind: 'prohibited', zone_id: 'riviera' })
  })
  it('at an official stretch → official, carrying the operational status as given', () => {
    expect(swimVerdict({ distance_to_shore_m: 5, prohibited: [], official: [{ id: 'dostar', distance_m: 40, operational: 'CLOSED' }] }))
      .toEqual({ kind: 'official', zone_id: 'dostar', operational: 'CLOSED' })
  })
  it('rocks next to a beach are not the beach', () => {
    expect(swimVerdict({ distance_to_shore_m: 5, prohibited: [], official: [{ id: 'dostar', distance_m: 200, operational: 'OPEN' }] })).toEqual({ kind: 'unlisted' })
  })
  it('shore in neither list is unlisted, never "safe"', () => {
    expect(swimVerdict({ distance_to_shore_m: 30, prohibited: [], official: [] })).toEqual({ kind: 'unlisted' })
  })
  it('far from the sea → inland; unknown shore distance → inland', () => {
    expect(swimVerdict({ distance_to_shore_m: 4000, prohibited: [], official })).toEqual({ kind: 'inland' })
    expect(swimVerdict({ distance_to_shore_m: null, prohibited: [], official })).toEqual({ kind: 'inland' })
  })
})

describe('conditions are described on standard scales, never judged', () => {
  it('Beaufort / Douglas words', () => {
    expect(windWord(7)).toBe('moderate')
    expect(windWord(12)).toBe('strong')
    expect(seaWord(0.6)).toBe('moderate')
    expect(seaWord(1.5)).toBe('rough')
    expect(windWord(null)).toBeNull()
  })
  it('attention flags storm conditions only', () => {
    expect(describeConditions({ wind_ms: 7, gust_ms: 12, wave_m: 0.6 }).attention).toBe(false)
    expect(describeConditions({ wind_ms: 11, gust_ms: 16, wave_m: 0.6 }).attention).toBe(true)
    expect(describeConditions({ wind_ms: 4, gust_ms: 6, wave_m: 1.4 }).attention).toBe(true)
  })
  it('output has no notion of "safe"', () => {
    expect(JSON.stringify(describeConditions({ wind_ms: 2, gust_ms: 3, wave_m: 0.05, sea_temp_c: 24 }))).not.toMatch(/safe/i)
  })
})
