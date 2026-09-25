import { describe, expect, it } from 'vitest'
import { extractCandidates, extractWithRules, groundExtraction, duplicateScore, fromLocal, localParts, rangesOverlap, fmtTime } from '../src/index.ts'
import lada from './fixtures/lada-2026-09-22-aues-power.json' with { type: 'json' }

const NOW = new Date('2026-09-23T15:00:00Z') // 20:00 in Aktau

describe('timezone conversion (Asia/Aqtau, UTC+5)', () => {
  it('local wall clock → UTC', () => {
    expect(fromLocal(2026, 9, 24, 13, 30).toISOString()).toBe('2026-09-24T08:30:00.000Z')
    expect(fromLocal(2026, 1, 1, 0, 0).toISOString()).toBe('2025-12-31T19:00:00.000Z')
  })
  it('UTC → local wall clock', () => {
    const p = localParts(new Date('2026-09-23T21:30:00Z'))
    expect([p.day, p.hour, p.minute]).toEqual([24, 2, 30])
    expect(fmtTime(new Date('2026-09-24T12:30:00Z'))).toBe('17:30')
  })
  it('relative dates are anchored to publication time, not "now"', () => {
    const [seg] = extractWithRules({ text: 'Завтра с 02:00 до 07:00 будет прекращена подача воды в 11 микрорайоне.', published_at: new Date('2026-09-20T05:00:00Z'), fetched_at: NOW })
    expect(seg!.extraction.starts_at).toBe('2026-09-20T21:00:00.000Z') // 21 Sep 02:00 local
  })
})

describe('time range overlap', () => {
  const d = (s: string) => new Date(s)
  it('overlapping / touching / disjoint / open-ended', () => {
    expect(rangesOverlap(d('2026-09-24T08:30Z'), d('2026-09-24T12:30Z'), d('2026-09-24T10:00Z'), d('2026-09-24T10:01Z'))).toBe(true)
    expect(rangesOverlap(d('2026-09-24T08:30Z'), d('2026-09-24T12:30Z'), d('2026-09-24T12:30Z'), d('2026-09-24T13:00Z'))).toBe(false)
    expect(rangesOverlap(d('2026-09-24T08:30Z'), d('2026-09-24T12:30Z'), d('2026-09-25T00:00Z'), d('2026-09-25T07:00Z'))).toBe(false)
    expect(rangesOverlap(d('2026-09-24T08:30Z'), null, d('2026-09-30T00:00Z'), d('2026-09-30T01:00Z'))).toBe(true) // unknown end
  })
})

describe('real source: Lada.kz article attributing AUES (2026-09-22)', () => {
  const segs = extractWithRules({ text: lada.raw_text, title: lada.title, published_at: new Date(lada.published_at), fetched_at: new Date('2026-09-22T04:30:00Z') })
  it('splits one article into three notices', () => expect(segs).toHaveLength(3))
  it('keeps the utility as authority (publisher is Lada)', () => segs.forEach((s) => expect(s.extraction.authority).toBe('AUES')))
  it('resolves "сегодня" from the headline to the publication day', () => {
    expect(segs[2]!.extraction.starts_at).toBe('2026-09-22T08:30:00.000Z')
    expect(segs[2]!.extraction.expected_ends_at).toBe('2026-09-22T12:30:00.000Z')
  })
  it('limits 14 mkr to the listed houses (incl. letter suffixes)', () => {
    expect(segs[2]!.extraction.areas).toEqual(['14'])
    expect(segs[2]!.extraction.buildings).toEqual(['41', '42', '43', '44', '46', '46Б', '45', '45Б', '46А', '46В'])
  })
  it('marks the Tolkyn-1 segment as partial, with no invented houses', () => {
    expect(segs[1]!.extraction.areas).toEqual(['ТОЛКЫН-1'])
    expect(segs[1]!.extraction.partial_area).toBe(true)
    expect(segs[1]!.extraction.buildings).toEqual([])
  })
})

describe('fixtures', () => {
  it('A — electricity, 14 mkr, houses 19–23, 13:30–17:30, scheduled', () => {
    const [s] = extractWithRules({ text: 'АУЭС: 24 сентября с 13:30 до 17:30 будет отключена электроэнергия в 14 микрорайоне, дома 19, 20, 21, 22, 23.', fetched_at: NOW })
    expect(s!.extraction).toMatchObject({ category: 'ELECTRICITY', status: 'SCHEDULED', event_type: 'planned_outage', areas: ['14'], buildings: ['19', '20', '21', '22', '23'], authority: 'AUES' })
    expect(s!.errors).toEqual([])
  })
  it('A′ — house ranges expand ("дома 19–23")', () => {
    const [s] = extractWithRules({ text: '24 сентября с 13:30 до 17:30 отключение электроэнергии в 14 микрорайоне, дома 19–23.', fetched_at: NOW })
    expect(s!.extraction.buildings).toEqual(['19', '20', '21', '22', '23'])
  })
  it('B — water, several microdistricts, overnight 02:00–07:00, planned', () => {
    const [s] = extractWithRules({ text: 'МАЭК: 25 сентября с 02:00 до 07:00 будет прекращена подача воды в 11, 12, 13 и 14 микрорайонах.', fetched_at: NOW })
    expect(s!.extraction.areas).toEqual(['11', '12', '13', '14'])
    expect(s!.extraction.buildings).toEqual([])
    expect(s!.extraction.starts_at).toBe('2026-09-24T21:00:00.000Z')
    expect(s!.extraction.expected_ends_at).toBe('2026-09-25T02:00:00.000Z')
  })
  it('C — water incident, 7 mkr, specific houses, ETA unknown → null', () => {
    const [s] = extractWithRules({ text: 'В связи с аварией на водоводе прекращена подача питьевой воды в 7 микрорайоне, дома 5, 6 и 8. Время восстановления будет сообщено дополнительно.', fetched_at: NOW })
    expect(s!.extraction).toMatchObject({ category: 'WATER', event_type: 'emergency_outage', status: 'ACTIVE', areas: ['7'], buildings: ['5', '6', '8'] })
    expect(s!.extraction.expected_ends_at).toBeNull()
    expect(s!.warnings.map((w) => w.code)).toContain('eta_not_announced')
  })
  it('Kazakh notice', () => {
    const [s] = extractWithRules({ text: 'Ертең сағат 10:00-ден 16:00-ге дейін 15 шағын аудандағы 12, 14 үйлерде электр қуаты өшіріледі.', published_at: new Date('2026-09-23T10:00:00Z'), fetched_at: NOW })
    expect(s!.extraction).toMatchObject({ category: 'ELECTRICITY', areas: ['15'], buildings: ['12', '14'] })
    expect(s!.extraction.starts_at).toBe('2026-09-24T05:00:00.000Z')
  })
})

describe('unknown ETA remains null — the LLM cannot add it', () => {
  it('grounding strips an invented ETA, house and authority', () => {
    const text = 'Прекращена подача воды в 7 микрорайоне, дома 5 и 6.'
    const { extraction, errors } = groundExtraction({
      category: 'WATER', event_type: 'emergency_outage', status: 'ACTIVE', title: 'x', summary: null,
      starts_at: null, expected_ends_at: '2026-09-23T15:00:00.000Z', // "20:00" — not in the text
      areas: ['7', '9'], buildings: ['5', '6', '12'], partial_area: false, reason: 'плановые работы', authority: 'MAEK',
      time_text: null, location_text: null, confidence: 0.7,
    }, text)
    expect(extraction.expected_ends_at).toBeNull()
    expect(extraction.areas).toEqual(['7'])
    expect(extraction.buildings).toEqual(['5', '6'])
    expect(extraction.authority).toBeNull()
    expect(extraction.reason).toBeNull()
    expect(errors.map((e) => e.field).sort()).toEqual(['areas', 'authority', 'buildings', 'expected_ends_at', 'reason'])
  })
  it('pipeline without LLM never fabricates missing fields', async () => {
    const [c] = await extractCandidates({ text: 'Внимание жителям! Возможны перебои.', fetched_at: NOW }, { llm: false })
    expect(c!.review_required).toBe(true)
    expect(c!.extraction.starts_at).toBeNull()
    expect(c!.extraction.expected_ends_at).toBeNull()
    expect(c!.extraction.areas).toEqual([])
  })
})

describe('deduplication', () => {
  const base = { category: 'ELECTRICITY' as const, event_type: 'planned_outage', areas: ['14'], buildings: ['19', '20', '21', '22', '23'], starts_at: new Date('2026-09-24T08:30:00Z'), expected_ends_at: new Date('2026-09-24T12:30:00Z'), reason: 'плановые работы', authority: 'AUES' }
  it('the same outage reported by two sources is one event', () => {
    expect(duplicateScore(base, { ...base, buildings: ['19', '20', '21', '22', '23'], reason: null, authority: 'AUES' }).verdict).toBe('same')
  })
  it('different districts or services are different events', () => {
    expect(duplicateScore(base, { ...base, areas: ['15'] }).verdict).toBe('different')
    expect(duplicateScore(base, { ...base, category: 'WATER' }).verdict).toBe('different')
  })
  it('a far-apart time window is not the same event', () => {
    expect(duplicateScore(base, { ...base, starts_at: new Date('2026-09-26T08:30:00Z'), buildings: ['41'] }).verdict).not.toBe('same')
  })
})
