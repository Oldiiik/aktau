import { getSql, listLocations, myIncidents } from '@aktau/server'
import { Screen } from '@/components/app'
import { YouView } from '@/components/you'
import { getInstallationId } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function YouPage() {
  const iid = await getInstallationId()
  const sql = getSql()
  const [locations, mine] = iid ? await Promise.all([listLocations(sql, iid), myIncidents(sql, iid)]) : [[], []]
  return <Screen><YouView locations={JSON.parse(JSON.stringify(locations))} reports={mine.length} /></Screen>
}
