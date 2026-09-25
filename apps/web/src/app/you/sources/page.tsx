import { getSql } from '@aktau/server'
import { Screen } from '@/components/app'
import { SourcesView } from '@/components/you'

export const dynamic = 'force-dynamic'

export default async function SourcesPage() {
  const rows = await getSql()`select slug, name, organization, source_type, authority_level, adapter_type, enabled, last_successful_fetch_at, last_run_status
    from public_source_status where adapter_type not in ('nominatim') order by authority_level desc, name`
  return <Screen><SourcesView sources={JSON.parse(JSON.stringify(rows))} /></Screen>
}
