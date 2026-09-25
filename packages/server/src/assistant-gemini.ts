// Gemini engine for the Aktau assistant: the same tools, system prompt and
// NDJSON events as the Claude path in assistant.ts, over the Gemini REST API
// (streamGenerateContent, SSE). Models are tried in order; one that is
// overloaded or out of quota rests for a few minutes and the next one answers.
//
// Web search is a function tool here that runs a separate Google-Search-grounded
// request (Gemini does not mix its search tool with custom functions on every
// tier). When the key's tier has no search quota it says so and the model
// answers from general knowledge, flagged as possibly out of date.
import { z } from 'zod'
import { ASSISTANT_SYSTEM, TOOL_LABEL, TOOL_SPECS, cardEmitter, contextLine, runTool, type AssistantEvent, type ChatTurn, type Ctx, type ToolSpec } from './assistant.ts'
import { log } from './log.ts'

const API = 'https://generativelanguage.googleapis.com/v1beta'
// Fastest reliable first; newer Flash models are often overloaded (503) on the free tier.
const DEFAULT_MODELS = 'gemini-3.5-flash,gemini-3.7-flash,gemini-3.8-flash,gemini-3-flash-preview'

export const geminiAvailable = () => Boolean(process.env.GEMINI_API_KEY)
const models = () => (process.env.GEMINI_MODEL || DEFAULT_MODELS).split(',').map((m) => m.trim()).filter(Boolean)

/** model → time it may be tried again. */
const resting = new Map<string, number>()
// Out of quota rests long; a transient overload only briefly, so the fast model comes back soon.
const REST_MS: Record<number, number> = { 404: 3600_000, 429: 5 * 60_000, 500: 60_000, 503: 60_000 }
let searchRestUntil = 0

type Part = {
  text?: string; thought?: boolean; thoughtSignature?: string
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> }
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> }
  inlineData?: { mimeType: string; data: string }
}
type Content = { role: 'user' | 'model'; parts: Part[] }
type Chunk = {
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string; groundingMetadata?: { groundingChunks?: Array<{ web?: { uri: string; title?: string } }> } }>
  promptFeedback?: { blockReason?: string }
}

class GeminiError extends Error {
  constructor(readonly status: number, detail: string) { super(`Gemini HTTP ${status}: ${detail}`) }
}

const WEB_SEARCH: ToolSpec = {
  name: 'web_search',
  description: 'Search the web (Google) only when the Aktau tools have nothing: general knowledge that changes (prices, schedules, rules, exchange rates, opening dates). Returns a short grounded answer with sources.',
  schema: { type: 'object', properties: { query: { type: 'string', description: 'What to look up, in any language.' } }, required: ['query'] },
}

const headers = () => ({ 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' })

const CUT_OFF: Record<Ctx['lang'], string> = {
  en: '…\n\n**The answer was cut off by the AI service.** Ask again for the rest.',
  ru: '…\n\n**Ответ оборвался на стороне ИИ-сервиса.** Спросите ещё раз, чтобы получить остальное.',
  kk: '…\n\n**Жауап ЖИ сервисі жағында үзіліп қалды.** Қалғанын алу үшін қайта сұраңыз.',
}

/** POST to the first model that is not resting; overloaded / out-of-quota models rest and the next one is tried. */
async function post(action: 'streamGenerateContent?alt=sse' | 'generateContent', body: unknown, timeoutMs = 90_000): Promise<{ res: Response; model: string }> {
  let lastErr: GeminiError | null = null
  for (let pass = 0; pass < 2; pass++) {
    for (const m of models()) {
      if ((resting.get(m) ?? 0) > Date.now()) continue
      const res = await fetch(`${API}/models/${m}:${action}`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok && res.body) return { res, model: m }
      lastErr = new GeminiError(res.status, (await res.text().catch(() => '')).slice(0, 300))
      if (REST_MS[res.status]) { resting.set(m, Date.now() + REST_MS[res.status]!); log('warn', 'assistant.gemini_model_resting', { model: m, status: res.status }); continue }
      throw lastErr
    }
    // Every model was resting: wake them all and try once more.
    if (!lastErr) resting.clear()
    else break
  }
  throw lastErr ?? new GeminiError(503, 'no model available')
}

async function* sse(res: Response): AsyncGenerator<Chunk> {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    // The last event may end without a blank line: flush it too.
    buf = (buf + (done ? `${dec.decode()}\n\n` : dec.decode(value, { stream: true }))).replace(/\r\n/g, '\n')
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const data = buf.slice(0, i).split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
      buf = buf.slice(i + 2)
      if (data) yield JSON.parse(data) as Chunk
    }
    if (done) break
  }
}

async function webSearch(args: unknown, sources: Map<string, string>) {
  const { query } = z.object({ query: z.string().min(2).max(200) }).parse(args)
  const unavailable = { unavailable: true, note: 'Web search is not available right now. Answer from general knowledge if you can, and say it may be out of date.' }
  if (searchRestUntil > Date.now()) return unavailable
  try {
    // Its own request on the first healthy model; a search quota error must not rest the chat models.
    const model = models().find((m) => (resting.get(m) ?? 0) <= Date.now()) ?? models()[0]
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST', headers: headers(), signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Search the web and answer briefly with concrete facts and dates. The user lives in Aktau, Kazakhstan. Question: ${query}` }] }],
        tools: [{ googleSearch: {} }],
      }),
    })
    if (!res.ok) throw new GeminiError(res.status, (await res.text().catch(() => '')).slice(0, 200))
    const d = await res.json() as Chunk
    const c = d.candidates?.[0]
    const answer = (c?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim()
    const found = (c?.groundingMetadata?.groundingChunks ?? []).flatMap((g) => (g.web ? [g.web] : []))
    for (const w of found.slice(0, 5)) sources.set(w.uri, w.title ?? '')
    return { answer, sources: found.slice(0, 5).map((w) => w.title ?? w.uri) }
  } catch (err) {
    if (err instanceof GeminiError && err.status === 429) searchRestUntil = Date.now() + 10 * 60_000
    log('warn', 'assistant.gemini_search_failed', { err: err as Error })
    return unavailable
  }
}

export async function* runGemini(ctx: Ctx, turns: ChatTurn[], fallback: () => AsyncGenerator<AssistantEvent>): AsyncGenerator<AssistantEvent> {
  const contents: Content[] = turns.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(t.images ?? []).map((im) => ({ inlineData: { mimeType: im.media_type, data: im.data } })),
      { text: t.content || (t.images?.length ? 'What is in this photo?' : '…') },
    ],
  }))
  const systemInstruction = { parts: [{ text: ASSISTANT_SYSTEM }, { text: await contextLine(ctx) }] }
  const tools = [{ functionDeclarations: [...TOOL_SPECS, WEB_SEARCH].map((t) => ({ name: t.name, description: t.description, parameters: t.schema })) }]
  const { queue, emit } = cardEmitter()
  const sources = new Map<string, string>()
  // Tool routing and short answers do not need deep thinking; GEMINI_THINKING=high for harder use.
  const generationConfig = { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING || 'low' } }

  let retried = false
  for (let step = 0; step < 8; step++) {
    let res: Response
    try {
      res = (await post('streamGenerateContent?alt=sse', { systemInstruction, contents, tools, generationConfig })).res
    } catch (err) {
      log('warn', 'assistant.gemini_error', { err: err as Error })
      const status = err instanceof GeminiError ? err.status : 0
      // A bad or revoked key: answer in basic mode instead of failing.
      if (step === 0 && (status === 400 || status === 401 || status === 403) && /api key|API_KEY|permission/i.test((err as Error).message)) { yield* fallback(); return }
      yield { type: 'error', message: status === 429 ? 'The assistant is busy. Try again in a minute.' : 'The assistant could not answer. Try again.' }
      return
    }
    const parts: Part[] = []
    let blocked = false
    let finish: string | undefined
    let shown = false
    for await (const chunk of sse(res)) {
      if (chunk.promptFeedback?.blockReason) blocked = true
      const c = chunk.candidates?.[0]
      for (const p of c?.content?.parts ?? []) {
        parts.push(p)
        if (p.text && !p.thought) { shown = true; yield { type: 'text', delta: p.text } }
        if (p.functionCall) yield { type: 'status', tool: p.functionCall.name, label: TOOL_LABEL[p.functionCall.name]?.[ctx.lang] ?? p.functionCall.name }
      }
      if (c?.finishReason) finish = c.finishReason
      if (c?.finishReason && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(c.finishReason)) blocked = true
    }
    if (finish !== 'STOP') log('warn', 'assistant.gemini_finish', { finish: finish ?? 'none', step, parts: parts.length })
    if (blocked) { yield { type: 'error', message: 'The assistant cannot help with that.' }; break }
    const calls = parts.filter((p) => p.functionCall)
    // The stream can end with no finish reason (the model was cut off mid-answer). Nothing shown yet:
    // ask once more. Otherwise say so, instead of leaving a sentence that silently stops.
    if (!calls.length && !finish) {
      if (!shown && !retried) { retried = true; step--; continue }
      if (shown) yield { type: 'text', delta: CUT_OFF[ctx.lang] }
      break
    }
    if (!calls.length) break
    // The model's turn goes back unchanged (thought signatures included).
    contents.push({ role: 'model', parts })
    const responses: Part[] = await Promise.all(calls.map(async (p) => {
      const fc = p.functionCall!
      let result: unknown
      try {
        result = fc.name === 'web_search' ? await webSearch(fc.args, sources) : await runTool(ctx, fc.name, fc.args ?? {}, emit)
      } catch (e) {
        result = { error: e instanceof z.ZodError ? `INVALID_INPUT ${JSON.stringify(e.issues)}` : (e as Error).message }
      }
      return { functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name, response: { result } } }
    }))
    while (queue.length) yield queue.shift()!
    contents.push({ role: 'user', parts: responses })
    yield { type: 'text', delta: '\n\n' }
  }
  while (queue.length) yield queue.shift()!
  if (sources.size) yield { type: 'sources', sources: [...sources].slice(0, 5).map(([url, title]) => ({ url, title })) }
  yield { type: 'done', mode: 'gemini' }
}

/** One structured JSON answer (responseSchema) from the first healthy model, e.g. the 109 report check. */
export async function geminiJSON<T>(o: { system: string; text: string; images?: Array<{ media_type: string; data: string }>; schema: unknown; timeoutMs?: number }): Promise<{ data: T; model: string }> {
  const { res, model } = await post('generateContent', {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: 'user', parts: [...(o.images ?? []).map((im) => ({ inlineData: { mimeType: im.media_type, data: im.data } })), { text: o.text }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: o.schema, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'low' } },
  }, o.timeoutMs ?? 20_000)
  const d = await res.json() as Chunk
  const text = (d.candidates?.[0]?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join('')
  return { data: JSON.parse(text) as T, model }
}
