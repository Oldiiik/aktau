import { notFound } from 'next/navigation'
import { getSql, incidentDetail } from '@aktau/server'
import { Screen } from '@/components/app'
import { IncidentView } from '@/components/incident'
import { getInstallationId } from '@/lib/session'

export const dynamic = 'force-dynamic'

// /incident/INC-1040 (or the uuid). Public: never includes residents' raw text.
export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^([0-9a-f-]{36}|INC-\d+)$/i.test(id)) notFound()
  const d = await incidentDetail(getSql(), id, { installation_id: await getInstallationId() })
  if (!d) notFound()
  return <Screen><IncidentView initial={JSON.parse(JSON.stringify(d))} /></Screen>
}
