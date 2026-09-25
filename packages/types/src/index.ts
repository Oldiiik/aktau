// Shared contracts between the database, the API and every client
// (web, mobile, iOS widget). Zod schemas double as runtime validators.
import { z } from 'zod'

// ── Enums (mirror supabase/migrations) ───────────────────────────────────────
export const SOURCE_TYPES = ['OFFICIAL', 'GOVERNMENT', 'PROVIDER', 'MEDIA', 'COMMUNITY', 'API', 'MANUAL'] as const
export const CATEGORIES = [
  'WATER', 'HOT_WATER', 'ELECTRICITY', 'HEATING', 'GAS', 'ROAD', 'TRANSPORT',
  'WEATHER', 'AIR_QUALITY', 'CASPIAN', 'EMERGENCY', 'EVENT', 'OTHER',
] as const
export const EVENT_STATUSES = ['SCHEDULED', 'ACTIVE', 'DEGRADED', 'DELAYED', 'RESOLVED', 'CANCELLED', 'UNCONFIRMED'] as const
export const SEVERITIES = ['INFO', 'MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'] as const
export const VERIFICATION = ['OFFICIAL', 'VERIFIED', 'CORROBORATED', 'COMMUNITY', 'UNCONFIRMED'] as const
export const COVERAGE = ['FULL', 'PARTIAL', 'BUILDINGS_ONLY'] as const
export const LANGUAGES = ['kk', 'ru', 'en'] as const

export type SourceType = (typeof SOURCE_TYPES)[number]
export type Category = (typeof CATEGORIES)[number]
export type EventStatus = (typeof EVENT_STATUSES)[number]
export type Severity = (typeof SEVERITIES)[number]
export type Verification = (typeof VERIFICATION)[number]
export type Coverage = (typeof COVERAGE)[number]
export type Lang = (typeof LANGUAGES)[number]
export type Relevance = 'DIRECT' | 'AREA' | 'NEARBY' | 'NO'
export type Freshness = 'fresh' | 'aging' | 'stale'
export type ServiceState = 'NORMAL' | 'PLANNED_ISSUE' | 'DEGRADED' | 'DISRUPTED' | 'UNKNOWN'
export type ServiceKey = 'water' | 'electricity' | 'heating' | 'roads' | 'transport'
export type NotificationType = 'PLANNED' | 'STARTED' | 'UPDATED' | 'RESOLVED' | 'CANCELLED'

export const isoDateTime = z.string().datetime({ offset: true })

// ── Extraction: the ONLY shape an extractor (rules or LLM) may produce ──────
// Unknown values must be null. `.strict()` rejects any invented extra keys.
export const ExtractionSchema = z
  .object({
    category: z.enum(CATEGORIES),
    event_type: z.enum([
      'planned_outage', 'emergency_outage', 'restoration', 'road_closure', 'road_works',
      'transport_change', 'weather_warning', 'public_event', 'other',
    ]),
    status: z.enum(EVENT_STATUSES),
    title: z.string().min(3).max(200),
    summary: z.string().max(600).nullable(),
    starts_at: isoDateTime.nullable(),
    expected_ends_at: isoDateTime.nullable(),
    /** Microdistrict designators exactly as canonicalised: '14', '3А', 'ШЫГЫС-2'. */
    areas: z.array(z.string().min(1).max(12)).max(40),
    /** Explicit house numbers. Empty = the source did not limit to buildings. */
    buildings: z.array(z.string().min(1).max(12)).max(200),
    /** True when the text says only part of the listed area is affected. */
    partial_area: z.boolean(),
    reason: z.string().max(300).nullable(),
    authority: z.string().max(80).nullable(),
    time_text: z.string().max(200).nullable(),
    location_text: z.string().max(400).nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict()
export type Extraction = z.infer<typeof ExtractionSchema>

export type ExtractionWarning = { field: string; code: string; message: string }

export type ExtractedCandidate = {
  segment_index: number
  segment_text: string
  extraction: Extraction
  extractor: 'rules' | 'rules+llm'
  parser_version: string
  warnings: ExtractionWarning[]
  /** Hard problems: schema failure, ungrounded LLM values. → REVIEW_REQUIRED. */
  errors: ExtractionWarning[]
  review_required: boolean
}

// ── Public event DTO ────────────────────────────────────────────────────────
export type AreaRef = { id: string; slug: string; name: string; name_ru: string | null; name_kk: string | null; designator: string | null; coverage: Coverage }
export type BuildingRef = { id: string; area_id: string; house_number: string; display_address: string }
export type SourceRef = {
  source_item_id: string
  relationship: 'PRIMARY' | 'CONFIRMING' | 'UPDATE' | 'CONTRADICTING'
  source_slug: string
  source_name: string
  source_type: SourceType
  authority_level: number
  title: string | null
  canonical_url: string | null
  published_at: string | null
  fetched_at: string
  reported_authority: string | null
  excerpt: string | null
}
export type EventUpdateDTO = {
  id: string
  update_type: string
  previous_status: EventStatus | null
  new_status: EventStatus | null
  previous_expected_end: string | null
  new_expected_end: string | null
  message: string | null
  actor: string
  created_at: string
}

export type CityEventDTO = {
  id: string
  category: Category
  event_type: string
  title: string
  summary: string | null
  status: EventStatus
  /** Status after the freshness rule: an ACTIVE event whose ETA passed long ago without an update is shown as not recently confirmed. */
  display_status: EventStatus
  severity: Severity
  starts_at: string | null
  expected_ends_at: string | null
  actual_ends_at: string | null
  reason: string | null
  official_eta: boolean
  confidence: number
  verification_status: Verification
  advisory_origin: 'OFFICIAL' | 'APP_ADVISORY' | null
  reported_authority: string | null
  primary_source: { slug: string; name: string; source_type: SourceType }
  time_text: string | null
  location_text: string | null
  last_confirmed_at: string
  freshness: Freshness
  is_demo: boolean
  created_at: string
  updated_at: string
  resolved_at: string | null
  areas: AreaRef[]
  buildings: BuildingRef[]
  building_count: number
  deep_link: string
  relevance?: Relevance
  /** Why (city-core MatchReason): 'area_other_buildings' = in my microdistrict, but the source lists other houses. */
  relevance_reason?: string
  distance_m?: number | null
}

export type CityEventDetailDTO = CityEventDTO & { updates: EventUpdateDTO[]; sources: SourceRef[] }

// ── Aktau Now ───────────────────────────────────────────────────────────────
export type ServiceStatusDTO = {
  key: ServiceKey
  state: ServiceState
  /** Events driving the state (ids), most relevant first. */
  event_ids: string[]
  /** Short localised label ("Normal", "1 notice", "Not confirmed"). */
  label: string
  /** When service information was last confirmed by a source (null = never). */
  confirmed_at: string | null
}

export type WeatherSnippet = {
  forecast: {
    provider: 'Open-Meteo'
    temperature_c: number | null
    apparent_c: number | null
    weather_code: number | null
    wind_ms: number | null
    gust_ms: number | null
    wind_dir_deg: number | null
    fetched_at: string
    stale: boolean
  } | null
  observation: {
    provider: 'Kazhydromet'
    station: string
    temperature_c: number | null
    wind_ms: number | null
    observed_at: string
  } | null
  marine: {
    provider: 'Open-Meteo Marine'
    wave_height_m: number | null
    sea_temp_c: number | null
    fetched_at: string
    label: 'modelled'
  } | null
  air: {
    provider: 'Open-Meteo Air Quality'
    us_aqi: number | null
    pm2_5: number | null
    pm10: number | null
    fetched_at: string
    label: 'modelled'
  } | null
  advisories: Array<{ event_id: string; kind: string; origin: 'OFFICIAL' | 'APP_ADVISORY'; text: string }>
}

export type LocationContext = {
  kind: 'saved' | 'building' | 'area' | 'point' | 'city'
  label: string
  saved_location_id: string | null
  area: { id: string; slug: string; name: string; designator: string | null } | null
  building: { id: string; house_number: string } | null
  point: { lat: number; lon: number } | null
}

export type AktauNowDTO = {
  location: LocationContext
  overall: 'CALM' | 'ATTENTION' | 'DISRUPTION' | 'UNKNOWN'
  affecting_user: number
  nearby: number
  headline: string
  priority_event: CityEventDTO | null
  affecting: CityEventDTO[]
  nearby_events: CityEventDTO[]
  recently_resolved: CityEventDTO | null
  services: ServiceStatusDTO[]
  weather: WeatherSnippet
  today: Array<{ at: string; event_id: string; label: string }>
  freshness: { data_as_of: string; oldest_source_at: string | null; stale_sources: string[] }
  generated_at: string
}

// ── Ask Aktau response contract ─────────────────────────────────────────────
export const ASK_INTENTS = [
  'UTILITY_STATUS', 'UPCOMING_OUTAGE', 'CITY_STATE', 'AROUND_ME', 'WEATHER', 'CASPIAN', 'PLACE_SEARCH',
  'DIRECTIONS', 'TRANSPORT', 'EVENT_SEARCH', 'ROAD_STATUS', 'UNKNOWN',
] as const
export type AskIntent = (typeof ASK_INTENTS)[number]

export type AskResponse = {
  intent: AskIntent
  answer_type: 'utility' | 'city_state' | 'weather' | 'caspian' | 'places' | 'events' | 'directions' | 'unknown'
  /** Headline answer, e.g. "Not between 09:00 and 15:00." */
  message: string
  /** Supporting sentence. */
  detail: string | null
  confidence: 'confirmed' | 'reported' | 'no_information' | 'model'
  data: Record<string, unknown>
  sources: Array<{ name: string; type: SourceType; url: string | null; updated_at: string | null }>
  event_ids: string[]
  phrased_by: 'template' | 'llm'
  updated_at: string
}

// ── Widget ──────────────────────────────────────────────────────────────────
export type WidgetState = {
  status: 'CALM' | 'ATTENTION' | 'DISRUPTION' | 'UNKNOWN'
  headline: string
  detail: string | null
  event_id: string | null
  deep_link: string
  weather: { temperature_c: number | null; wind_ms: number | null; provider: string } | null
  location_label: string
  updated_at: string
  /** Suggested next refresh; WidgetKit ultimately decides. */
  refresh_after: string
}

// ── API request bodies ──────────────────────────────────────────────────────
export const AskRequestSchema = z.object({
  question: z.string().min(1).max(400),
  lang: z.enum(LANGUAGES).default('en'),
  saved_location_id: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
})

export const DeviceRegisterSchema = z.object({
  installation_id: z.string().min(8).max(100),
  platform: z.enum(['ios', 'android', 'web']),
  push_token: z.string().min(10).max(4096).optional(),
  language: z.enum(LANGUAGES).optional(),
  mode: z.enum(['RESIDENT', 'VISITOR', 'EXPLORER']).optional(),
})

export const SavedLocationInputSchema = z.object({
  label: z.string().min(1).max(60),
  type: z.enum(['HOME', 'WORK', 'SCHOOL', 'HOTEL', 'CUSTOM']),
  area_id: z.string().uuid().nullable().optional(),
  building_id: z.string().uuid().nullable().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  is_primary: z.boolean().optional(),
})

export const AlertPreferencesSchema = z.object({
  water: z.boolean(),
  electricity: z.boolean(),
  heating: z.boolean(),
  road: z.boolean(),
  transport: z.boolean(),
  weather: z.boolean(),
  emergency: z.boolean(),
  events: z.boolean(),
  affects_me_only: z.boolean(),
  minimum_severity: z.enum(SEVERITIES),
})
export type AlertPreferences = z.infer<typeof AlertPreferencesSchema>

export const IngestRequestSchema = z.object({
  source_slug: z.string().min(2).max(60),
  url: z.string().url().max(1000).optional().or(z.literal('').transform(() => undefined)),
  title: z.string().max(300).optional(),
  text: z.string().min(10).max(20000),
  published_at: isoDateTime.optional(),
  reported_authority: z.string().max(80).optional(),
  /** Demo items stay separate from real ones end-to-end (only allowed when DEMO_MODE=true). */
  is_demo: z.boolean().optional(),
})
