import { getSql } from '@aktau/server'
import { IngestForm } from '@/components/admin'

export const dynamic = 'force-dynamic'

export default async function IngestPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source } = await searchParams
  const sources = await getSql()<{ slug: string; name: string; source_type: string }[]>`
    select slug, name, source_type from sources where adapter_type not in ('open_meteo_forecast', 'open_meteo_marine', 'open_meteo_air', 'kazhydromet_wis2', 'osm_overpass', 'nominatim', 'dgis_places', 'egov_open_data')
    order by authority_level desc, name`
  return (
    <>
      <div className="flex flex-col gap-1"><h1 className="t-title text-text">Ingest</h1><p className="t-body text-secondary">Source → raw record → extracted structure → your review → city event.</p></div>
      <IngestForm sources={sources} initialSource={source} demo={process.env.DEMO_MODE === 'true'} />
    </>
  )
}
