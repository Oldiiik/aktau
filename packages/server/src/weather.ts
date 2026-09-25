// The weather page: everything we know about Aktau's weather and sea, each
// part labelled with where it comes from. Forecast and sea are models
// (Open-Meteo); the station reading is official (Kazhydromet). Nothing here
// turns the numbers into advice beyond the transparent thresholds in city-core.
import { describeConditions, weatherCodeText } from '@aktau/city-core'
import { openMeteoAir, openMeteoMarine, type AirPayload, type MarinePayload } from '@aktau/connectors'
import type { Lang } from '@aktau/types'
import { cached } from './cache.ts'
import type { Sql } from './db/client.ts'
import { forecast } from './now.ts'

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export type WeatherDetail = Awaited<ReturnType<typeof getWeatherDetail>>

export async function getWeatherDetail(sql: Sql, now = new Date(), lang: Lang = 'en') {
  const [f, marine, air, obs, adv] = await Promise.all([
    forecast(sql, now),
    // The scheduled job keeps these warm; a page view refreshes them when they are old or lack the hourly part.
    cached<MarinePayload>(sql, 'open_meteo_marine', 'marine:aktau', 1800, async () => (await openMeteoMarine.fetch({ now })).items[0]!.raw_json as MarinePayload)
      .then(async (m) => (m && !m.payload.hourly ? { ...m, payload: (await openMeteoMarine.fetch({ now })).items[0]!.raw_json as MarinePayload } : m)).catch(() => null),
    cached<AirPayload>(sql, 'open_meteo_air', 'air:aktau', 3600, async () => (await openMeteoAir.fetch({ now })).items[0]!.raw_json as AirPayload).catch(() => null),
    sql<{ station_name: string; air_temperature_c: number | null; wind_speed_ms: number | null; wind_direction_deg: number | null; wind_gust_ms: number | null; pressure_msl_hpa: number | null; dewpoint_c: number | null; observed_at: Date }[]>`
      select station_name, air_temperature_c::float, wind_speed_ms::float, wind_direction_deg::float, wind_gust_ms::float, pressure_msl_hpa::float, dewpoint_c::float, observed_at
      from weather_observations where observed_at > ${new Date(now.getTime() - 6 * 3600_000)} order by observed_at desc limit 1`,
    sql<{ id: string; event_type: string; advisory_origin: 'OFFICIAL' | 'APP_ADVISORY' | null; summary: string | null; starts_at: Date | null; expected_ends_at: Date | null }[]>`
      select id, event_type, advisory_origin, summary, starts_at, expected_ends_at from city_events
      where category = 'WEATHER' and status not in ('RESOLVED', 'CANCELLED') and (expected_ends_at is null or expected_ends_at > ${now})`,
  ])
  const p = f?.payload
  const c = p?.current
  // Hourly: from the current hour, the next 24.
  const hStart = p ? Math.max(0, p.hourly.time.findIndex((t) => new Date(t).getTime() > now.getTime() - 3600_000)) : 0
  const hourly = p ? p.hourly.time.slice(hStart, hStart + 24).map((t, k) => {
    const i = hStart + k
    return {
      time: new Date(t).toISOString(), temp: n(p.hourly.temperature_2m[i]), code: n(p.hourly.weather_code[i]), precip_prob: n(p.hourly.precipitation_probability[i]),
      wind: n(p.hourly.wind_speed_10m[i]), gust: n(p.hourly.wind_gusts_10m[i]), wind_dir: n(p.hourly.wind_direction_10m?.[i]), is_day: p.hourly.is_day ? p.hourly.is_day[i] === 1 : null,
      uv: n(p.hourly.uv_index?.[i]),
    }
  }) : []
  const daily = p ? p.daily.time.map((d, i) => ({
    date: d, max: n(p.daily.temperature_2m_max[i]), min: n(p.daily.temperature_2m_min[i]), code: n(p.daily.weather_code?.[i]),
    precip_prob: n(p.daily.precipitation_probability_max[i]), precip_mm: n(p.daily.precipitation_sum?.[i]), wind_max: n(p.daily.wind_speed_10m_max[i]),
    gust_max: n(p.daily.wind_gusts_10m_max[i]), wind_dir: n(p.daily.wind_direction_10m_dominant?.[i]), uv_max: n(p.daily.uv_index_max?.[i]),
    sunrise: p.daily.sunrise?.[i] ? new Date(p.daily.sunrise[i]!).toISOString() : null, sunset: p.daily.sunset?.[i] ? new Date(p.daily.sunset[i]!).toISOString() : null,
  })) : []
  const m = marine?.payload
  const mStart = m?.hourly ? Math.max(0, m.hourly.time.findIndex((t) => new Date(t).getTime() > now.getTime() - 3600_000)) : 0
  const a = air?.payload.current
  return {
    now: now.toISOString(),
    current: c ? {
      temp: n(c.temperature_2m), feels: n(c.apparent_temperature), code: n(c.weather_code), text: weatherCodeText(c.weather_code, lang),
      wind: n(c.wind_speed_10m), gust: n(c.wind_gusts_10m), wind_dir: n(c.wind_direction_10m), humidity: n(c.relative_humidity_2m),
      pressure: n(c.pressure_msl), cloud: n(c.cloud_cover), precip: n(c.precipitation), is_day: c.is_day == null ? null : c.is_day === 1,
      conditions: describeConditions({ wind_ms: c.wind_speed_10m, gust_ms: c.wind_gusts_10m }),
    } : null,
    hourly,
    daily,
    observation: obs[0] ? {
      station: obs[0].station_name, temp: obs[0].air_temperature_c, wind: obs[0].wind_speed_ms, wind_dir: obs[0].wind_direction_deg, gust: obs[0].wind_gust_ms,
      pressure: obs[0].pressure_msl_hpa, dewpoint: obs[0].dewpoint_c, observed_at: new Date(obs[0].observed_at).toISOString(),
    } : null,
    sea: m ? {
      wave: n(m.current.wave_height), period: n(m.current.wave_period), wave_dir: n(m.current.wave_direction), temp: n(m.current.sea_surface_temperature),
      sea_word: describeConditions({ wave_m: m.current.wave_height }).sea,
      hourly: m.hourly ? m.hourly.time.slice(mStart, mStart + 24).map((t, k) => ({ time: new Date(t).toISOString(), wave: n(m.hourly!.wave_height[mStart + k]) })) : [],
      fetched_at: marine!.fetched_at.toISOString(),
    } : null,
    air: a ? { aqi: n(a.us_aqi), pm2_5: n(a.pm2_5), pm10: n(a.pm10), no2: n(a.nitrogen_dioxide), o3: n(a.ozone), fetched_at: air!.fetched_at.toISOString() } : null,
    advisories: adv.map((x) => ({ id: x.id, kind: x.event_type, origin: x.advisory_origin ?? 'OFFICIAL', text: x.summary ?? '', starts_at: x.starts_at?.toISOString() ?? null, ends_at: x.expected_ends_at?.toISOString() ?? null })),
    forecast_fetched_at: f?.fetched_at.toISOString() ?? null,
  }
}
