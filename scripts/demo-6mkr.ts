// A labelled demo incident (is_demo = true) in 6 microdistrict, told through the
// real engine: residents report a burst pipe on four channels, 109 routes it to
// the responsible team, the team commits to a deadline, goes out and posts
// progress. Created once; runs again only if that demo was removed.
//   DATABASE_URL=… npx tsx scripts/demo-6mkr.ts
// On Vercel the production build runs it when AKTAU_DEMO_SEED=6mkr (migrate.ts).
import type { Sql } from '../packages/server/src/db/client.ts'
import { incidentAction, submitSignal } from '../packages/server/src/incidents.ts'
import { fmtTime } from '../packages/normalization/src/time.ts'

const TITLE = 'Прорыв водопровода во дворе, 6 мкр'
const TEAM = 'Аварийная бригада №2'
const M = 60_000, H = 60 * M

export async function seedSixMkrDemo(sql: Sql, now = new Date()): Promise<string> {
  const [existing] = await sql<{ code: string }[]>`select code from incidents where is_demo and public_title = ${TITLE} and status not in ('RESOLVED', 'VERIFIED', 'REJECTED')`
  if (existing) return `already there (${existing.code})`

  const at = (ago: number) => new Date(now.getTime() - ago)
  const signals: Array<{ text: string; channel: 'PHONE' | 'WHATSAPP' | 'APP' | 'KOMEK109' | 'INSTAGRAM'; ago: number }> = [
    { text: 'Алло, 6 микрорайон, дом 12. Во дворе прорвало трубу, вода течёт по всему двору, в квартирах напор почти пропал.', channel: 'PHONE', ago: 3 * H },
    { text: '6 мкр 12 дом, во дворе из-под асфальта бьёт вода, уже течёт к дороге', channel: 'WHATSAPP', ago: 2.8 * H },
    { text: '6 мкр дом 13 — с утра нет воды, во дворе прорыв', channel: 'APP', ago: 2.6 * H },
    { text: '6 ш/а 11 үйде су жоқ, аулада құбыр жарылды', channel: 'KOMEK109', ago: 2.5 * H },
    { text: 'Весь двор в 6 микрорайоне затопило, дома 11–13, когда починят?', channel: 'INSTAGRAM', ago: 2.3 * H },
    { text: '6 мкр 14 дом тоже без воды', channel: 'APP', ago: 1.4 * H },
  ]
  const first = signals[0]!
  const r = await submitSignal(sql, { text: first.text, channel: first.channel, create: true, is_demo: true, now: at(first.ago), installation_id: 'demo-6mkr-0', actor: 'copilot' })
  const id = r.incident_id!
  for (const [k, s] of signals.slice(1).entries()) {
    await submitSignal(sql, { text: s.text, channel: s.channel, attach_to: id, is_demo: true, now: at(s.ago), installation_id: `demo-6mkr-${k + 1}`, actor: 'operator' })
  }

  const finish = new Date(now.getTime() + 2.5 * H)
  await incidentAction(sql, id, { action: 'title', title: TITLE }, 'operator', at(2.75 * H))
  await incidentAction(sql, id, { action: 'route', team: TEAM }, 'operator', at(2.7 * H))
  const [{ org } = { org: null }] = await sql<{ org: string | null }[]>`select responsible_org org from incidents where id = ${id}`
  const team = `executor:${org ?? TEAM}`
  await incidentAction(sql, id, { action: 'commit', start_at: at(2.2 * H).toISOString(), finish_at: finish.toISOString() }, team, at(2.5 * H))
  await incidentAction(sql, id, { action: 'dispatch', message: `${TEAM} выехала на место.` }, team, at(2.2 * H))
  await incidentAction(sql, id, { action: 'update', message: 'Место прорыва найдено у дома 12, задвижка перекрыта. Вода в домах 11–14 отключена на время ремонта.' }, team, at(1.6 * H))
  await incidentAction(sql, id, { action: 'update', message: `Меняем участок трубы (около 6 м). Подачу воды планируем восстановить к ${fmtTime(finish)}.` }, team, at(35 * M))
  const [inc] = await sql<{ code: string; status: string; org: string | null }[]>`select code, status, responsible_org org from incidents where id = ${id}`
  return `${inc!.code} ${inc!.status}, ${inc!.org ?? '-'} · ${TEAM}, until ${fmtTime(finish)}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { createSql, databaseUrl } = await import('../packages/server/src/db/client.ts')
  const url = databaseUrl()
  if (!url) throw new Error('DATABASE_URL is required')
  const sql = createSql(url, { max: 1 })
  console.log(await seedSixMkrDemo(sql))
  await sql.end()
}
