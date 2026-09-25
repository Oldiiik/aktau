import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAktauNow, getSql, lite, listIncidents, listNews, nearbyFor, openPlacesNearArea, whatsOn } from '@aktau/server'
import { Screen } from '@/components/app'
import { HomeView } from '@/components/home'
import { getInstallationId, getLang } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function HomePage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  // First launch goes through the entrance (/start): language, name, home, alerts.
  if (!(await cookies()).get('aktau_onboarded')) redirect('/start')
  const [{ saved }, lang, iid] = await Promise.all([searchParams, getLang(), getInstallationId()])
  const sql = getSql()
  // A saved-place chip (You → My places) scopes Home to that place; ids are only
  // honoured for places owned by this installation.
  const own = saved && iid ? (await sql`select 1 from saved_locations sl join device_installations d on d.id = sl.installation_id
    where sl.id = ${saved} and d.installation_id = ${iid}`).length > 0 : false
  const data = await getAktauNow(sql, own ? { saved_location_id: saved, installation_id: iid } : { installation_id: iid }, lang)
  const [openPlaces, incidents, news, nearby, afisha] = await Promise.all([
    data.location.area ? openPlacesNearArea(sql, data.location.area.id).catch(() => null) : null,
    listIncidents(sql, { open: true, city: true }).catch(() => []),
    listNews(sql, { scope: 'aktau', limit: 6 }).catch(() => []),
    // Who is affected is decided here, on the server, from the saved home.
    nearbyFor(sql, iid, { lang }).catch(() => ({ has_home: false, home: null, sessions: [], items: [], generated_at: new Date().toISOString() })),
    whatsOn(sql).catch(() => null),
  ])
  // Tonight in Aktau: films still showing today, the next session, the next show.
  const now = new Date()
  const today = new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10)
  const later = afisha?.films.flatMap((f) => f.cinemas.flatMap((c) => c.sessions.filter((x) => new Date(x.starts_at) > now && new Date(new Date(x.starts_at).getTime() + 5 * 3600_000).toISOString().slice(0, 10) === today)
    .map((x) => ({ title: f.title, cinema: c.name, at: x.starts_at })))).sort((a, b) => a.at.localeCompare(b.at)) ?? []
  const show = afisha?.shows.find((x) => new Date(x.next) > now) ?? null
  const goOut = afisha ? { films: new Set(later.map((x) => x.title)).size, next_film: later[0] ?? null, next_show: show ? { title: show.title, at: show.next, venue: show.venue } : null } : null
  const areaId = data.location.area?.id ?? null
  const near = incidents
    .filter((i) => i.status !== 'REJECTED')
    .sort((a, b) => Number(b.area_id === areaId) - Number(a.area_id === areaId))
    .map(lite)
  return <Screen><HomeView initial={data} openPlaces={openPlaces} savedId={own ? saved! : null} incidents={JSON.parse(JSON.stringify(near))} news={news} nearby={JSON.parse(JSON.stringify(nearby))} goOut={goOut} /></Screen>
}
