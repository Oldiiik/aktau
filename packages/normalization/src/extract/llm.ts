// Optional LLM stage (Claude). Used only when deterministic rules could not
// produce a complete structure. Output is schema-constrained, then validated
// against the strict ExtractionSchema, then grounded against the source text.
// If anything fails the candidate goes to REVIEW_REQUIRED — never to the city.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { CATEGORIES, EVENT_STATUSES } from '@aktau/types'
import { fmtDate, fmtTime } from '../time.ts'

// Structured-output schema: plain types only (the strict bounds are enforced
// afterwards by ExtractionSchema).
const LlmEvent = z.object({
  quote: z.string().describe('The exact sentence(s) from the source this event is based on, copied verbatim.'),
  category: z.enum(CATEGORIES),
  event_type: z.enum(['planned_outage', 'emergency_outage', 'restoration', 'road_closure', 'road_works', 'transport_change', 'weather_warning', 'public_event', 'other']),
  status: z.enum(EVENT_STATUSES),
  starts_at: z.string().nullable().describe('ISO 8601 with +05:00 offset, or null if not stated.'),
  expected_ends_at: z.string().nullable().describe('ISO 8601 with +05:00 offset, or null if not stated. Never estimate.'),
  areas: z.array(z.string()).describe("Microdistrict designators as written: '14', '3А', 'ШЫГЫС-2'. Empty if none stated."),
  buildings: z.array(z.string()).describe('House numbers explicitly listed. Empty if the text does not limit to buildings.'),
  partial_area: z.boolean(),
  reason: z.string().nullable(),
  authority: z.string().nullable().describe('Organisation the text attributes the information to (AUES, MAEK, KZHSA, AKIMAT, 109), or null.'),
})
const LlmOutput = z.object({ events: z.array(LlmEvent) })
export type LlmEvent = z.infer<typeof LlmEvent>

const SYSTEM = `You convert public-service announcements from Aktau, Kazakhstan (Russian or Kazakh) into structured records.

Rules — these are absolute:
- Copy facts only. If the text does not state a value, return null (or an empty list). Do not estimate, infer or "helpfully" complete anything: no guessed end times, no guessed districts, no guessed house numbers, no guessed reasons, no guessed organisations.
- If only specific houses are listed, list exactly those houses. Do not expand to the whole microdistrict.
- Resolve relative dates ("сегодня", "завтра", "ертең", "бүгін") against the publication time given to you. Times are local Aqtau time (UTC+05:00).
- One record per distinct notice (different time window or different district list).
- "quote" must be copied verbatim from the source.`

export type LlmConfig = { apiKey?: string; model?: string }

export function llmAvailable(cfg: LlmConfig = {}): boolean {
  return Boolean(cfg.apiKey ?? process.env.ANTHROPIC_API_KEY)
}

export async function extractWithLlm(
  input: { text: string; title?: string | null; published_at: Date },
  cfg: LlmConfig = {},
): Promise<{ events: LlmEvent[]; model: string } | { error: string }> {
  const apiKey = cfg.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'llm_not_configured' }
  const model = cfg.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-opus-5'
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })
  const ref = input.published_at
  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 4000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Publication time: ${fmtDate(ref, 'en')} ${ref.toISOString().slice(0, 4)}, ${fmtTime(ref)} (Aqtau, UTC+05:00)\n` +
          (input.title ? `Headline: ${input.title}\n` : '') + `\nSource text:\n<<<\n${input.text}\n>>>`,
      }],
      output_config: { format: zodOutputFormat(LlmOutput) },
    })
    if (response.stop_reason === 'refusal') return { error: 'llm_refused' }
    if (!response.parsed_output) return { error: 'llm_unparseable' }
    return { events: response.parsed_output.events, model }
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { error: 'llm_rate_limited' }
    if (err instanceof Anthropic.APIError) return { error: `llm_api_error_${err.status ?? 'unknown'}` }
    return { error: `llm_failed: ${(err as Error).message}` }
  }
}
