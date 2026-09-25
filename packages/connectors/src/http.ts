// Server-side HTTP for connectors: timeouts, gzip, redirects, a polite per-host
// minimum interval, an honest User-Agent, and a DNS fallback. Some resolvers
// (seen on the dev network) refuse AAAA lookups and make getaddrinfo fail for
// hosts that resolve fine over A records — we then resolve A records directly.
import { promises as dns, lookup as sysLookup, type LookupAddress } from 'node:dns'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'

export type HttpResponse = { status: number; text: string; headers: Record<string, string | string[] | undefined>; url: string; ms: number }
export type HttpOptions = { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string>; timeoutMs?: number; minIntervalMs?: number }

export const USER_AGENT = process.env.CONTACT_UA || 'AktauCityApp/0.1 (+https://github.com/aktau-city; hackathon)'

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

function resilientLookup(hostname: string, options: { all?: boolean } | number, cb: LookupCb) {
  const opts = typeof options === 'number' ? { family: options } : options
  sysLookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (!err && Array.isArray(addrs) && addrs.length) {
      if ((opts as { all?: boolean }).all) return cb(null, addrs)
      return cb(null, addrs[0]!.address, addrs[0]!.family)
    }
    dns.resolve4(hostname).then(
      (a) => ((opts as { all?: boolean }).all ? cb(null, a.map((address) => ({ address, family: 4 }))) : cb(null, a[0]!, 4)),
      () => cb(err ?? Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), ''),
    )
  })
}

const lastHit = new Map<string, number>()
async function politeWait(host: string, minIntervalMs: number) {
  const last = lastHit.get(host) ?? 0
  const wait = last + minIntervalMs - Date.now()
  lastHit.set(host, Math.max(Date.now(), last + minIntervalMs))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

export async function httpFetch(url: string, opts: HttpOptions = {}, redirects = 3): Promise<HttpResponse> {
  const u = new URL(url)
  if (opts.minIntervalMs) await politeWait(u.host, opts.minIntervalMs)
  const t0 = Date.now()
  const req = u.protocol === 'http:' ? httpRequest : httpsRequest
  return await new Promise<HttpResponse>((resolve, reject) => {
    const r = req(u, {
      method: opts.method ?? 'GET',
      lookup: resilientLookup as never,
      headers: {
        'user-agent': USER_AGENT,
        'accept-encoding': 'gzip, deflate, br',
        accept: 'application/json, text/html;q=0.9, */*;q=0.5',
        ...(opts.body ? { 'content-length': Buffer.byteLength(opts.body).toString() } : {}),
        ...opts.headers,
      },
      timeout: opts.timeoutMs ?? 15_000,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
          resolve(httpFetch(new URL(res.headers.location, u).toString(), { ...opts, minIntervalMs: 0 }, redirects - 1))
          return
        }
        let buf = Buffer.concat(chunks)
        try {
          const enc = res.headers['content-encoding']
          if (enc === 'gzip') buf = gunzipSync(buf)
          else if (enc === 'deflate') buf = inflateSync(buf)
          else if (enc === 'br') buf = brotliDecompressSync(buf)
        } catch { /* serve raw bytes */ }
        resolve({ status, text: buf.toString('utf8'), headers: res.headers, url: u.toString(), ms: Date.now() - t0 })
      })
      res.on('error', reject)
    })
    r.on('timeout', () => r.destroy(Object.assign(new Error(`timeout after ${opts.timeoutMs ?? 15_000} ms`), { code: 'ETIMEDOUT' })))
    r.on('error', reject)
    if (opts.body) r.write(opts.body)
    r.end()
  })
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<{ data: T; status: number; ms: number }> {
  const res = await httpFetch(url, opts)
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, `HTTP ${res.status} from ${new URL(url).host}: ${res.text.slice(0, 200)}`)
  return { data: JSON.parse(res.text) as T, status: res.status, ms: res.ms }
}
