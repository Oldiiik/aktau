'use client'
// Place detail (Figma: 06 Place · Shora). OSM gives name, category, address
// and opening hours — no photos or ratings — so the header is a live map of
// the location instead of invented imagery.
import 'maplibre-gl/dist/maplibre-gl.css'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useApp } from './app'
import { Beacon, Button, Card, Icon } from './primitives'

export type PlaceDTO = { id: string; name: string; category: string; address: string | null; opening_hours: string | null; phone: string | null; website: string | null; lat: number; lon: number; area_name: string | null; source: string; open_now: boolean | null; rating: number | null; review_count: number | null }

export function PlaceView({ p }: { p: PlaceDTO }) {
  const { t } = useApp()
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let map: import('maplibre-gl').Map | null = null
    ;(async () => {
      const ml = (await import('maplibre-gl')).default
      if (!ref.current) return
      map = new ml.Map({
        container: ref.current, center: [p.lon, p.lat], zoom: 16, interactive: false, attributionControl: { compact: true },
        style: process.env.NEXT_PUBLIC_MAP_STYLE_URL || { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.3 } }] },
      })
      new ml.Marker({ color: '#0868d9' }).setLngLat([p.lon, p.lat]).addTo(map)
    })()
    return () => map?.remove()
  }, [p.lat, p.lon])
  const directions = `https://2gis.kz/aktau/directions/points/%7C${p.lon}%2C${p.lat}`
  return (
    <div className="flex flex-col">
      <div className="relative h-[314px] w-full overflow-hidden bg-sea">
        <div ref={ref} className="absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-[110px] bg-gradient-to-t from-ink/60 to-transparent" />
        <div className="absolute inset-x-6 bottom-5 flex flex-col gap-1 text-white">
          <h1 className="text-[32px] font-bold leading-[1.4] tracking-[-0.03em]">{p.name}</h1>
          <p className="t-sub">{[p.rating ? `★ ${p.rating}` : null, p.review_count ? `${p.review_count} reviews` : null, p.category].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" onClick={() => router.back()} aria-label="Back" className="tap absolute left-6 top-[max(20px,env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-surface text-blue shadow-[var(--shadow)]">
          <Icon name="back" size={20} />
        </button>
      </div>
      <div className="flex flex-col gap-4 px-6 pb-28 pt-[18px]">
        <div className="grid grid-cols-2 gap-3">
          <a href={directions} target="_blank" rel="noreferrer" className="tap inline-flex h-[52px] items-center justify-center rounded-[16px] bg-blue text-[15px] font-bold text-white">{t('action.directions')}</a>
          <Button style="secondary" disabled={saved} onClick={async () => {
            await fetch('/api/me/locations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: p.name.slice(0, 60), type: 'CUSTOM', lat: p.lat, lon: p.lon }) })
            setSaved(true)
          }}>{saved ? '✓' : t('action.savePlace')}</Button>
        </div>
        <Card padding={16} className="gap-3">
          {p.open_now !== null ? (
            <div className="flex h-[22px] items-center gap-2">
              <Beacon tone={p.open_now ? 'green' : 'secondary'} />
              <span className={`text-[13px] font-semibold leading-[1.4] ${p.open_now ? 'text-green' : 'text-secondary'}`}>{p.open_now ? 'Open now' : 'Closed now'} · {p.opening_hours}</span>
            </div>
          ) : p.opening_hours ? <p className="t-sub text-secondary">Hours: {p.opening_hours}</p> : <p className="t-sub text-secondary">Opening hours not listed</p>}
          <div className="flex min-h-[46px] items-center gap-3">
            <Icon name="pin" size={20} className="text-secondary" />
            <div className="flex flex-col gap-0.5">
              <span className="t-row text-text">{[p.area_name, 'Aktau'].filter(Boolean).join(', ')}</span>
              <span className="t-meta text-secondary">{p.address ?? '-'}</span>
            </div>
          </div>
          {p.phone ? <a href={`tel:${p.phone}`} className="t-sub text-blue">{p.phone}</a> : null}
          {p.website ? <a href={p.website} target="_blank" rel="noreferrer" className="t-sub text-blue truncate">{p.website}</a> : null}
        </Card>
        <p className="text-[10px] font-medium leading-[1.4] text-secondary">Place data © OpenStreetMap contributors · {p.source}</p>
        <Link href="/map?layer=places" className="t-sub text-blue">More places on the map</Link>
      </div>
    </div>
  )
}
