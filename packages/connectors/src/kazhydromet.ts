// Kazhydromet WIS2 node (OGC API – Features). Official SYNOP surface
// observations for station Aktau (WIGOS 0-398-0-38111). These are
// measurements, stored separately from any model forecast.
import { httpJson } from './http.ts'
import type { SourceConnector } from './types.ts'

const BASE = 'https://wis2box.kazhydromet.kz/oapi/collections'
export const AKTAU_STATION = { id: '0-398-0-38111', name: 'Aktau', lat: 43.604722, lon: 51.2275 }

type Feature = { properties: { name: string; value: number | null; units: string; description: string | null; reportId: string; reportTime: string; phenomenonTime: string } }

export type SynopReport = {
  report_id: string
  observed_at: string
  air_temperature_c: number | null
  dewpoint_c: number | null
  wind_speed_ms: number | null
  wind_direction_deg: number | null
  wind_gust_ms: number | null
  pressure_msl_hpa: number | null
  precipitation_mm: number | null
  present_weather: string | null
}

export function groupSynop(features: Feature[]): SynopReport[] {
  const by = new Map<string, SynopReport>()
  for (const f of features) {
    const p = f.properties
    const r = by.get(p.reportId) ?? {
      // reportTime is always an instant; phenomenonTime can be an interval ("start/end") for accumulations.
      report_id: p.reportId, observed_at: p.reportTime || p.phenomenonTime.split('/').pop()!, air_temperature_c: null, dewpoint_c: null, wind_speed_ms: null,
      wind_direction_deg: null, wind_gust_ms: null, pressure_msl_hpa: null, precipitation_mm: null, present_weather: null,
    }
    switch (p.name) {
      case 'air_temperature': r.air_temperature_c = p.units === 'K' && p.value != null ? p.value - 273.15 : p.value; break
      case 'dewpoint_temperature': r.dewpoint_c = p.units === 'K' && p.value != null ? p.value - 273.15 : p.value; break
      case 'wind_speed': r.wind_speed_ms = p.value; break
      case 'wind_direction': r.wind_direction_deg = p.value; break
      case 'maximum_wind_gust_speed': r.wind_gust_ms = p.value; break
      case 'pressure_reduced_to_mean_sea_level': r.pressure_msl_hpa = p.value; break
      case 'total_precipitation_or_total_water_equivalent': r.precipitation_mm = p.value; break
      case 'present_weather': r.present_weather = p.description; break
    }
    by.set(p.reportId, r)
  }
  return [...by.values()].filter((r) => !Number.isNaN(new Date(r.observed_at).getTime())).sort((a, b) => b.observed_at.localeCompare(a.observed_at))
}

export const kazhydrometWis2: SourceConnector = {
  slug: 'kazhydromet_wis2',
  job: 'observations',
  async fetch(ctx) {
    const since = new Date(ctx.now.getTime() - 30 * 3600_000).toISOString().slice(0, 19) + 'Z'
    const url = `${BASE}/urn:wmo:md:kz-kazhydromet:core.surface-based-observations.synop/items?f=json&limit=500` +
      `&wigos_station_identifier=${AKTAU_STATION.id}&datetime=${since}/..&sortby=-reportTime`
    const { data, status } = await httpJson<{ features: Feature[] }>(url, { timeoutMs: 25_000 })
    const reports = groupSynop(data.features)
    return {
      http_status: status,
      notes: `${reports.length} SYNOP reports for ${AKTAU_STATION.name}`,
      items: reports.map((r) => ({
        external_id: r.report_id,
        canonical_url: `${BASE}/urn:wmo:md:kz-kazhydromet:core.surface-based-observations.synop/items?reportId=${r.report_id}`,
        title: `SYNOP ${AKTAU_STATION.name} ${r.observed_at}`,
        raw_text: `Observed ${r.air_temperature_c ?? '—'}°C, wind ${r.wind_speed_ms ?? '—'} m/s from ${r.wind_direction_deg ?? '—'}°`,
        raw_json: { station: AKTAU_STATION, report: r },
        language: 'en',
        published_at: new Date(r.observed_at),
        extractable: false,
      })),
    }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'WMO WIS2 OGC API (official observations).' }
  },
}
