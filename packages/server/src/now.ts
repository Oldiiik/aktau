// getAktauNow(location) — the one engine behind Home, the widget, Ask context
// and notification copy. Aggregates everything Home needs in ONE response.
import { composeAktauNow, deriveServiceStatus, rankAroundMe, weatherCodeText } from '@aktau/city-core'
import { openMeteoForecast, type AirPayload, type ForecastPayload, type MarinePayload } from '@aktau/connectors'
import { serviceStateLabel } from '@aktau/i18n'
import type { AktauNowDTO, CityEventDTO, Lang, ServiceKey, ServiceStatusDTO, WeatherSnippet } from '@aktau/types'
import { cacheGet, cacheSet } from './cache.ts'
import type { Sql } from './db/client.ts'
import { loadEvents } from './events.ts'
import { resolveLocation, type LocationInput } from './location.ts'
import { log } from './log.ts'

const SERVICES: ServiceKey[] = ['water', 'electricity', 'heating', 'roads', 'transport']

let inflightForecast: Promise<void> | null = null

/** Forecast from cache; refreshed at most every 10 min; stale cache served (and flagged) if the provider fails. */
export async function forecast(sql: Sql, now: Date) {
  let hit = await cacheGet<ForecastPayload>(sql, 'open_meteo', 'forecast:aktau', now)
  // A payload cached before the 7-day detail fields existed is refreshed right away.
  if (!hit || hit.stale || !hit.payload.daily.sunrise) {
    inflightForecast ??= (async () => {
      try {
        const r = await openMeteoForecast.fetch({ now })
        const payload = r.items[0]?.raw_json
        if (payload) await cacheSet(sql, 'open_meteo', 'forecast:aktau', payload, 600, now)
      } catch (err) {
        log('warn', 'weather.refresh_failed', { err })
      }
    })().finally(() => { inflightForecast = null })
    await inflightForecast
    hit = await cacheGet<ForecastPayload>(sql, 'open_meteo', 'forecast:aktau', now)
  }
  return hit
}

export async function getWeatherSnippet(sql: Sql, now = new Date(), lang: Lang = 'en'): Promise<WeatherSnippet & { text: string | null }> {
  const [f, marine, air] = await Promise.all([
    forecast(sql, now),
    cacheGet<MarinePayload>(sql, 'open_meteo_marine', 'marine:aktau', now),
    cacheGet<AirPayload>(sql, 'open_meteo_air', 'air:aktau', now),
  ])
  const [obs] = await sql<{ station_name: string; air_temperature_c: number | null; wind_speed_ms: number | null; observed_at: Date }[]>`
    select station_name, air_temperature_c, wind_speed_ms, observed_at from weather_observations
    where observed_at > ${new Date(now.getTime() - 6 * 3600_000)} order by observed_at desc limit 1`
  const adv = await sql<{ id: string; event_type: string; advisory_origin: 'OFFICIAL' | 'APP_ADVISORY'; summary: string | null }[]>`
    select id, event_type, advisory_origin, summary from city_events
    where category = 'WEATHER' and status not in ('RESOLVED', 'CANCELLED') and (expected_ends_at is null or expected_ends_at > ${now})`
  const c = f?.payload.current
  return {
    forecast: c ? {
      provider: 'Open-Meteo', temperature_c: c.temperature_2m, apparent_c: c.apparent_temperature, weather_code: c.weather_code,
      wind_ms: c.wind_speed_10m, gust_ms: c.wind_gusts_10m, wind_dir_deg: c.wind_direction_10m, fetched_at: f!.fetched_at.toISOString(),
      stale: now.getTime() - f!.fetched_at.getTime() > 30 * 60_000,
    } : null,
    observation: obs ? { provider: 'Kazhydromet', station: obs.station_name, temperature_c: obs.air_temperature_c, wind_ms: obs.wind_speed_ms, observed_at: obs.observed_at.toISOString() } : null,
    marine: marine ? { provider: 'Open-Meteo Marine', wave_height_m: marine.payload.current.wave_height, sea_temp_c: marine.payload.current.sea_surface_temperature, fetched_at: marine.fetched_at.toISOString(), label: 'modelled' } : null,
    air: air ? { provider: 'Open-Meteo Air Quality', us_aqi: air.payload.current.us_aqi, pm2_5: air.payload.current.pm2_5, pm10: air.payload.current.pm10, fetched_at: air.fetched_at.toISOString(), label: 'modelled' } : null,
    advisories: adv.map((a) => ({ event_id: a.id, kind: a.event_type, origin: a.advisory_origin ?? 'OFFICIAL', text: a.summary ?? '' })),
    text: c ? weatherCodeText(c.weather_code, lang) : null,
  }
}

/**
 * When were the sources that would report each service last successfully
 * checked? Utility/road problems reach us via notice sources (automated media
 * + manual official ingestion). No recent check → UNKNOWN, never "Normal".
 */
export async function serviceCoverage(sql: Sql): Promise<Record<ServiceKey, Date | null>> {
  const [r] = await sql<{ auto: Date | null; manual: Date | null }[]>`
    select
      (select max(last_successful_fetch_at) from sources where enabled and adapter_type = 'lada_html') auto,
      (select max(si.fetched_at) from source_items si join sources s on s.id = si.source_id where s.adapter_type = 'manual') manual`
  const t = [r?.auto, r?.manual].filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  return { water: t, electricity: t, heating: t, roads: t, transport: t }
}

export async function getAktauNow(sql: Sql, input: LocationInput, lang: Lang, now = new Date()): Promise<AktauNowDTO & { weather_text: string | null; around: CityEventDTO[] }> {
  const loc = await resolveLocation(sql, input, lang)
  const [events, resolved, weather, coverage, sourceTimes] = await Promise.all([
    loadEvents(sql, { current: true }, loc, now),
    loadEvents(sql, { resolvedSince: new Date(now.getTime() - 3 * 3600_000) }, loc, now),
    getWeatherSnippet(sql, now, lang),
    serviceCoverage(sql),
    sql<{ oldest: Date | null; stale: string[] }[]>`
      select min(last_successful_fetch_at) oldest,
        coalesce(array_agg(slug) filter (where adapter_type <> 'manual' and enabled and (last_successful_fetch_at is null or last_successful_fetch_at < now() - make_interval(secs => greatest(coalesce(poll_interval_seconds, 3600) * 3, 1800)))), '{}') stale
      from sources where enabled and adapter_type not in ('manual', 'nominatim', 'dgis_places', 'egov_open_data')`,
  ])
  const scope = loc.ctx.kind === 'city' ? 'city' : 'personal'
  const services: ServiceStatusDTO[] = SERVICES.map((key) => {
    const d = deriveServiceStatus(key, events.map((e) => ({
      id: e.id, category: e.category, display_status: e.display_status, starts_at: e.starts_at ? new Date(e.starts_at) : null, relevance: scope === 'city' ? 'DIRECT' : e.relevance ?? 'NO',
    })), coverage[key], now, { scope })
    return { key, state: d.state, event_ids: d.event_ids, label: serviceStateLabel(lang, key, d.state, Math.max(1, d.count)), confirmed_at: d.confirmed_at?.toISOString() ?? null }
  })
  const dto = composeAktauNow({
    location: loc.ctx, events, recentlyResolved: resolved, services, weather, lang, now,
    sourceTimes: { oldest: sourceTimes[0]?.oldest?.toISOString() ?? null, stale: sourceTimes[0]?.stale ?? [] },
  })
  const around = rankAroundMe(events.filter((e) => e.relevance === 'NEARBY' || e.relevance === 'AREA' || e.relevance === 'DIRECT'), now).slice(0, 6)
  return { ...dto, weather_text: weather.text, around }
}
