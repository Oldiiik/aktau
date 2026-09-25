import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { networkInterfaces } from 'node:os'
import { renderSVG } from 'uqr'
import { getSql, sessionState } from '@aktau/server'
import { LivePresenter } from '@/components/live'
import { canUseCopilot } from '@/lib/auth'
import { currentAccount } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Presenter · Aktau live' }

/** On a laptop served as localhost, phones need its address on the venue network. */
function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address
    }
  }
  return null
}

// The presenter's screen (staff only): QR code, live counts, operator steps, the result.
export default async function PresentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const me = await currentAccount()
  if (!canUseCopilot(me?.role)) redirect(`/signin?next=/live/${code}/present${me ? '&need=operator' : ''}`)
  const s = await sessionState(getSql(), code, null)
  if (!s) notFound()
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  let base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? `${proto}://${host}`
  if (!process.env.PUBLIC_BASE_URL && /^(localhost|127\.0\.0\.1)(:|$)/.test(host)) {
    const ip = lanAddress()
    if (ip) base = `${proto}://${ip}${host.includes(':') ? `:${host.split(':')[1]}` : ''}`
  }
  const joinUrl = `${base}/live/${s.session.code}`
  const qr = renderSVG(joinUrl, { border: 1, whiteColor: '#ffffff', blackColor: '#0b1320' })
  return <LivePresenter initial={JSON.parse(JSON.stringify(s))} joinUrl={joinUrl} qr={qr} />
}
