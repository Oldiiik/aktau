import { notFound } from 'next/navigation'
import { getSql, isOpenNow } from '@aktau/server'
import { Screen } from '@/components/app'
import { PlaceView, type PlaceDTO } from '@/components/place'

export const dynamic = 'force-dynamic'

export default async function PlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const [p] = await getSql()<Omit<PlaceDTO, 'open_now'>[]>`
    select p.id, p.name, p.category, p.address, p.opening_hours, p.phone, p.website, p.rating, p.review_count,
      ST_Y(p.point::geometry) lat, ST_X(p.point::geometry) lon, a.name area_name, s.name source
    from places p join sources s on s.id = p.source_id left join areas a on a.id = p.area_id where p.id = ${id}`
  if (!p) notFound()
  return <Screen bare><PlaceView p={{ ...p, open_now: isOpenNow(p.opening_hours, new Date()) }} /></Screen>
}
