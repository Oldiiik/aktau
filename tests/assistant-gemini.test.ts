// Gemini engine with a mocked Gemini API on a real database: an overloaded
// model is skipped, a tool call runs and its result goes back with the same id
// and the model's thought signature, cards reach the client once, and the
// answer streams as text.
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createSql, runAssistant, type AssistantEvent, type Sql } from '@aktau/server'
import { migrate, seed } from '../packages/server/src/db/migrate.ts'

let db: PGlite
let server: PGLiteSocketServer
let sql: Sql

beforeAll(async () => {
  db = await PGlite.create({ extensions: { postgis } })
  server = new PGLiteSocketServer({ db, port: 0, maxConnections: 2 })
  await server.start()
  const port = (server as unknown as { server: { address(): { port: number } } }).server.address().port
  sql = createSql(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1 })
  await migrate(sql, () => {})
  await seed(sql, () => {})
})

afterAll(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await sql?.end()
  await server?.stop()
  await db?.close()
})

const sse = (...chunks: unknown[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })

describe('Gemini engine', () => {
  it('fails over, runs tools, preserves signatures, streams the answer', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_MODEL', 'model-busy,model-ok')
    const bodies: Array<{ url: string; body: any }> = []
    let okCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      bodies.push({ url, body: JSON.parse(String(init.body)) })
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key')
      if (url.includes('model-busy')) return new Response('{"error":{"code":503}}', { status: 503 })
      okCalls++
      if (okCalls === 1) {
        return sse(
          { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'prepare_109_report', args: { text: 'Не горит фонарь у дома 14 мкр, 21' } }, thoughtSignature: 'sig-1' }] } }] },
          { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'c2', name: 'prepare_109_report', args: { text: 'Не горит фонарь у дома 14 мкр, 21' } } }] }, finishReason: 'STOP' }] },
        )
      }
      return sse(
        { candidates: [{ content: { role: 'model', parts: [{ text: 'Подготовил обращение в 109. ' }] } }] },
        { candidates: [{ content: { role: 'model', parts: [{ text: 'Проверьте и отправьте.' }] }, finishReason: 'STOP' }] },
      )
    }))

    const events: AssistantEvent[] = []
    for await (const e of runAssistant(sql, { messages: [{ role: 'user', content: 'У дома не горит фонарь', images: [{ media_type: 'image/jpeg', data: 'AAAA' }] }], lang: 'ru', installation_id: null, here: { lat: 43.648, lon: 51.16 } })) events.push(e)

    // The busy model was tried once, then rested; everything else went to the healthy one.
    expect(bodies.filter((b) => b.url.includes('model-busy'))).toHaveLength(1)
    const [first, second] = bodies.filter((b) => b.url.includes('model-ok'))
    expect(first!.body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } })
    expect(first!.body.systemInstruction.parts[1].text).toMatch(/current location: 43\.64800, 51\.16000/)
    // The model turn goes back unchanged, then both results with their ids.
    expect(second!.body.contents[1]).toMatchObject({ role: 'model', parts: [{ thoughtSignature: 'sig-1' }, {}] })
    expect(second!.body.contents[2].parts.map((p: any) => p.functionResponse.id)).toEqual(['c1', 'c2'])

    const actions = events.filter((e) => e.type === 'action')
    expect(actions).toHaveLength(1) // the repeated call does not repeat the card
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toContain('Проверьте и отправьте.')
    expect(events.at(-1)).toEqual({ type: 'done', mode: 'gemini' })
  })
})
