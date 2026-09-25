// Open-Meteo: forecast, marine and air-quality model data for Aktau.
// Always labelled as model output; never an official measurement or a
// swimming / navigation safety statement.
import { httpJson } from './http.ts'
import { AKTAU, type SourceConnector } from './types.ts'

const TZ = 'Asia%2FAqtau'

export type ForecastPayload = {
  current: {
    time: string; temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number; wind_direction_10m: number; wind_gusts_10m: number
    // Detail fields (weather page); absent in payloads cached before 2026-09-24.
    relative_humidity_2m?: number; pressure_msl?: number; cloud_cover?: number; is_day?: number; precipitation?: number
  }
  hourly: {
    time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[]; wind_speed_10m: number[]; wind_gusts_10m: number[]
    apparent_temperature?: number[]; relative_humidity_2m?: number[]; wind_direction_10m?: number[]; uv_index?: number[]; is_day?: number[]; precipitation?: number[]
  }
  daily: {
    time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; wind_speed_10m_max: number[]; wind_gusts_10m_max: number[]
    weather_code?: number[]; sunrise?: string[]; sunset?: string[]; uv_index_max?: number[]; precipitation_sum?: number[]; wind_direction_10m_dominant?: number[]
  }
  utc_offset_seconds: number
}

/** Open-Meteo returns local wall-clock times without offset; attach +05:00 so they are absolute. */
export function withOffset(times: string[], offsetSeconds: number): string[] {
  const sign = offsetSeconds >= 0 ? '+' : '-'
  const abs = Math.abs(offsetSeconds)
  const off = `${sign}${String(Math.floor(abs / 3600)).padStart(2, '0')}:${String((abs % 3600) / 60).padStart(2, '0')}`
  return times.map((t) => (t.length === 16 ? `${t}:00${off}` : t.length === 10 ? t : `${t}${off}`))
}

export const openMeteoForecast: SourceConnector = {
  slug: 'open_meteo',
  job: 'weather',
  async fetch(ctx) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${AKTAU.lat}&longitude=${AKTAU.lon}&timezone=${TZ}&wind_speed_unit=ms&forecast_days=7` +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,pressure_msl,cloud_cover,is_day,precipitation' +
      '&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,apparent_temperature,relative_humidity_2m,wind_direction_10m,uv_index,is_day,precipitation' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code,sunrise,sunset,uv_index_max,precipitation_sum,wind_direction_10m_dominant'
    const { data, status } = await httpJson<ForecastPayload>(url, { timeoutMs: 12_000 })
    data.hourly.time = withOffset(data.hourly.time, data.utc_offset_seconds)
    data.current.time = withOffset([data.current.time], data.utc_offset_seconds)[0]!
    if (data.daily.sunrise) data.daily.sunrise = withOffset(data.daily.sunrise, data.utc_offset_seconds)
    if (data.daily.sunset) data.daily.sunset = withOffset(data.daily.sunset, data.utc_offset_seconds)
    const hour = ctx.now.toISOString().slice(0, 13)
    return {
      http_status: status,
      items: [{
        external_id: `forecast:${hour}`,
        canonical_url: 'https://open-meteo.com/',
        title: `Open-Meteo forecast for Aktau (${hour}Z)`,
        raw_text: `Forecast: ${data.current.temperature_2m}°C, wind ${data.current.wind_speed_10m} m/s, gusts ${data.current.wind_gusts_10m} m/s`,
        raw_json: data,
        language: 'en',
        published_at: new Date(data.current.time),
        extractable: false,
      }],
    }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'Public API, no key.' }
  },
}

export type MarinePayload = {
  current: { time: string; wave_height: number | null; wave_direction: number | null; wave_period: number | null; sea_surface_temperature: number | null; ocean_current_velocity: number | null; ocean_current_direction: number | null }
  /** Next two days (weather page); absent in payloads cached before 2026-09-24. */
  hourly?: { time: string[]; wave_height: Array<number | null>; sea_surface_temperature: Array<number | null> }
  utc_offset_seconds: number
}

export const openMeteoMarine: SourceConnector = {
  slug: 'open_meteo_marine',
  job: 'air-marine',
  async fetch(ctx) {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${AKTAU.coastLat}&longitude=${AKTAU.coastLon}&timezone=${TZ}` +
      '&current=wave_height,wave_direction,wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction' +
      '&hourly=wave_height,sea_surface_temperature&forecast_days=2'
    const { data, status } = await httpJson<MarinePayload>(url, { timeoutMs: 12_000 })
    data.current.time = withOffset([data.current.time], data.utc_offset_seconds)[0]!
    if (data.hourly) data.hourly.time = withOffset(data.hourly.time, data.utc_offset_seconds)
    return {
      http_status: status,
      items: [{
        external_id: `marine:${ctx.now.toISOString().slice(0, 13)}`,
        canonical_url: 'https://open-meteo.com/en/docs/marine-weather-api',
        title: 'Modelled Caspian conditions near Aktau',
        raw_text: `Wave height ${data.current.wave_height} m, sea surface ${data.current.sea_surface_temperature}°C (model)`,
        raw_json: data,
        language: 'en',
        published_at: new Date(data.current.time),
        extractable: false,
      }],
    }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'Public API, no key. Model data only.' }
  },
}

export type AirPayload = { current: { time: string; pm2_5: number | null; pm10: number | null; nitrogen_dioxide: number | null; ozone: number | null; us_aqi: number | null }; utc_offset_seconds: number }

export const openMeteoAir: SourceConnector = {
  slug: 'open_meteo_air',
  job: 'air-marine',
  async fetch(ctx) {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${AKTAU.lat}&longitude=${AKTAU.lon}&timezone=${TZ}` +
      '&current=pm2_5,pm10,nitrogen_dioxide,ozone,us_aqi'
    const { data, status } = await httpJson<AirPayload>(url, { timeoutMs: 12_000 })
    data.current.time = withOffset([data.current.time], data.utc_offset_seconds)[0]!
    return {
      http_status: status,
      items: [{
        external_id: `air:${ctx.now.toISOString().slice(0, 13)}`,
        canonical_url: 'https://open-meteo.com/en/docs/air-quality-api',
        title: 'Modelled air quality for Aktau',
        raw_text: `US AQI ${data.current.us_aqi}, PM2.5 ${data.current.pm2_5} µg/m³ (CAMS model estimate)`,
        raw_json: data,
        language: 'en',
        published_at: new Date(data.current.time),
        extractable: false,
      }],
    }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'Public API, no key. Model estimate, not a station measurement.' }
  },
}
