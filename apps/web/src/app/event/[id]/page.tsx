import { notFound } from 'next/navigation'
import { getSql, loadEventDetail, resolveLocation } from '@aktau/server'
import { Screen } from '@/components/app'
import { EventDetailView } from '@/components/event'
import { getInstallationId, getLang } from '@/lib/session'

export const dynamic = 'force-dynamic'

// Canonical deep link target: aktau://event/{id} ↔ /event/{id}
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const [lang, iid] = await Promise.all([getLang(), getInstallationId()])
  const sql = getSql()
  const loc = await resolveLocation(sql, { installation_id: iid }, lang)
  const detail = await loadEventDetail(sql, id, loc)
  if (!detail) notFound()
  return <Screen><EventDetailView initial={detail} /></Screen>
}
