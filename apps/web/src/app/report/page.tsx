import { getSql, lite, myIncidents, resolveLocation, sessionById, type IncidentDTO } from '@aktau/server'
import { Screen } from '@/components/app'
import { ReportView } from '@/components/report'
import { canUseCopilot } from '@/lib/auth'
import { currentAccount, getInstallationId, getLang } from '@/lib/session'

export const dynamic = 'force-dynamic'

// ?session=<code>: a presenter (staff account) reports into a live demo session.
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ text?: string; session?: string }> }) {
  const [lang, iid, { text, session: code }, me] = await Promise.all([getLang(), getInstallationId(), searchParams, currentAccount()])
  const sql = getSql()
  const [loc, mine, s] = await Promise.all([
    resolveLocation(sql, { installation_id: iid }, lang), iid ? myIncidents(sql, iid) : Promise.resolve([] as IncidentDTO[]),
    code && canUseCopilot(me?.role) ? sessionById(sql, code) : null,
  ])
  const session = s && s.status === 'active' ? { id: s.id, code: s.code, title: s.title, venue: s.venue } : null
  const home = loc.ctx.area ? { designator: loc.ctx.area.designator, house: loc.ctx.building?.house_number ?? null } : null
  return <Screen><ReportView home={home} mine={JSON.parse(JSON.stringify(mine.map(lite)))} initialText={text?.slice(0, 600) ?? (session ? 'Wi-Fi в зале работает нестабильно' : '')} session={session} /></Screen>
}
