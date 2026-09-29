// The gate in front of 109 for resident reports from the app.
//   1. rules (instant, no AI): gibberish, adverts, the same text resent,
//      bursts, a photo already sent from another phone
//   2. AI review (Claude when ANTHROPIC_API_KEY is set, else Gemini): is this a
//      real city problem, and does the photo show what the text says
//   3. reportDecision (city-core): block only obvious spam, with the reason
//      shown so the resident can fix it; ask "send anyway?" when in doubt;
//      never hold back a report about danger; if the AI is down, let it through.
// Blocked text is not stored. Everything that passes keeps its check for 109.
import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { normaliseReport, photoRequirement, reportDecision, spamRules, BLOCKING_RULES, type AiReview, type Intake, type ReportDecision, type SpamRule } from '@aktau/city-core'
import { z } from 'zod'
import { geminiAvailable, geminiJSON } from './assistant-gemini.ts'
import type { Sql } from './db/client.ts'
import { log } from './log.ts'

export type ReportPhotoInput = { media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }
export type StoredPhoto = { image: string; sha256: string; bytes: number }
export type ReportCheck = ReportDecision & { rules: SpamRule[]; ai: AiReview | null; photo_required: boolean; duplicate_of: string | null; ms: number }

export function storedPhoto(p: ReportPhotoInput): StoredPhoto {
  const buf = Buffer.from(p.data, 'base64')
  return { image: `data:${p.media_type};base64,${p.data}`, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length }
}

const SYSTEM = `You screen reports that residents of Aktau, Kazakhstan send through a city app to 109, the city's non-emergency contact centre (utilities, lighting, waste, roads, yards, elevators, building hazards, transport).

Decide whether the report is a genuine report of a city problem.
- "ok": a real city problem, even if short, angry, informal, misspelled, or in Russian, Kazakh or English mixed.
- "suspicious": possibly real, but something is off: the photo does not show what the text describes, the details contradict each other, or it reads like a copy of someone else's report.
- "spam": not a city problem report: advertising, gibberish, tests ("test", "hello"), jokes, insults with no problem described, personal disputes, questions unrelated to city services.
When unsure between ok and suspicious, choose ok: blocking a real complaint is worse than letting a doubtful one reach an operator.

If a photo is attached, say whether it plausibly shows the described problem: "matches", "mismatch" (clearly shows something unrelated, e.g. a selfie, a screenshot, a meme, food, a different kind of problem), or "unclear" (too dark, too close, cannot tell). Use "none" when there is no photo. Never identify or describe people.

reasons: at most three short phrases for the resident, in the language of the report, only when the verdict is not "ok". photo_note: one short phrase in that language when the photo is "mismatch" or "unclear", otherwise an empty string.`

const Review = z.object({
  verdict: z.enum(['ok', 'suspicious', 'spam']),
  is_city_problem: z.boolean(),
  reasons: z.array(z.string()),
  photo: z.enum(['matches', 'mismatch', 'unclear', 'none']),
  photo_note: z.string(),
})
// The same shape for Gemini's responseSchema (OpenAPI subset).
const GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'suspicious', 'spam'] },
    is_city_problem: { type: 'boolean' },
    reasons: { type: 'array', items: { type: 'string' } },
    photo: { type: 'string', enum: ['matches', 'mismatch', 'unclear', 'none'] },
    photo_note: { type: 'string' },
  },
  required: ['verdict', 'is_city_problem', 'reasons', 'photo', 'photo_note'],
}

const claudeAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
export const reportAiAvailable = () => claudeAvailable() || geminiAvailable()

/**
 * The AI half of the check. null when no engine is configured or it failed / timed out.
 * A resident is waiting on "Send", so the review gets a short deadline and then
 * fails open, as when the AI is down (a busy free-tier model once held reports for 30 s).
 */
export async function aiReview(text: string, intake: Pick<Intake, 'service' | 'lang'>, photo: ReportPhotoInput | null): Promise<AiReview | null> {
  const ms = photo ? 15_000 : 8_000
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => { log('warn', 'report_check.ai_deadline', { ms }); resolve(null) }, ms) })
  try {
    return await Promise.race([review(text, intake, photo, ms), deadline])
  } finally {
    clearTimeout(timer)
  }
}

async function review(text: string, intake: Pick<Intake, 'service' | 'lang'>, photo: ReportPhotoInput | null, ms: number): Promise<AiReview | null> {
  const prompt = `Report (detected language: ${intake.lang}; the app's guess at the problem type: ${intake.service}):\n"""\n${text.slice(0, 2000)}\n"""\n${photo ? 'A photo is attached above.' : 'No photo attached.'}`
  try {
    if (claudeAvailable()) {
      const client = new Anthropic({ timeout: ms, maxRetries: 0 })
      const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5'
      const r = await client.messages.parse({
        model, max_tokens: 4000, output_config: { effort: 'low', format: zodOutputFormat(Review) }, system: SYSTEM,
        messages: [{ role: 'user', content: [...(photo ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: photo.media_type, data: photo.data } }] : []), { type: 'text' as const, text: prompt }] }],
      })
      if (!r.parsed_output) return null
      return clean(r.parsed_output, `claude:${model}`, !!photo)
    }
    if (geminiAvailable()) {
      const { data, model } = await geminiJSON<unknown>({ system: SYSTEM, text: prompt, images: photo ? [photo] : [], schema: GEMINI_SCHEMA, timeoutMs: ms })
      return clean(Review.parse(data), `gemini:${model}`, !!photo)
    }
  } catch (err) {
    log('warn', 'report_check.ai_failed', { err: err as Error })
  }
  return null
}

function clean(r: z.infer<typeof Review>, engine: string, hasPhoto: boolean): AiReview {
  return { ...r, photo: hasPhoto ? r.photo : 'none', reasons: r.reasons.map((x) => x.slice(0, 160)).slice(0, 3), photo_note: r.photo_note.slice(0, 200), engine }
}

/** Run the whole gate for a new report. */
export async function checkReport(sql: Sql, input: { text: string; intake: Intake; photo: ReportPhotoInput | null; installation_id: string | null; now?: Date }): Promise<ReportCheck> {
  const t0 = performance.now()
  const now = input.now ?? new Date()
  const norm = normaliseReport(input.text)
  const hash = input.photo ? storedPhoto(input.photo).sha256 : null
  const [recent, seen] = await Promise.all([
    input.installation_id
      ? sql<{ raw_text: string; created_at: Date; code: string | null }[]>`
          select s.raw_text, s.created_at, i.code from incident_signals s left join incidents i on i.id = s.incident_id
          where s.installation_id = ${input.installation_id} and s.created_at > ${new Date(now.getTime() - 86400_000)} order by s.created_at desc limit 50`
      : Promise.resolve([]),
    hash ? sql<{ n: number }[]>`select count(*)::int n from incident_signals where photo->>'sha256' = ${hash} and installation_id is distinct from ${input.installation_id}` : Promise.resolve([{ n: 0 }]),
  ])
  const dup = recent.find((r) => normaliseReport(r.raw_text) === norm)
  const rules = spamRules(input.text, {
    duplicate_of: dup ? dup.code ?? 'pending' : null,
    recent_count: recent.filter((r) => new Date(r.created_at).getTime() > now.getTime() - 3600_000).length,
    photo_seen_elsewhere: (seen[0]?.n ?? 0) > 0,
  })
  const photo_required = photoRequirement(input.intake) === 'required'
  // Obvious spam or a missing required photo is decided without spending an AI call.
  const decidedByRules = input.intake.risk !== 'imminent' && (rules.some((r) => BLOCKING_RULES.includes(r)) || (photo_required && !input.photo))
  const ai = decidedByRules ? null : await aiReview(input.text, input.intake, input.photo)
  const decision = reportDecision({ rules, ai, photo_required, has_photo: !!input.photo, risk: input.intake.risk })
  // "ai_unavailable" is not a doubt about the report when the rules settled it.
  if (decidedByRules) decision.flags = decision.flags.filter((f) => f !== 'ai_unavailable')
  return { ...decision, rules, ai, photo_required, duplicate_of: dup?.code ?? null, ms: Math.round(performance.now() - t0) }
}
