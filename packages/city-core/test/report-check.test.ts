import { describe, expect, it } from 'vitest'
import { intake, photoRequirement, reportDecision, spamRules, type AiReview } from '../src/index.ts'

const none = { duplicate_of: null, recent_count: 0, photo_seen_elsewhere: false }
const ai = (x: Partial<AiReview>): AiReview => ({ verdict: 'ok', is_city_problem: true, reasons: [], photo: 'none', photo_note: '', engine: 'test', ...x })

describe('photo policy', () => {
  it('visible problems need a photo; outages do not', () => {
    expect(photoRequirement(intake('Во дворе 15 мкр не горят фонари, темно'))).toBe('required')
    expect(photoRequirement(intake('12 мкр дом 45, мусор не вывозят третий день'))).toBe('required')
    expect(photoRequirement(intake('14 мкр, дом 21 — с утра нет воды'))).toBe('optional')
  })
  it('danger and gas never wait for a photo', () => {
    expect(photoRequirement(intake('Пахнет газом в подъезде, 14 мкр дом 21'))).toBe('optional')
    const hanging = intake('В 14 мкр возле дома 20 висит блок кондиционера, может упасть на людей')
    expect(hanging.risk).not.toBe('none')
    expect(photoRequirement(hanging)).toBe('optional')
  })
})

describe('spam rules', () => {
  it('real reports pass, informal or not', () => {
    expect(spamRules('14 мкр 21 дом нет воды с утра!!!', none)).toEqual([])
    expect(spamRules('15 ш/а шамдар жанбайды', none)).toEqual([])
  })
  it('gibberish, adverts and links', () => {
    expect(spamRules('asdfgh', none)).toContain('gibberish')
    expect(spamRules('ааааааааааааа', none)).toContain('gibberish')
    expect(spamRules('123 456 !!! ???', none)).toContain('gibberish')
    expect(spamRules('Продам квартиру в 14 мкр, звоните +7 701 123 45 67', none)).toContain('advert')
    expect(spamRules('Смотрите https://example.com про фонари в 15 мкр', none)).toEqual(['link'])
  })
  it('context: resent text, bursts, reused photo', () => {
    expect(spamRules('нет воды 14 мкр', { ...none, duplicate_of: 'INC-1050' })).toContain('duplicate')
    expect(spamRules('нет воды 14 мкр', { ...none, recent_count: 5 })).toContain('burst')
    expect(spamRules('нет воды 14 мкр', { ...none, photo_seen_elsewhere: true })).toContain('photo_reused')
  })
})

describe('report decision', () => {
  const base = { rules: [], ai: ai({}), photo_required: false, has_photo: false, risk: 'none' as const }
  it('clean report passes', () => {
    expect(reportDecision(base)).toMatchObject({ outcome: 'pass', code: 'ok', flags: [] })
  })
  it('blocking rules and a missing required photo block without the AI', () => {
    expect(reportDecision({ ...base, rules: ['advert'], ai: null })).toMatchObject({ outcome: 'block', code: 'advert' })
    expect(reportDecision({ ...base, photo_required: true })).toMatchObject({ outcome: 'block', code: 'photo_required' })
  })
  it('AI spam blocks only when it is not a city problem', () => {
    expect(reportDecision({ ...base, ai: ai({ verdict: 'spam', is_city_problem: false, reasons: ['реклама'] }) })).toMatchObject({ outcome: 'block', code: 'not_a_city_problem', reasons: ['реклама'] })
    expect(reportDecision({ ...base, ai: ai({ verdict: 'spam', is_city_problem: true }) })).toMatchObject({ outcome: 'confirm', code: 'suspicious' })
  })
  it('photo mismatch and doubts ask the resident, with the note first', () => {
    expect(reportDecision({ ...base, has_photo: true, ai: ai({ photo: 'mismatch', photo_note: 'на фото кот' }) })).toMatchObject({ outcome: 'confirm', code: 'photo_mismatch', reasons: ['на фото кот'] })
    expect(reportDecision({ ...base, ai: ai({ verdict: 'suspicious' }) })).toMatchObject({ outcome: 'confirm', flags: ['ai_suspicious'] })
  })
  it('AI down: the report goes through, flagged', () => {
    expect(reportDecision({ ...base, ai: null })).toMatchObject({ outcome: 'pass', flags: ['ai_unavailable'] })
  })
  it('elevated priority still gets the spam check; only imminent danger bypasses it', () => {
    expect(reportDecision({ ...base, rules: ['duplicate'], risk: 'elevated' })).toMatchObject({ outcome: 'block', code: 'duplicate' })
  })
  it('danger is never blocked or delayed, only flagged', () => {
    const d = reportDecision({ rules: ['gibberish'], ai: ai({ verdict: 'spam', is_city_problem: false }), photo_required: true, has_photo: false, risk: 'imminent' })
    expect(d.outcome).toBe('pass')
    expect(d.flags).toEqual(expect.arrayContaining(['gibberish', 'ai_spam']))
  })
})
