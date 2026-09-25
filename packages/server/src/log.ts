// Structured JSON logs. Never log precise personal locations, push tokens,
// installation ids in full, or secrets.
type Level = 'debug' | 'info' | 'warn' | 'error'

const REDACT = /token|secret|password|authorization|push|api[_-]?key|lat|lon|point/i

function scrub(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(extra)) {
    if (REDACT.test(k)) out[k] = '[redacted]'
    else if (k === 'installation_id' && typeof v === 'string') out[k] = `${v.slice(0, 4)}…`
    else if (v instanceof Error) out[k] = { message: v.message, name: v.name }
    else out[k] = v
  }
  return out
}

export function log(level: Level, event: string, extra?: Record<string, unknown>) {
  if (level === 'debug' && !process.env.DEBUG) return
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...scrub(extra) })
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}
