import { getSql, loadEvents } from '@aktau/server'
import { EventsAdmin } from '@/components/admin'

export const dynamic = 'force-dynamic'

export default async function EventsPage() {
  const events = (await loadEvents(getSql(), { limit: 200 }, null)).reverse()
  return <EventsAdmin initial={JSON.parse(JSON.stringify(events))} />
}
