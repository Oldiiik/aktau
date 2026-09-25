import { getSql } from '@aktau/server'
import { AuditTable } from '@/components/admin'

export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  const rows = await getSql()`select id, actor, action, entity_type, entity_id, after, created_at from audit_log order by id desc limit 200`
  return <AuditTable rows={JSON.parse(JSON.stringify(rows))} />
}
