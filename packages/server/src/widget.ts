// GET /api/widget/state — compact, precomputed; the widget renders it as-is.
import { widgetStateFrom } from '@aktau/city-core'
import type { Lang, WidgetState } from '@aktau/types'
import type { Sql } from './db/client.ts'
import { getAktauNow } from './now.ts'

export async function getWidgetState(sql: Sql, input: { installation_id?: string | null; saved_location_id?: string | null }, lang: Lang, now = new Date()): Promise<WidgetState> {
  const n = await getAktauNow(sql, { installation_id: input.installation_id, saved_location_id: input.saved_location_id }, lang, now)
  return widgetStateFrom(n, lang, now)
}
