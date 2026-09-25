import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSql, joinSession, sessionState } from '@aktau/server'
import { LiveAudience } from '@/components/live'
import { getInstallationId, getLang } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Live · Aktau' }

// /live/{code}: what a phone sees after scanning the session's QR code.
// No account and no GPS: opening this page joins the session's audience.
export default async function LivePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  if (!/^[a-z0-9]{4,12}$/i.test(code)) notFound()
  const [iid, lang] = await Promise.all([getInstallationId(), getLang()])
  const sql = getSql()
  if (iid) await joinSession(sql, code, iid, lang)
  const s = await sessionState(sql, code, iid)
  if (!s) notFound()
  return <LiveAudience initial={JSON.parse(JSON.stringify(s))} />
}
