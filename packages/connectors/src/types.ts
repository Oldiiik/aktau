// Every source — official API, HTML page, model forecast, manual paste —
// implements the same contract. Connectors only fetch and describe raw data;
// storage, extraction and publishing happen downstream in @aktau/server.

export type RawSourceItem = {
  external_id?: string | null
  canonical_url?: string | null
  title?: string | null
  raw_text: string
  raw_html?: string | null
  raw_json?: unknown
  language?: string | null
  published_at?: Date | null
  source_updated_at?: Date | null
  reported_authority?: string | null
  /** Whether this item is text that should go through event extraction. */
  extractable: boolean
}

export type ConnectorContext = {
  now: Date
  /** Returns true if an item with this external id was already stored (skip re-fetching article bodies). */
  alreadyHave?: (externalId: string) => Promise<boolean>
  log?: (msg: string, extra?: Record<string, unknown>) => void
}

export type ConnectorResult = { items: RawSourceItem[]; http_status?: number; notes?: string }

export type ConnectorHealth = { ok: boolean; mode: 'automated' | 'manual' | 'disabled'; detail: string }

export interface SourceConnector {
  slug: string
  /** Which scheduled job runs it. */
  job: 'weather' | 'observations' | 'air-marine' | 'notices' | 'media' | 'places' | 'afisha'
  fetch(ctx: ConnectorContext): Promise<ConnectorResult>
  normalizeRaw?(input: unknown): RawSourceItem
  healthCheck(): Promise<ConnectorHealth>
}

export const AKTAU = { lat: 43.6532, lon: 51.1722, coastLat: 43.642, coastLon: 51.13 } as const
