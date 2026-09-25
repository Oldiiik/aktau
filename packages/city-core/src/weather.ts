// Transparent weather thresholds. These produce an "Aktau app advisory",
// clearly labelled as ours — never presented as an official warning. Official
// warnings (Kazhydromet) arrive through the normal source pipeline instead.
import type { Severity } from '@aktau/types'

export const ADVISORY_THRESHOLDS = {
  windGustAttentionMs: 15,
  windGustMajorMs: 20,
  heatC: 38,
  coldC: -15,
  heavyRainProbability: 80,
} as const

export type HourlyForecast = { time: string[]; temperature_2m?: Array<number | null>; wind_gusts_10m?: Array<number | null>; precipitation_probability?: Array<number | null> }

export type Advisory = {
  kind: 'wind_advisory' | 'heat_advisory' | 'cold_advisory' | 'rain_advisory'
  starts_at: Date
  ends_at: Date
  peak: number
  severity: Severity
  text: string
}

function windows(times: Date[], values: Array<number | null> | undefined, pred: (v: number) => boolean) {
  const out: Array<{ start: Date; end: Date; peak: number }> = []
  if (!values) return out
  let cur: { start: Date; end: Date; peak: number } | null = null
  values.forEach((v, i) => {
    const at = times[i]!
    if (v != null && pred(v)) {
      if (!cur) cur = { start: at, end: new Date(at.getTime() + 3_600_000), peak: v }
      else { cur.end = new Date(at.getTime() + 3_600_000); cur.peak = Math.max(cur.peak, v) }
    } else if (cur) { out.push(cur); cur = null }
  })
  if (cur) out.push(cur)
  return out
}

/** Next-24h advisories from an Open-Meteo hourly block (times are ISO with offset or UTC). */
export function computeAdvisories(hourly: HourlyForecast, now: Date, horizonHours = 24): Advisory[] {
  const times = hourly.time.map((s) => new Date(s))
  const inHorizon = (d: Date) => d.getTime() >= now.getTime() - 3_600_000 && d.getTime() <= now.getTime() + horizonHours * 3_600_000
  const slice = <T,>(arr: T[] | undefined) => arr?.filter((_, i) => inHorizon(times[i]!))
  const ts = times.filter(inHorizon)
  const T = ADVISORY_THRESHOLDS
  const out: Advisory[] = []
  for (const w of windows(ts, slice(hourly.wind_gusts_10m), (v) => v >= T.windGustAttentionMs)) {
    out.push({ kind: 'wind_advisory', starts_at: w.start, ends_at: w.end, peak: w.peak, severity: w.peak >= T.windGustMajorMs ? 'MAJOR' : 'MODERATE', text: `Gusts up to ${Math.round(w.peak)} m/s` })
  }
  for (const w of windows(ts, slice(hourly.temperature_2m), (v) => v >= T.heatC)) {
    out.push({ kind: 'heat_advisory', starts_at: w.start, ends_at: w.end, peak: w.peak, severity: 'MODERATE', text: `Up to ${Math.round(w.peak)}°C` })
  }
  for (const w of windows(ts, slice(hourly.temperature_2m), (v) => v <= T.coldC)) {
    out.push({ kind: 'cold_advisory', starts_at: w.start, ends_at: w.end, peak: w.peak, severity: 'MODERATE', text: `Down to ${Math.round(w.peak)}°C` })
  }
  for (const w of windows(ts, slice(hourly.precipitation_probability), (v) => v >= T.heavyRainProbability)) {
    out.push({ kind: 'rain_advisory', starts_at: w.start, ends_at: w.end, peak: w.peak, severity: 'MINOR', text: `Rain likely (${Math.round(w.peak)}%)` })
  }
  return out
}

/** WMO weather code → short English phrase (Open-Meteo convention). */
export function weatherCodeText(code: number | null, lang: 'en' | 'ru' | 'kk' = 'en'): string {
  if (code == null) return ''
  const table: Array<[number[], [string, string, string]]> = [
    [[0], ['Clear', 'Ясно', 'Ашық']],
    [[1, 2], ['Mostly clear', 'Малооблачно', 'Аздап бұлтты']],
    [[3], ['Overcast', 'Пасмурно', 'Бұлтты']],
    [[45, 48], ['Fog', 'Туман', 'Тұман']],
    [[51, 53, 55, 56, 57], ['Drizzle', 'Морось', 'Сіркіреме']],
    [[61, 63, 65, 66, 67, 80, 81, 82], ['Rain', 'Дождь', 'Жаңбыр']],
    [[71, 73, 75, 77, 85, 86], ['Snow', 'Снег', 'Қар']],
    [[95, 96, 99], ['Thunderstorm', 'Гроза', 'Найзағай']],
  ]
  const hit = table.find(([codes]) => codes.includes(code))
  const idx = lang === 'en' ? 0 : lang === 'ru' ? 1 : 2
  return hit ? hit[1][idx] : ''
}
