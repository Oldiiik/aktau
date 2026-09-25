'use client'
// Admin console: source health, manual ingestion with structured preview,
// review queue (approve / edit / reject), lifecycle controls, demo mode, audit.
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ago } from '@aktau/i18n'
import { fmtDate, fmtTime, fromLocal, localParts } from '@aktau/normalization/time'
import { CATEGORIES, EVENT_STATUSES, type Extraction } from '@aktau/types'
import { ROLE_LABEL, signOut, useApp, useRealtime } from './app'
import { Badge, Button, Card, Divider, Icon, Logo } from './primitives'

async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers }, body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body, cache: 'no-store' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error?.message ?? `HTTP ${r.status}`)
  return d as T
}

const NAV = [['/admin', 'Overview'], ['/admin/ingest', 'Ingest'], ['/admin/review', 'Review queue'], ['/admin/events', 'Events'], ['/admin/users', 'Accounts'], ['/admin/audit', 'Audit log']] as const

export function AdminShell({ children, demo }: { children: ReactNode; demo: boolean }) {
  const path = usePathname()
  const { me, tx } = useApp()
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-5 px-6">
          <Link href="/admin" className="tap flex flex-none items-center gap-2.5">
            <Logo size={30} />
            <span className="flex flex-col leading-none">
              <span className="font-[family-name:var(--font-display)] text-[16px] font-semibold tracking-[-0.03em] text-text">Aktau</span>
              <span className="t-label mt-1 !text-[9px] text-beam">{tx({ en: 'Admin console', ru: 'Админ-панель', kk: 'Әкімші панелі' })}</span>
            </span>
          </Link>
          <nav className="no-scrollbar flex gap-1 overflow-x-auto">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className={`tap flex-none rounded-full px-3 py-1.5 t-sub font-semibold ${path === href ? 'bg-soft text-blue' : 'text-secondary hover:text-text'}`}>{label}</Link>
            ))}
          </nav>
          <div className="flex-1" />
          {demo ? <Badge tone="demo">DEMO_MODE</Badge> : null}
          <Link href="/copilot" className="tap hidden h-9 flex-none items-center gap-1.5 rounded-full bg-beam-soft px-3 text-[12px] font-bold text-beam md:inline-flex"><Icon name="radar" size={14} />109 Copilot</Link>
          <Link href="/" className="tap hidden h-9 flex-none items-center gap-1.5 rounded-full px-3 text-[12px] font-bold text-secondary hairline hover:text-text md:inline-flex">{tx({ en: 'Open app', ru: 'Приложение', kk: 'Қосымша' })} ↗</Link>
          {me ? (
            <div className="flex flex-none items-center gap-2">
              <span className="hidden flex-col items-end leading-tight lg:flex"><span className="t-meta font-bold text-text">{me.name ?? me.email}</span><span className="t-label !text-[9px] text-faint">{tx(ROLE_LABEL[me.role])}</span></span>
              <button type="button" onClick={() => void signOut()} className="tap grid size-9 place-items-center rounded-full text-secondary hairline hover:text-text" aria-label="Sign out"><Icon name="logout" size={16} /></button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto flex max-w-[1180px] flex-col gap-6 px-6 py-8">{children}</main>
    </div>
  )
}

// ── Accounts ────────────────────────────────────────────────────────────────
type AccountRow = { id: string; email: string; display_name: string | null; role: 'resident' | 'operator' | 'admin'; disabled: boolean; created_at: string; last_sign_in_at: string | null }

export function AccountsTable({ initial, meId }: { initial: AccountRow[]; meId: string }) {
  const { tx } = useApp()
  const [rows, setRows] = useState(initial)
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const patch = async (id: string, body: Partial<Pick<AccountRow, 'role' | 'disabled'>>) => {
    setErr(null)
    try {
      const { account } = await api<{ account: AccountRow }>(`/api/admin/users/${id}`, { method: 'PATCH', json: body })
      setRows((r) => r.map((x) => (x.id === id ? account : x)))
    } catch (e) { setErr((e as Error).message) }
  }
  const shown = rows.filter((r) => !q || `${r.email} ${r.display_name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const count = (role: AccountRow['role']) => rows.filter((r) => r.role === role && !r.disabled).length
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="t-title text-text">Accounts</h1>
          <p className="t-sub max-w-[62ch] text-secondary">Residents sign up themselves. Staff roles are granted here: <b className="text-text">operators</b> get 109 Copilot, <b className="text-text">admins</b> also get this console. Changing a role or disabling an account signs it out everywhere.</p>
        </div>
        <div className="flex gap-2">
          <Chip n={count('admin')} l="admins" tone="beam" /><Chip n={count('operator')} l="operators" tone="blue" /><Chip n={count('resident')} l="residents" />
        </div>
      </div>
      <Card className="gap-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or name" className="h-11 rounded-[14px] bg-bg px-4 t-body text-text outline-none hairline" />
        {err ? <p className="t-sub text-red">{err}</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left t-sub">
            <thead className="t-meta text-secondary"><tr><th className="py-2 pr-3">Account</th><th className="pr-3">Role</th><th className="pr-3">Last sign-in</th><th className="pr-3">Created</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`border-t border-border align-middle ${r.disabled ? 'opacity-50' : ''}`}>
                  <td className="py-3 pr-3">
                    <p className="t-row text-text">{r.display_name ?? r.email.split('@')[0]}{r.id === meId ? <span className="ml-2 t-meta text-faint">you</span> : null}</p>
                    <p className="t-meta text-secondary">{r.email}</p>
                  </td>
                  <td className="py-3 pr-3">
                    <select value={r.role} disabled={r.id === meId} onChange={(e) => void patch(r.id, { role: e.target.value as AccountRow['role'] })}
                      className={`h-9 rounded-[10px] px-2.5 text-[12.5px] font-bold outline-none hairline ${r.role === 'admin' ? 'bg-beam-soft text-beam' : r.role === 'operator' ? 'bg-soft text-blue' : 'bg-bg text-secondary'}`}>
                      {(['resident', 'operator', 'admin'] as const).map((x) => <option key={x} value={x}>{tx(ROLE_LABEL[x])}</option>)}
                    </select>
                  </td>
                  <td className="py-3 pr-3 text-secondary" suppressHydrationWarning>{r.last_sign_in_at ? ago('en', r.last_sign_in_at) : 'never'}</td>
                  <td className="py-3 pr-3 text-secondary">{fmtDate(new Date(r.created_at), 'en')}</td>
                  <td className="py-3 text-right">
                    {r.id === meId ? null : <Button full={false} size="sm" style={r.disabled ? 'secondary' : 'danger'} onClick={() => void patch(r.id, { disabled: !r.disabled })}>{r.disabled ? 'Enable' : 'Disable'}</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="t-meta text-faint">Create staff accounts from a terminal: <code className="t-mono">npm run account -- create name@example.com --role operator</code>, or ask them to sign up and promote them here.</p>
      </Card>
    </>
  )
}

function Chip({ n, l, tone }: { n: number; l: string; tone?: 'beam' | 'blue' }) {
  return <span className={`flex items-baseline gap-1.5 rounded-full px-3 py-1.5 ${tone === 'beam' ? 'bg-beam-soft text-beam' : tone === 'blue' ? 'bg-soft text-blue' : 'bg-surface text-secondary hairline'}`}><span className="t-num text-[16px] font-semibold">{n}</span><span className="t-meta font-bold">{l}</span></span>
}

// ── Overview ────────────────────────────────────────────────────────────────
type SourceHealth = { slug: string; name: string; organization: string | null; source_type: string; authority_level: number; adapter_type: string; state: string; mode: string; detail: string; last_successful_fetch_at: string | null; last_attempt_at: string | null; last_status: string | null; last_error: string | null; last_items: number | null; last_new: number | null; last_ms: number | null; runs_24h: number; failures_24h: number; items_total: number; notes: string | null }

const STATE_TONE: Record<string, 'resolved' | 'unknown' | 'active' | 'planned' | 'neutral'> = { healthy: 'resolved', manual: 'unknown', failing: 'active', stale: 'planned', pending: 'neutral', disabled: 'neutral' }

export function Overview({ initial, counts, demo }: { initial: SourceHealth[]; counts: { review: number; current: number; deliveries: number; items: number }; demo: boolean }) {
  const [sources, setSources] = useState(initial)
  const [running, setRunning] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const refresh = useCallback(async () => setSources((await api<{ sources: SourceHealth[] }>('/api/admin/health')).sources), [])
  useRealtime(() => void refresh(), ['sources', 'city_events'])
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Awaiting review" value={counts.review} href="/admin/review" />
        <Stat label="Current city events" value={counts.current} href="/admin/events" />
        <Stat label="Raw items preserved" value={counts.items} />
        <Stat label="Notifications delivered" value={counts.deliveries} />
      </div>
      <Card className="gap-4">
        <div className="flex items-center justify-between">
          <h2 className="t-section text-text">Source health</h2>
          <span className="t-meta text-secondary">Connectors run in isolation; one failure never blocks the rest.</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left t-sub">
            <thead className="t-meta text-secondary"><tr><th className="py-2 pr-3">Source</th><th className="pr-3">State</th><th className="pr-3">Authority</th><th className="pr-3">Last success</th><th className="pr-3">Last run</th><th className="pr-3">Items</th><th /></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.slug} className="border-t border-border align-top">
                  <td className="py-3 pr-3"><p className="t-row text-text">{s.name}</p><p className="t-meta text-secondary">{s.organization}</p></td>
                  <td className="py-3 pr-3"><Badge tone={STATE_TONE[s.state] ?? 'neutral'}>{s.state}</Badge><p className="mt-1 max-w-[260px] t-meta text-secondary">{s.state === 'failing' ? s.last_error : s.detail}</p></td>
                  <td className="py-3 pr-3 text-secondary">{s.source_type.toLowerCase()} · {s.authority_level}</td>
                  <td className="py-3 pr-3 text-secondary" suppressHydrationWarning>{s.last_successful_fetch_at ? ago('en', s.last_successful_fetch_at) : '-'}</td>
                  <td className="py-3 pr-3 text-secondary">{s.last_status ? `${s.last_status.toLowerCase()} · ${s.last_ms ?? '-'} ms` : '-'}<br />{s.runs_24h} runs / 24 h{s.failures_24h ? `, ${s.failures_24h} failed` : ''}</td>
                  <td className="py-3 pr-3 text-secondary">{s.last_items != null ? `${s.last_new ?? 0} new / ${s.last_items}` : '-'}<br />{s.items_total} stored</td>
                  <td className="py-3 text-right">{s.mode === 'automated' ? (
                    <Button full={false} style="secondary" className="!h-9 !px-3 !text-[13px]" disabled={running === s.slug} onClick={async () => {
                      setRunning(s.slug); setMsg(null)
                      try { const r = await api(`/api/admin/sources/${s.slug}/run`, { method: 'POST' }); setMsg(`${s.name}: ${r.status.toLowerCase()}${r.items != null ? ` · ${r.new}/${r.items} new` : ''}${r.error ? ` · ${r.error}` : ''}`) } finally { setRunning(null); void refresh() }
                    }}>{running === s.slug ? 'Running…' : 'Run now'}</Button>
                  ) : s.mode === 'manual' ? <Link href={`/admin/ingest?source=${s.slug}`} className="t-sub font-semibold text-blue">Paste notice</Link> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {msg ? <p className="t-sub text-text">{msg}</p> : null}
      </Card>
      {demo ? <DemoPanel /> : null}
    </>
  )
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = <Card padding={16} className="gap-1" as="div"><span className="text-[28px] font-bold leading-tight text-text">{value}</span><span className="t-meta text-secondary">{label}</span></Card>
  return href ? <Link href={href} className="tap">{body}</Link> : body
}

function DemoPanel() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const run = async (scenario: string) => {
    setBusy(true); setMsg(null)
    try { await api('/api/admin/demo', { method: 'POST', json: { scenario } }); router.push('/admin/review') } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Card tone="demo" className="gap-3">
      <h2 className="t-section text-text">Demo scenarios</h2>
      <p className="t-sub text-secondary">Injects an announcement through the real pipeline (raw item → extraction → review). Everything is stored with <code>is_demo = true</code> and labelled DEMO in every surface.</p>
      <div className="flex flex-wrap gap-2">
        <Button full={false} disabled={busy} onClick={() => run('aues_power')}>AUES: 14 mkr, houses 19–23, tomorrow 13:30–17:30</Button>
        <Button full={false} style="secondary" disabled={busy} onClick={() => run('water_no_eta')}>KZhSA: 7 mkr water, ETA unknown</Button>
        <Button full={false} style="secondary" disabled={busy} onClick={() => run('road')}>Akimat: road closure 27–16 mkr</Button>
        <Button full={false} style="quiet" disabled={busy} onClick={async () => { const r = await api('/api/admin/demo', { method: 'DELETE' }); setMsg(`Removed ${r.removed} demo events`); router.refresh() }}>Clear demo data</Button>
      </div>
      {msg ? <p className="t-sub text-text">{msg}</p> : null}
      <Divider />
      <h3 className="t-row text-text">Pilot simulation</h3>
      <p className="t-sub text-secondary">A generated week of 10 000 resident messages (Russian, Kazakh, English; app, phone, WhatsApp, Instagram, Komek 109; typos, repeats, spam) through the 109 engine on the real city map, checked against the week&apos;s known answer: duplicates grouped, the right residents told, dangers first, spam stopped. Runs in memory; the city&apos;s real incidents are not touched.</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/copilot/pilot" className="tap inline-flex h-[50px] items-center gap-2 rounded-[16px] bg-blue px-5 text-[15px] font-bold text-on-blue"><Icon name="radar" size={18} />Open the pilot simulation</Link>
      </div>
      <Divider />
      <h3 className="t-row text-text">Live demo session</h3>
      <p className="t-sub text-secondary">The audience scans a QR code (no sign-up, no GPS) and becomes the affected residents of one place. A problem reported into the session runs through the same incident pipeline: confirmations, 109 Copilot, the team&apos;s deadline, completion and the residents&apos; verification.</p>
      <div className="flex flex-wrap gap-2">
        <Button full={false} style="secondary" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null)
          try {
            const r = await api<{ code: string }>('/api/ops/live', { method: 'POST', json: { title: 'Smart City Aktau Hackathon', venue: 'Mangystau Hub' } })
            window.open(`/live/${r.code}/present`, '_blank')
            setMsg(`Session created: /live/${r.code}`)
          } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
        }}>Create live session · Mangystau Hub</Button>
        <Link href="/copilot" className="tap inline-flex h-[50px] items-center rounded-[16px] px-5 text-[15px] font-bold text-blue hairline">Sessions in 109 Copilot →</Link>
      </div>
    </Card>
  )
}

// ── Ingest ──────────────────────────────────────────────────────────────────
type Candidate = {
  id: string; status: string; segment_index: number; segment_text: string; extracted: Extraction; extractor: string; parser_version: string; confidence: number
  validation_errors: Array<{ field: string; code: string; message: string }>; warnings: Array<{ field: string; code: string; message: string }>
  duplicate_of_event_id: string | null; duplicate_score: number | null; duplicate_title: string | null; duplicate_status: string | null; created_event_id: string | null
  source_item_id: string; item_title: string | null; canonical_url: string | null; published_at: string | null; fetched_at: string; raw_text: string; reported_authority: string | null; is_demo: boolean
  source_slug: string; source_name: string; source_type: string; authority_level: number; reviewed_by: string | null; review_note: string | null; created_at: string
}

export function IngestForm({ sources, initialSource, demo }: { sources: Array<{ slug: string; name: string; source_type: string }>; initialSource?: string; demo?: boolean }) {
  const [source, setSource] = useState(initialSource ?? 'aues')
  const [isDemo, setIsDemo] = useState(false)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [published, setPublished] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ source_item_id: string; duplicate: boolean; candidates: Candidate[] } | null>(null)
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Card className="gap-4 self-start">
        <h2 className="t-section text-text">Paste an announcement</h2>
        <p className="t-sub text-secondary">For sources that cannot be safely automated (utility pages, akimat, 109, messengers). The original text is preserved verbatim.</p>
        <Field label="Source">
          <select value={source} onChange={(e) => setSource(e.target.value)} className="h-11 rounded-[12px] bg-bg px-3 t-body text-text">
            {sources.map((s) => <option key={s.slug} value={s.slug}>{s.name} · {s.source_type.toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="URL (optional)"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className="h-11 rounded-[12px] bg-bg px-3 t-body text-text outline-none" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Headline (optional)"><input value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 rounded-[12px] bg-bg px-3 t-body text-text outline-none" /></Field>
          <Field label="Published (Aktau time)"><input type="datetime-local" value={published} onChange={(e) => setPublished(e.target.value)} className="h-11 rounded-[12px] bg-bg px-3 t-body text-text outline-none" /></Field>
        </div>
        <Field label="Announcement text">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder="17 сентября с 13:30 до 17:30 в связи с плановыми работами будет отключена электроэнергия в 14 микрорайоне, дома 19, 20, 21, 22, 23."
            className="rounded-[12px] bg-bg p-3 t-body text-text outline-none" />
        </Field>
        {demo ? <label className="flex items-center gap-2 t-sub text-text"><input type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} /> Demo item (kept separate from real city data, labelled DEMO)</label> : null}
        {err ? <p className="t-sub text-red">{err}</p> : null}
        <Button disabled={busy || text.trim().length < 10} onClick={async () => {
          setBusy(true); setErr(null); setResult(null)
          try {
            let published_at: string | undefined
            if (published) { const [d, t] = published.split('T'); const [y, m, dd] = d!.split('-').map(Number); const [hh, mm] = t!.split(':').map(Number); published_at = fromLocal(y!, m!, dd!, hh!, mm!).toISOString() }
            setResult(await api('/api/admin/ingest', { method: 'POST', json: { source_slug: source, url: url || undefined, title: title || undefined, text, published_at, is_demo: isDemo } }))
          } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
        }}>{busy ? 'Extracting…' : 'Extract event'}</Button>
      </Card>
      <div className="flex flex-col gap-4">
        {!result ? <Card tone="soft" className="gap-2"><p className="t-row text-text">Structured preview appears here</p><p className="t-sub text-secondary">Deterministic parsing runs first (dates, times, microdistricts, house numbers, service, organisation). An LLM is only consulted for ambiguous structure, and every value it returns must appear in the source text.</p></Card> : null}
        {result ? <p className="t-sub text-secondary">Raw item <code>{result.source_item_id.slice(0, 8)}</code>{result.duplicate ? ' — identical text was already ingested; showing its candidates' : ' preserved'} · {result.candidates.length} notice{result.candidates.length === 1 ? '' : 's'} found</p> : null}
        {result?.candidates.map((c) => <CandidateCard key={c.id} c={c} />)}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="t-meta font-semibold text-secondary">{label}</span>{children}</label>
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const p = localParts(new Date(iso))
  const z = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`
}
function fromLocalInput(v: string): string | null {
  if (!v) return null
  const [d, t] = v.split('T')
  const [y, m, dd] = d!.split('-').map(Number)
  const [hh, mm] = (t ?? '00:00').split(':').map(Number)
  return fromLocal(y!, m!, dd!, hh!, mm!).toISOString()
}

export function CandidateCard({ c, onDone }: { c: Candidate; onDone?: () => void }) {
  const [e, setE] = useState<Extraction>(c.extracted)
  const [status, setStatus] = useState(c.status)
  const [eventId, setEventId] = useState(c.created_event_id)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [mode, setMode] = useState<'auto' | 'new'>('auto')
  const open = status === 'REVIEW_REQUIRED'
  const set = <K extends keyof Extraction>(k: K, v: Extraction[K]) => setE({ ...e, [k]: v })
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null)
    try {
      const r = await api(`/api/admin/candidates/${c.id}`, { method: 'POST', json: body })
      setStatus(body.action === 'reject' ? 'REJECTED' : r.action === 'merged' ? 'MERGED' : 'APPROVED')
      setEventId(r.event_id ?? null)
      onDone?.()
    } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <Card className="gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={open ? 'planned' : status === 'REJECTED' ? 'neutral' : 'resolved'}>{status.replace('_', ' ').toLowerCase()}</Badge>
        <Badge tone="official">{c.source_name}{c.reported_authority ? ` → ${c.reported_authority}` : ''}</Badge>
        <Badge tone="unknown">{c.extractor} · {Math.round(c.confidence * 100)}%</Badge>
        {c.is_demo ? <Badge tone="demo">DEMO</Badge> : null}
        <span className="t-meta text-secondary" suppressHydrationWarning>{ago('en', c.created_at)}</span>
      </div>
      <blockquote className="rounded-[12px] bg-bg p-3 t-sub text-text">“{c.segment_text}”</blockquote>
      {c.validation_errors.length || c.warnings.length ? (
        <ul className="flex flex-col gap-1">
          {c.validation_errors.map((w, i) => <li key={`e${i}`} className="t-meta text-red">✕ {w.field}: {w.message}</li>)}
          {c.warnings.map((w, i) => <li key={`w${i}`} className="t-meta text-amber">! {w.field}: {w.message}</li>)}
        </ul>
      ) : <p className="t-meta text-green">✓ All fields grounded in the source text</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Service">
          <select disabled={!open} value={e.category} onChange={(x) => set('category', x.target.value as Extraction['category'])} className="h-10 rounded-[10px] bg-bg px-2 t-sub text-text">{CATEGORIES.map((k) => <option key={k}>{k}</option>)}</select>
        </Field>
        <Field label="Type">
          <select disabled={!open} value={e.event_type} onChange={(x) => set('event_type', x.target.value as Extraction['event_type'])} className="h-10 rounded-[10px] bg-bg px-2 t-sub text-text">
            {['planned_outage', 'emergency_outage', 'restoration', 'road_closure', 'road_works', 'transport_change', 'weather_warning', 'public_event', 'other'].map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Start (Aktau time)"><input disabled={!open} type="datetime-local" value={toLocalInput(e.starts_at)} onChange={(x) => set('starts_at', fromLocalInput(x.target.value))} className="h-10 rounded-[10px] bg-bg px-2 t-sub text-text" /></Field>
        <Field label="Expected end — empty = not announced"><input disabled={!open} type="datetime-local" value={toLocalInput(e.expected_ends_at)} onChange={(x) => set('expected_ends_at', fromLocalInput(x.target.value))} className="h-10 rounded-[10px] bg-bg px-2 t-sub text-text" /></Field>
        <Field label="Microdistricts"><input disabled={!open} value={e.areas.join(', ')} onChange={(x) => set('areas', x.target.value.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))} className="h-10 rounded-[10px] bg-bg px-2 t-sub text-text" /></Field>
        <Field label="Houses — empty = whole area"><input disabled={!open} value={e.buildings.join(', ')} onChange={(x) => set('buildings', x.target.value.split(/[,;]+/).map((s) => s.trim()).filter(Boolean))} className="h-10 rounded-[10px] bg-bg px-2 t-sub text-text" /></Field>
        <Field label="Status">
          <select disabled={!open} value={e.status} onChange={(x) => set('status', x.target.value as Extraction['status'])} className="h-10 rounded-[10px] bg-bg px-2 t-sub text-text">{EVENT_STATUSES.map((k) => <option key={k}>{k}</option>)}</select>
        </Field>
        <Field label="Authority"><input disabled={!open} value={e.authority ?? ''} onChange={(x) => set('authority', x.target.value.trim().toUpperCase() || null)} className="h-10 rounded-[10px] bg-bg px-2 t-sub text-text" /></Field>
      </div>
      <label className="flex items-center gap-2 t-sub text-text"><input disabled={!open} type="checkbox" checked={e.partial_area} onChange={(x) => set('partial_area', x.target.checked)} /> Only part of the listed area is affected</label>
      {e.reason ? <p className="t-meta text-secondary">Reason (from text): {e.reason}</p> : null}
      {c.duplicate_of_event_id ? (
        <div className="flex flex-col gap-2 rounded-[12px] bg-amber-soft p-3">
          <p className="t-sub text-text">Possible duplicate of <Link className="font-semibold text-blue" href={`/event/${c.duplicate_of_event_id}`} target="_blank">{c.duplicate_title}</Link> ({c.duplicate_status?.toLowerCase()}) · score {c.duplicate_score}</p>
          {open ? (
            <div className="flex gap-3 t-sub">
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'auto'} onChange={() => setMode('auto')} /> Attach as evidence / update</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Create a separate event</label>
            </div>
          ) : null}
        </div>
      ) : null}
      {err ? <p className="t-sub text-red">{err}</p> : null}
      <Divider />
      {open ? (
        <div className="flex flex-wrap gap-2">
          <Button full={false} disabled={busy} onClick={() => act({ action: 'approve', edits: e, merge_into: mode === 'auto' && c.duplicate_of_event_id ? c.duplicate_of_event_id : undefined, force_new: mode === 'new' })}>Approve &amp; publish</Button>
          <Button full={false} style="quiet" disabled={busy} onClick={() => act({ action: 'reject', note: 'Not a service notice' })}>Reject</Button>
        </div>
      ) : eventId ? <Link href={`/event/${eventId}`} target="_blank" className="t-sub font-semibold text-blue">Open public event ↗</Link> : null}
    </Card>
  )
}

export function ReviewQueue({ initial }: { initial: Candidate[] }) {
  const [items, setItems] = useState(initial)
  const [status, setStatus] = useState('REVIEW_REQUIRED')
  const load = useCallback(async (s = status) => setItems((await api<{ candidates: Candidate[] }>(`/api/admin/candidates?status=${s}`)).candidates), [status])
  useEffect(() => { void load(status) }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="flex items-center gap-2">
        {['REVIEW_REQUIRED', 'APPROVED', 'MERGED', 'REJECTED', 'ALL'].map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={`tap rounded-full px-3 py-1.5 t-sub font-semibold ${status === s ? 'bg-blue text-white' : 'bg-surface text-text'}`}>{s.replace('_', ' ').toLowerCase()}</button>
        ))}
      </div>
      {items.length === 0 ? <Card tone="soft"><p className="t-body text-secondary">Nothing here.</p></Card> : null}
      <div className="grid gap-4 lg:grid-cols-2">{items.map((c) => <CandidateCard key={c.id} c={c} />)}</div>
    </>
  )
}

// ── Events (lifecycle) ─────────────────────────────────────────────────────
type AdminEvent = { id: string; title: string; category: string; status: string; display_status: string; starts_at: string | null; expected_ends_at: string | null; is_demo: boolean; reported_authority: string | null; primary_source: { name: string }; areas: Array<{ designator: string | null; name: string }>; building_count: number; last_confirmed_at: string }

export function EventsAdmin({ initial }: { initial: AdminEvent[] }) {
  const [events, setEvents] = useState(initial)
  const reload = useCallback(async () => setEvents((await api<{ events: AdminEvent[] }>('/api/events?status=all')).events.reverse()), [])
  useRealtime(() => void reload())
  const patch = async (id: string, body: Record<string, unknown>) => { await api(`/api/admin/events/${id}`, { method: 'PATCH', json: body }); await reload() }
  return (
    <Card className="gap-3">
      <h2 className="t-section text-text">City events</h2>
      <p className="t-sub text-secondary">Manual changes are recorded as event updates and in the audit log — including who made them.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left t-sub">
          <thead className="t-meta text-secondary"><tr><th className="py-2 pr-3">Event</th><th className="pr-3">Status</th><th className="pr-3">Window</th><th className="pr-3">Source</th><th>Lifecycle</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-border align-top">
                <td className="py-3 pr-3"><Link href={`/event/${e.id}`} target="_blank" className="t-row text-text hover:text-blue">{e.title}</Link>{e.is_demo ? <Badge tone="demo" className="ml-2">DEMO</Badge> : null}<p className="t-meta text-secondary">{e.areas.map((a) => a.designator ?? a.name).join(', ')}{e.building_count ? ` · ${e.building_count} houses` : ''}</p></td>
                <td className="py-3 pr-3"><Badge tone={e.status === 'RESOLVED' ? 'resolved' : ['ACTIVE', 'DELAYED'].includes(e.status) ? 'active' : e.status === 'CANCELLED' ? 'neutral' : 'planned'}>{e.status.toLowerCase()}</Badge>{e.display_status !== e.status ? <p className="t-meta text-secondary">shown as {e.display_status.toLowerCase()}</p> : null}</td>
                <td className="py-3 pr-3 text-secondary" suppressHydrationWarning>{e.starts_at ? `${fmtDate(new Date(e.starts_at), 'en')} ${fmtTime(new Date(e.starts_at))}` : '-'} → {e.expected_ends_at ? fmtTime(new Date(e.expected_ends_at)) : 'not announced'}</td>
                <td className="py-3 pr-3 text-secondary">{e.reported_authority ?? e.primary_source.name}</td>
                <td className="py-3">
                  {!['RESOLVED', 'CANCELLED'].includes(e.status) ? (
                    <div className="flex flex-wrap gap-1.5">
                      {e.status === 'SCHEDULED' ? <SmallBtn onClick={() => patch(e.id, { status: 'ACTIVE', message: 'Interruption started (editor).' })}>Started</SmallBtn> : null}
                      <SmallBtn onClick={() => { const v = prompt('New expected end (HH:MM, Aktau time) — empty clears the ETA'); if (v === null) return; const base = new Date(e.starts_at ?? Date.now()); const p = localParts(base); const [hh, mm] = v.split(':').map(Number); return patch(e.id, { expected_ends_at: v ? fromLocal(p.year, p.month, p.day, hh!, mm ?? 0).toISOString() : null, message: 'Estimate updated by editor.' }) }}>Change ETA</SmallBtn>
                      <SmallBtn onClick={() => patch(e.id, { status: 'RESOLVED', message: 'Restoration confirmed (editor).' })}>Resolve</SmallBtn>
                      <SmallBtn onClick={() => patch(e.id, { status: 'CANCELLED', message: 'Cancelled (editor).' })}>Cancel</SmallBtn>
                    </div>
                  ) : <span className="t-meta text-secondary">closed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function SmallBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="tap rounded-full bg-soft px-3 py-1 t-meta font-semibold text-blue">{children}</button>
}

export function AuditTable({ rows }: { rows: Array<{ id: number; actor: string; action: string; entity_type: string; entity_id: string | null; after: unknown; created_at: string }> }) {
  return (
    <Card className="gap-3">
      <h2 className="t-section text-text">Audit log</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left t-sub">
          <thead className="t-meta text-secondary"><tr><th className="py-2 pr-3">When</th><th className="pr-3">Actor</th><th className="pr-3">Action</th><th className="pr-3">Entity</th><th>Change</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="py-2 pr-3 text-secondary" suppressHydrationWarning>{ago('en', r.created_at)}</td>
                <td className="py-2 pr-3 text-text">{r.actor}</td>
                <td className="py-2 pr-3 text-text">{r.action}</td>
                <td className="py-2 pr-3 text-secondary">{r.entity_type}{r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ''}</td>
                <td className="py-2 font-mono text-[11px] text-secondary"><div className="max-h-16 max-w-[420px] overflow-hidden">{JSON.stringify(r.after)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
