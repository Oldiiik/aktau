import { getSql, sourceHealth } from '@aktau/server'
import { Overview } from '@/components/admin'

export const dynamic = 'force-dynamic'

export default async function AdminHome() {
  const sql = getSql()
  const [sources, [counts]] = await Promise.all([
    sourceHealth(sql),
    sql<{ review: number; current: number; deliveries: number; items: number }[]>`select
      (select count(*)::int from event_candidates where status = 'REVIEW_REQUIRED') review,
      (select count(*)::int from city_events where status not in ('RESOLVED', 'CANCELLED')) current,
      (select count(*)::int from notification_deliveries) deliveries,
      (select count(*)::int from source_items) items`,
  ])
  return <Overview initial={JSON.parse(JSON.stringify(sources))} counts={counts!} demo={process.env.DEMO_MODE === 'true'} />
}
