import { getSql, inbox, myIncidentMessages } from '@aktau/server'
import { Screen } from '@/components/app'
import { InboxView } from '@/components/you'
import { getInstallationId } from '@/lib/session'

export const dynamic = 'force-dynamic'

// One stream: official notices that affect my places + every update on the
// 109 incidents I reported or confirmed (assigned, deadline, work started,
// "is it fixed?", reopened …).
export default async function InboxPage() {
  const iid = await getInstallationId()
  const sql = getSql()
  const [official, incidents] = iid ? await Promise.all([inbox(sql, iid, 50), myIncidentMessages(sql, iid, 50)]) : [[], []]
  const items = [
    ...official.map((n) => ({ id: n.id, kind: 'event' as const, event_id: n.event_id, title: n.title, body: n.body, created_at: new Date(n.created_at).toISOString() })),
    ...incidents.map((m) => ({ id: m.id, kind: 'incident' as const, incident_id: m.incident_id, code: m.code, msg_kind: m.kind, title: m.title, body: m.body, created_at: new Date(m.created_at).toISOString() })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 80)
  return <Screen><InboxView items={items} /></Screen>
}
