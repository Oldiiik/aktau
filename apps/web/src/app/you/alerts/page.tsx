import { DEFAULT_PREFS, getPreferences, getSql } from '@aktau/server'
import { Screen } from '@/components/app'
import { AlertsView } from '@/components/you'
import { getInstallationId } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function AlertsPage() {
  const iid = await getInstallationId()
  const prefs = iid ? await getPreferences(getSql(), iid) : DEFAULT_PREFS
  return <Screen><AlertsView initial={prefs} /></Screen>
}
