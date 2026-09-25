// Connector registry + the small remaining adapters (manual sources,
// Nominatim geocoder, data.egov.kz). One broken connector never breaks the
// others: the server runs each in isolation and records a fetch run.
import { inaktau, kinoafisha, sxodim, topbilet } from './afisha.ts'
import { httpJson } from './http.ts'
import { kazhydrometWis2 } from './kazhydromet.ts'
import { lada, ladaNews } from './lada.ts'
import { openMeteoAir, openMeteoForecast, openMeteoMarine } from './open-meteo.ts'
import { dgisPlaces, osmOverpass } from './places.ts'
import type { RawSourceItem, SourceConnector } from './types.ts'

/** Sources with no safe automated feed (akimat, 109, MAEK, KZhSA, AUES, residents). */
export function manualConnector(slug: string, reason: string): SourceConnector {
  return {
    slug,
    job: 'notices',
    async fetch() {
      return { items: [], notes: `manual: ${reason}` }
    },
    normalizeRaw(input): RawSourceItem {
      const i = input as { text: string; title?: string; url?: string; published_at?: string; reported_authority?: string }
      return {
        external_id: null,
        canonical_url: i.url ?? null,
        title: i.title ?? null,
        raw_text: i.text,
        language: /[әғқңөұүһі]/i.test(i.text) ? 'kk' : 'ru',
        published_at: i.published_at ? new Date(i.published_at) : null,
        reported_authority: i.reported_authority ?? null,
        extractable: true,
      }
    },
    async healthCheck() {
      return { ok: true, mode: 'manual', detail: reason }
    },
  }
}

// ── data.egov.kz (optional) ─────────────────────────────────────────────────
// Only datasets that answer a product question. Each entry states the question.
export const EGOV_DATASETS = [
  { id: 'mangistau_obl_social_objects', question: 'Where are public facilities (schools, clinics) in Aktau?', version: 'v1' },
] as const

export const egovOpenData: SourceConnector = {
  slug: 'egov_open_data',
  job: 'places',
  async fetch() {
    const key = process.env.EGOV_API_KEY
    if (!key) return { items: [], notes: 'EGOV_API_KEY not set — connector idle' }
    const items: RawSourceItem[] = []
    for (const ds of EGOV_DATASETS) {
      const url = `https://data.egov.kz/api/v4/${ds.id}/${ds.version}?apiKey=${key}&source=${encodeURIComponent(JSON.stringify({ size: 500 }))}`
      const { data } = await httpJson<unknown[]>(url, { timeoutMs: 30_000 })
      items.push({ external_id: `${ds.id}:${ds.version}`, canonical_url: `https://data.egov.kz/datasets/view?index=${ds.id}`, title: ds.question, raw_text: `${Array.isArray(data) ? data.length : 0} records`, raw_json: { dataset: ds, data }, extractable: false })
    }
    return { items }
  },
  async healthCheck() {
    return process.env.EGOV_API_KEY ? { ok: true, mode: 'automated', detail: 'API key configured.' } : { ok: true, mode: 'disabled', detail: 'No EGOV_API_KEY.' }
  },
}

// ── Nominatim (last-resort geocoder) ────────────────────────────────────────
// Policy: ≤ 1 req/s, cached server-side by the caller, unique UA, attribution,
// never used for autocomplete (local area/building index handles typing).
export async function nominatimSearch(q: string): Promise<Array<{ display_name: string; lat: number; lon: number; osm: string }>> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=kz&viewbox=51.05,43.75,51.35,43.55&bounded=1&q=${encodeURIComponent(q)}`
  const { data } = await httpJson<Array<{ display_name: string; lat: string; lon: string; osm_type: string; osm_id: number }>>(url, { timeoutMs: 8000, minIntervalMs: 1100 })
  return data.map((d) => ({ display_name: d.display_name, lat: Number(d.lat), lon: Number(d.lon), osm: `${d.osm_type}/${d.osm_id}` }))
}

export const CONNECTORS: Record<string, SourceConnector> = {
  open_meteo: openMeteoForecast,
  open_meteo_marine: openMeteoMarine,
  open_meteo_air: openMeteoAir,
  kazhydromet_wis2: kazhydrometWis2,
  lada,
  lada_news: ladaNews,
  osm_overpass: osmOverpass,
  dgis: dgisPlaces,
  egov_open_data: egovOpenData,
  kinoafisha,
  sxodim,
  inaktau,
  topbilet,
  aktau_akimat: manualConnector('aktau_akimat', 'gov.kz content API refuses automated clients; notices are pasted in /admin/ingest.'),
  mangystau_109: manualConnector('mangystau_109', 'No public feed.'),
  maek: manualConnector('maek', 'No public feed.'),
  kzhsa: manualConnector('kzhsa', 'No public feed.'),
  aues: manualConnector('aues', 'Announcements reach the public via media; ingested from Lada or pasted.'),
  community_reports: manualConnector('community_reports', 'Resident reports are entered by moderators.'),
}

export function connectorFor(slug: string): SourceConnector | null {
  return CONNECTORS[slug] ?? null
}
