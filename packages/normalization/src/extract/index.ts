// Extraction pipeline: DETERMINISTIC FIRST, LLM SECOND, GROUNDING ALWAYS.
import { ExtractionSchema, type ExtractedCandidate, type Extraction, type ExtractionWarning } from '@aktau/types'
import { canonicalNumberDesignator, parseDistrictDesignator } from '../text.ts'
import { groundExtraction } from './grounding.ts'
import { extractWithLlm, llmAvailable, type LlmConfig, type LlmEvent } from './llm.ts'
import { PARSER_VERSION, extractWithRules, type ExtractInput } from './rules.ts'

export { PARSER_VERSION, extractWithRules, type ExtractInput } from './rules.ts'
export { groundExtraction } from './grounding.ts'
export { llmAvailable } from './llm.ts'

export type PipelineOptions = { llm?: LlmConfig | false; autoApproveMinConfidence?: number }

const HARD = new Set(['category_unknown', 'no_location', 'buildings_without_area', 'schema_invalid', 'ungrounded'])

function finalize(
  index: number, text: string, extraction: Extraction, extractor: ExtractedCandidate['extractor'],
  warnings: ExtractionWarning[], errors: ExtractionWarning[], minConfidence: number,
): ExtractedCandidate {
  const v = ExtractionSchema.safeParse(extraction)
  if (!v.success) errors.push({ field: '*', code: 'schema_invalid', message: v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
  return {
    segment_index: index,
    segment_text: text,
    extraction: v.success ? v.data : extraction,
    extractor,
    parser_version: extractor === 'rules' ? PARSER_VERSION : `${PARSER_VERSION}+llm`,
    warnings,
    errors,
    review_required: errors.some((e) => HARD.has(e.code)) || extraction.confidence < minConfidence || extractor !== 'rules',
  }
}

function llmToExtraction(ev: LlmEvent, fallbackTitle: string): Extraction {
  const areas = ev.areas
    .map((a) => parseDistrictDesignator(`${a} микрорайон`) ?? (/^\d{1,2}\s?[а-яa-z]?$/i.test(a.trim()) ? canonicalNumberDesignator(a) : null))
    .filter((a): a is string => !!a)
  return {
    category: ev.category,
    event_type: ev.event_type,
    status: ev.status,
    title: fallbackTitle,
    summary: ev.quote.slice(0, 600),
    starts_at: ev.starts_at,
    expected_ends_at: ev.expected_ends_at,
    areas,
    buildings: ev.buildings.map((b) => b.replace(/№/g, '').trim()).filter(Boolean),
    partial_area: ev.partial_area,
    reason: ev.reason,
    authority: ev.authority?.toUpperCase() ?? null,
    time_text: null,
    location_text: null,
    confidence: 0.6,
  }
}

/**
 * Source text → candidate events. Rules produce the baseline. When rules leave
 * hard gaps (unknown service, no location, nothing found) and an LLM is
 * configured, the LLM proposes a structure; each proposed value is grounded
 * against the text, and the result always requires human review.
 */
export async function extractCandidates(input: ExtractInput, opts: PipelineOptions = {}): Promise<ExtractedCandidate[]> {
  const minConfidence = opts.autoApproveMinConfidence ?? 0.8
  const rules = extractWithRules(input)
  const out: ExtractedCandidate[] = rules.map((r) => finalize(r.index, r.text, r.extraction, 'rules', r.warnings, [...r.errors], minConfidence))

  const needsLlm = out.length === 0 || out.some((c) => c.errors.some((e) => HARD.has(e.code)))
  if (!needsLlm || opts.llm === false || !llmAvailable(opts.llm || {})) {
    if (out.length === 0) {
      out.push(finalize(0, input.text.slice(0, 2000), {
        category: 'OTHER', event_type: 'other', status: 'UNCONFIRMED', title: input.title?.slice(0, 200) || 'Unstructured notice',
        summary: input.text.slice(0, 600), starts_at: null, expected_ends_at: null, areas: [], buildings: [], partial_area: false,
        reason: null, authority: input.reported_authority ?? null, time_text: null, location_text: null, confidence: 0.1,
      }, 'rules', [], [{ field: '*', code: 'no_location', message: 'Rules found no dated, located notice in this text.' }], minConfidence))
    }
    return out
  }

  const llm = await extractWithLlm({ text: input.text, title: input.title, published_at: input.published_at ?? input.fetched_at }, opts.llm || {})
  if ('error' in llm) {
    for (const c of out) c.warnings.push({ field: '*', code: 'llm_unavailable', message: llm.error })
    return out
  }

  const results: ExtractedCandidate[] = out.filter((c) => !c.errors.some((e) => HARD.has(e.code)))
  llm.events.forEach((ev, i) => {
    // The quote itself must come from the source.
    const quoteOk = input.text.replace(/\s+/g, ' ').includes(ev.quote.replace(/\s+/g, ' ').slice(0, 80))
    const draft = llmToExtraction(ev, `${ev.category.toLowerCase().replace('_', ' ')} notice`)
    const { extraction, errors } = groundExtraction(draft, input.text)
    if (!quoteOk) errors.push({ field: 'quote', code: 'ungrounded', message: 'LLM quote is not a verbatim excerpt of the source.' })
    // Keep what rules already established for the same segment (rules win on concrete fields).
    const twin = out.find((c) => c.segment_text.includes(ev.quote.slice(0, 40)))
    if (twin) {
      if (twin.extraction.starts_at) extraction.starts_at = twin.extraction.starts_at
      if (twin.extraction.expected_ends_at) extraction.expected_ends_at = twin.extraction.expected_ends_at
      if (twin.extraction.areas.length) extraction.areas = twin.extraction.areas
      if (twin.extraction.buildings.length) extraction.buildings = twin.extraction.buildings
      extraction.time_text = twin.extraction.time_text
      extraction.location_text = twin.extraction.location_text
    }
    const warnings: ExtractionWarning[] = [{ field: '*', code: 'llm_structured', message: `Structured by ${llm.model}; every value was checked against the source text.` }]
    if (!extraction.areas.length && !extraction.buildings.length) errors.push({ field: 'areas', code: 'no_location', message: 'No grounded location.' })
    results.push(finalize(out.length + i, ev.quote, extraction, 'rules+llm', warnings, errors, minConfidence))
  })
  return results.length ? results : out
}
