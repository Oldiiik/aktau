'use client'
// Map · City signals. Two kinds of truth on one map:
//   ◆ official notices (utility / akimat) — icon discs and affected areas
//   ● 109 incidents — a bubble per physical problem, sized by how many
//     residents reported it, with every individual report as a small dot.
// MapLibre GL with GeoJSON layers; count bubbles and microdistrict numbers are
// drawn on demand (styleimagemissing), so no glyph server is needed.
import 'maplibre-gl/dist/maplibre-gl.css'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl'
import { agoShort } from '@aktau/i18n'
import type { CityEventDTO } from '@aktau/types'
import { isStaff, useApp, useRealtime } from './app'
import { Badge, Button, Chip, CopilotTag, Icon, LinkButton } from './primitives'
import { plural } from '@/lib/plural'
import { term } from '@/lib/terms'
import { MeTooButton, Pipeline, PriorityChip, SERVICE_ICON, STATUS, SlaChip, etaLine, incidentHeading, placeText, residentsText, whereText, type IncidentLite } from './incident-ui'
import { CATEGORY_ICON, areasText, authorityName, dayWord, etaText, headline, isOngoing, relevanceText, statusBadge, trust, windowText } from '@/lib/present'
import { CheckSheet, SWIM_TONE, SwimLegend, SwimPanel, SwimSummarySheet, ZoneSheet, drawSwimPin, pinLabel, type CaspianState, type SwimCheckDTO } from './swim'

const AKTAU: [number, number] = [51.158, 43.655]
type LayerKey = 'all' | '109' | 'official' | 'swim' | 'water' | 'electricity' | 'roads' | 'places'
const FILTERS: Array<{ key: LayerKey; cats: string[] | null; icon?: Parameters<typeof Icon>[0]['name']; label: { en: string; ru: string; kk: string } }> = [
  { key: 'all', cats: null, label: { en: 'Everything', ru: 'Всё', kk: 'Барлығы' } },
  { key: '109', cats: [], icon: 'radar', label: { en: '109 incidents', ru: 'Обращения 109', kk: '109 өтініштері' } },
  { key: 'official', cats: null, icon: 'shield', label: { en: 'Official', ru: 'Официально', kk: 'Ресми' } },
  { key: 'swim', cats: [], icon: 'water', label: { en: 'Swimming', ru: 'Купание', kk: 'Шомылу' } },
  { key: 'water', cats: ['WATER', 'HOT_WATER'], icon: 'water', label: { en: 'Water', ru: 'Вода', kk: 'Су' } },
  { key: 'electricity', cats: ['ELECTRICITY'], icon: 'power', label: { en: 'Power', ru: 'Свет', kk: 'Жарық' } },
  { key: 'roads', cats: ['ROAD'], icon: 'roads', label: { en: 'Roads', ru: 'Дороги', kk: 'Жолдар' } },
  { key: 'places', cats: [], icon: 'food', label: { en: 'Places', ru: 'Места', kk: 'Орындар' } },
]
const SERVICE_FOR: Record<string, string[]> = { water: ['water', 'hot_water', 'sewer'], electricity: ['electricity', 'streetlight'], roads: ['road', 'transport'] }

function isDark() {
  return document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
}

/** OpenFreeMap vector basemap (OpenStreetMap data, no key), retinted to the
 *  Caspian palette: ink land, deep-teal sea, quiet roads. */
function baseStyleUrl(dark: boolean) {
  return `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`
}

function tint(map: MlMap, dark: boolean) {
  const set = (id: string, prop: string, v: unknown) => { if (map.getLayer(id)) try { map.setPaintProperty(id, prop, v) } catch { /* layer type differs */ } }
  if (dark) {
    set('background', 'background-color', '#081223')
    set('water', 'fill-color', '#0b2544')
    set('waterway', 'line-color', '#0b2544')
    set('landuse_residential', 'fill-color', '#0b1829')
    set('building', 'fill-color', '#0f2135')
    set('landcover_wood', 'fill-color', '#0c2226')
    set('landuse_park', 'fill-color', '#0c2226')
    set('highway_minor', 'line-color', '#132a40')
    set('highway_major_inner', 'line-color', '#18344f')
    set('highway_major_subtle', 'line-color', '#18344f')
    set('highway_motorway_inner', 'line-color', '#1e3f60')
    set('highway_motorway_subtle', 'line-color', '#1e3f60')
  } else {
    set('background', 'background-color', '#eef3f9')
    set('water', 'fill-color', '#cfe3f7')
    set('waterway', 'line-color', '#cfe3f7')
    set('building', 'fill-color', '#e3e9f0')
  }
}

const TONE = { red: '#e5534b', amber: '#e0a030', blue: '#1f8bff', grey: '#7d9199', beam: '#ffb23f', green: '#3fc493' } as const
type Tone = keyof typeof TONE
function toneFor(status: string, category: string): Tone {
  if (status === 'UNCONFIRMED') return 'grey'
  if (category === 'WEATHER') return 'blue'
  return ['ACTIVE', 'DELAYED', 'DEGRADED'].includes(status) ? 'red' : 'amber'
}
/** Severity first, then status, then whether residents verified the fix. */
function incidentTone(p: { status: string; priority?: string }): Tone {
  if (p.status === 'VERIFIED') return 'green'
  if (p.status === 'RESOLVED') return 'grey' // closed by 109, not (yet) verified by residents
  if (p.status === 'DISPUTED' || p.priority === 'CRITICAL') return 'red'
  if (p.status === 'NEW') return 'beam'
  if (p.priority === 'HIGH') return 'amber'
  return 'blue'
}
type StaffView = 'none' | 'overdue' | 'reopened' | 'impact' | 'heat'

/** Official notice: coloured disc with a white icon, rasterised once per (icon, tone). */
async function addSignalImages(map: MlMap) {
  const icons = ['water', 'power', 'roads', 'bus', 'wind', 'shield', 'calendar'] as const
  const ratio = 2
  await Promise.all(icons.map(async (name) => {
    const svg = (await (await fetch(`/icons/${name}.svg`)).text()).replace(/stroke="#[0-9A-Fa-f]{6}"/g, 'stroke="#ffffff"').replace(/fill="#[0-9A-Fa-f]{6}"/g, 'fill="#ffffff"')
    const img = new Image()
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    await img.decode()
    for (const [tone, color] of Object.entries(TONE)) {
      const size = 38 * ratio
      const c = document.createElement('canvas')
      c.width = c.height = size
      const g = c.getContext('2d')!
      // rounded square — official notices read differently from resident bubbles
      g.fillStyle = color
      g.beginPath(); g.roundRect(3, 3, size - 6, size - 6, 22); g.fill()
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 4; g.stroke()
      g.drawImage(img, size / 2 - 10 * ratio, size / 2 - 10 * ratio, 20 * ratio, 20 * ratio)
      const id = `sig-${name}-${tone}`
      if (!map.hasImage(id)) map.addImage(id, g.getImageData(0, 0, size, size), { pixelRatio: ratio })
    }
  }))
}

/** On-demand images: incident count bubbles and faint microdistrict numbers. */
function drawMissing(map: MlMap, id: string) {
  const ratio = 2
  if (id.startsWith('cnt:')) {
    const [, tone, nStr] = id.split(':')
    const n = Number(nStr)
    const r = (13 + Math.min(17, Math.sqrt(n) * 4)) * ratio
    const size = Math.ceil(r * 2 + 8 * ratio)
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')!
    const color = TONE[tone as Tone] ?? TONE.blue
    g.fillStyle = color
    g.globalAlpha = 0.22
    g.beginPath(); g.arc(size / 2, size / 2, r + 3 * ratio, 0, Math.PI * 2); g.fill()
    g.globalAlpha = 1
    g.beginPath(); g.arc(size / 2, size / 2, r, 0, Math.PI * 2); g.fill()
    g.lineWidth = 2.5 * ratio; g.strokeStyle = '#ffffff'; g.stroke()
    g.fillStyle = tone === 'red' ? '#ffffff' : '#0b1320'
    g.font = `700 ${Math.round((n > 99 ? 11 : 13) * ratio)}px "Unbounded Variable", "Manrope Variable", sans-serif`
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(String(n), size / 2, size / 2 + ratio)
    map.addImage(id, g.getImageData(0, 0, size, size), { pixelRatio: ratio })
  } else if (id.startsWith('lbl:')) {
    const [, dark, text] = id.split(':')
    const fs = 22 * ratio
    const c = document.createElement('canvas')
    const g0 = c.getContext('2d')!
    g0.font = `600 ${fs}px "Unbounded Variable", sans-serif`
    const w = Math.ceil(g0.measureText(text!).width) + 8
    c.width = w; c.height = fs + 8
    const g = c.getContext('2d')!
    g.font = `600 ${fs}px "Unbounded Variable", sans-serif`
    g.fillStyle = dark === '1' ? 'rgba(234,242,243,0.26)' : 'rgba(13,27,34,0.2)'
    g.textBaseline = 'top'
    g.fillText(text!, 4, 4)
    map.addImage(id, g.getImageData(0, 0, c.width, c.height), { pixelRatio: ratio })
  } else if (id.startsWith('swim:')) {
    drawSwimPin(map, id)
  }
}

type Place = { id: string; label: string; sublabel: string; category: string; lat: number; lon: number; opening_hours: string | null }
type Geo = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: { type: string; coordinates: any }; properties: Record<string, any> }> }

export function MapView() {
  const { lang, t, tx, me } = useApp()
  const staff = isStaff(me)
  const [staffView, setStaffView] = useState<StaffView>('none')
  const params = useSearchParams()
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  const [events, setEvents] = useState<CityEventDTO[]>([])
  const [incidents, setIncidents] = useState<IncidentLite[]>([])
  const [selected, setSelected] = useState<{ kind: 'event' | 'incident'; id: string } | null>(
    params.get('incident') ? { kind: 'incident', id: params.get('incident')! } : params.get('event') ? { kind: 'event', id: params.get('event')! } : null,
  )
  const initialLayer = (params.get('layer') ?? params.get('filter') ?? 'all') as LayerKey
  const [filter, setFilter] = useState<LayerKey>(FILTERS.some((f) => f.key === initialLayer) ? initialLayer : 'all')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ kind: string; id: string; label: string; sublabel: string; lat: number | null; lon: number | null }>>([])
  const [place, setPlace] = useState<Place | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const geoRef = useRef<Geo | null>(null)
  const incGeoRef = useRef<Geo | null>(null)
  // Caspian Safety layer
  const [caspian, setCaspian] = useState<CaspianState | null>(null)
  const [zoneSel, setZoneSel] = useState<string | null>(null)
  const [check, setCheck] = useState<{ r: SwimCheckDTO; where: 'gps' | 'map' } | null>(null)
  const [checking, setChecking] = useState(false)
  const [geoErr, setGeoErr] = useState<string | null>(null)
  const swimRef = useRef<{ on: boolean; check: (lat: number, lon: number, where: 'gps' | 'map') => void }>({ on: false, check: () => {} })

  // ── map init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false
    let halo: ReturnType<typeof setInterval> | undefined
    ;(async () => {
      const maplibregl = (await import('maplibre-gl')).default
      if (disposed || !ref.current) return
      const dark = isDark()
      const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL
      const map = new maplibregl.Map({
        container: ref.current, style: styleUrl || baseStyleUrl(dark), center: AKTAU, zoom: 12.8, minZoom: 9, maxZoom: 18,
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, maxBounds: [[50.6, 42.9], [51.8, 44.1]],
      })
      map.touchZoomRotate.disableRotation()
      mapRef.current = map;
      map.on('styleimagemissing', (e) => { try { drawMissing(map, e.id) } catch { /* ignore */ } })
      map.on('load', async () => {
        if (!styleUrl) tint(map, dark)
        await addSignalImages(map)
        const areas = await (await fetch('/api/map/areas')).json()
        map.addSource('areas', { type: 'geojson', data: areas })
        map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', filter: ['==', ['get', 'kind'], 'outline'], paint: { 'fill-color': dark ? '#58a6ff' : '#0868d9', 'fill-opacity': 0.025 } })
        map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', filter: ['==', ['get', 'kind'], 'outline'], paint: { 'line-color': dark ? '#2a4566' : '#9db5cf', 'line-width': 0.9, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } })
        map.addLayer({
          id: 'areas-num', type: 'symbol', source: 'areas', minzoom: 12.3,
          filter: ['all', ['==', ['get', 'kind'], 'label'], ['to-boolean', ['get', 'designator']]],
          layout: { 'icon-image': ['concat', `lbl:${dark ? 1 : 0}:`, ['get', 'designator']], 'icon-allow-overlap': false, 'icon-size': ['interpolate', ['linear'], ['zoom'], 12.3, 0.7, 15, 1.2] },
        })
        map.addSource('events', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        const color: any = ['match', ['get', 'tone'], 'red', TONE.red, 'blue', TONE.blue, 'grey', TONE.grey, TONE.amber]
        map.addLayer({ id: 'ev-fill', type: 'fill', source: 'events', filter: ['==', ['get', 'layer'], 'area'], paint: { 'fill-color': color, 'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.32, 0.14] } })
        map.addLayer({ id: 'ev-line', type: 'line', source: 'events', filter: ['==', ['get', 'layer'], 'area'], paint: { 'line-color': color, 'line-width': ['case', ['boolean', ['get', 'selected'], false], 2.4, 1.2] } })
        map.addLayer({ id: 'ev-bld', type: 'circle', source: 'events', filter: ['==', ['get', 'layer'], 'building'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7], 'circle-color': color, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
        map.addLayer({ id: 'ev-marker', type: 'symbol', source: 'events', filter: ['==', ['get', 'layer'], 'marker'], layout: { 'icon-image': ['get', 'img'], 'icon-allow-overlap': true, 'icon-size': ['case', ['boolean', ['get', 'selected'], false], 1.15, 0.95] } })
        // 109 layer: each resident report, then one bubble per incident.
        map.addSource('inc', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'inc-heat', type: 'heatmap', source: 'inc', filter: ['==', ['get', 'layer'], 'signal'], layout: { visibility: 'none' }, paint: { 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 18, 16, 42], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 1.6], 'heatmap-opacity': 0.75, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, 'rgba(88,166,255,0.35)', 0.5, 'rgba(240,180,90,0.6)', 0.85, 'rgba(229,83,75,0.8)', 1, 'rgba(229,83,75,0.95)'] } })
        map.addLayer({ id: 'inc-signal', type: 'circle', source: 'inc', filter: ['==', ['get', 'layer'], 'signal'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 16, 4.5], 'circle-color': TONE.beam, 'circle-opacity': 0.75, 'circle-stroke-color': dark ? '#0b1320' : '#ffffff', 'circle-stroke-width': 0.8 } })
        map.addLayer({ id: 'inc-halo', type: 'circle', source: 'inc', filter: ['all', ['==', ['get', 'layer'], 'incident'], ['to-boolean', ['get', 'urgent']]], paint: { 'circle-radius': 26, 'circle-color': TONE.red, 'circle-opacity': 0.25, 'circle-blur': 0.4 } })
        map.addLayer({ id: 'inc-bubble', type: 'symbol', source: 'inc', filter: ['==', ['get', 'layer'], 'incident'], layout: { 'icon-image': ['get', 'img'], 'icon-allow-overlap': true, 'symbol-sort-key': ['get', 'signals'], 'icon-size': ['case', ['boolean', ['get', 'selected'], false], 1.18, 1] } })
        map.addSource('places', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'places', type: 'circle', source: 'places', paint: { 'circle-radius': 6, 'circle-color': TONE.blue, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
        // Caspian Safety: unlisted shore (grey dashed), official stretches (green), prohibited (red).
        const hidden = { visibility: 'none' as const }
        const zoneColor: any = ['case', ['==', ['get', 'legal'], 'PROHIBITED'], SWIM_TONE.prohibited, ['in', ['get', 'operational'], ['literal', ['CLOSED', 'RESTRICTED']]], SWIM_TONE.restricted, SWIM_TONE.official]
        map.addSource('coast', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'coast-shore', type: 'line', source: 'coast', filter: ['==', ['get', 'layer'], 'shore'], layout: { ...hidden, 'line-cap': 'round' }, paint: { 'line-color': SWIM_TONE.shore, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 2.5], 'line-dasharray': [2, 2], 'line-opacity': 0.9 } })
        map.addLayer({ id: 'coast-halo', type: 'line', source: 'coast', filter: ['==', ['get', 'layer'], 'zone'], layout: { ...hidden, 'line-cap': 'round' }, paint: { 'line-color': zoneColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 34], 'line-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.45, 0.22], 'line-blur': 2 } })
        map.addLayer({ id: 'coast-zone', type: 'line', source: 'coast', filter: ['==', ['get', 'layer'], 'zone'], layout: { ...hidden, 'line-cap': 'round' }, paint: { 'line-color': zoneColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 8] } })
        map.addLayer({ id: 'coast-pin', type: 'symbol', source: 'coast', filter: ['==', ['get', 'layer'], 'pin'], layout: { ...hidden, 'icon-image': ['get', 'img'], 'icon-anchor': 'left', 'icon-offset': [-12, 0], 'icon-allow-overlap': false, 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 1] } })
        map.addSource('me', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 8, 'circle-color': TONE.blue, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } })
        const pickZone = (e: MapLayerMouseEvent) => { const id = e.features?.[0]?.properties?.id; if (id) { setZoneSel(id); setCheck(null) } }
        for (const l of ['coast-zone', 'coast-halo', 'coast-pin']) {
          map.on('click', l, pickZone)
          map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', l, () => { map.getCanvas().style.cursor = '' })
        }
        // Swimming layer: tapping anywhere else checks that point.
        map.on('click', (e) => {
          if (!swimRef.current.on) return
          if (map.queryRenderedFeatures(e.point, { layers: ['coast-zone', 'coast-halo', 'coast-pin'] }).length) return
          swimRef.current.check(e.lngLat.lat, e.lngLat.lng, 'map')
        })
        const pickEvent = (e: MapLayerMouseEvent) => { const id = e.features?.[0]?.properties?.event_id; if (id) { setSelected({ kind: 'event', id }); setPlace(null); setDismissed(false) } }
        const pickInc = (e: MapLayerMouseEvent) => { const id = e.features?.[0]?.properties?.id; if (id) { setSelected({ kind: 'incident', id }); setPlace(null); setDismissed(false) } }
        for (const l of ['ev-marker', 'ev-fill', 'ev-bld']) map.on('click', l, pickEvent)
        for (const l of ['inc-bubble', 'inc-signal']) map.on('click', l, pickInc)
        for (const l of ['ev-marker', 'ev-fill', 'ev-bld', 'inc-bubble', 'inc-signal', 'places']) {
          map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', l, () => { map.getCanvas().style.cursor = '' })
        }
        map.on('click', 'places', (e) => { const p = e.features?.[0]?.properties as unknown as Place | undefined; if (p) { setPlace(p); setSelected(null) } })
        // One slow breathing halo for urgent incidents (reduced motion: static).
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          let k = 0
          halo = setInterval(() => {
            k = (k + 1) % 60
            const s = Math.sin((k / 60) * Math.PI * 2)
            if (map.getLayer('inc-halo')) { map.setPaintProperty('inc-halo', 'circle-radius', 26 + s * 7); map.setPaintProperty('inc-halo', 'circle-opacity', 0.22 - s * 0.08) }
          }, 50)
        }
        setReady(true)
      })
    })()
    return () => { disposed = true; clearInterval(halo); mapRef.current?.remove(); mapRef.current = null }
  }, [])

  // ── data ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const [ev, inc] = await Promise.all([
      fetch(`/api/map/events?lang=${lang}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/map/incidents', { cache: 'no-store' }).then((r) => r.json()),
    ])
    geoRef.current = ev
    incGeoRef.current = inc
    setEvents(ev.events)
    setIncidents(inc.incidents)
  }, [lang])
  useEffect(() => { void load() }, [load])
  useRealtime(() => void load(), ['city_events', 'incidents'])

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!
  const showEvents = filter !== '109' && filter !== 'places' && filter !== 'swim'
  const showIncidents = filter === 'all' || filter === '109' || !!SERVICE_FOR[filter]
  const visibleEvents = useMemo(() => showEvents ? events.filter((e) => !active.cats || active.cats.includes(e.category)) : [], [events, active, showEvents])
  const visibleIncidents = useMemo(() => showIncidents ? incidents.filter((i) => (!SERVICE_FOR[filter] || SERVICE_FOR[filter]!.includes(i.service))
    && (staffView === 'overdue' ? i.sla.level === 'breached' : staffView === 'reopened' ? i.reopen_count > 0 || i.status === 'DISPUTED' : staffView === 'impact' ? i.priority === 'CRITICAL' || i.priority === 'HIGH' || i.residents >= 10 : true)) : [], [incidents, filter, showIncidents, staffView])
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map?.getLayer('inc-heat')) return
    map.setLayoutProperty('inc-heat', 'visibility', staffView === 'heat' ? 'visible' : 'none')
    map.setLayoutProperty('inc-signal', 'visibility', staffView === 'heat' ? 'none' : 'visible')
  }, [ready, staffView])

  const current = useMemo(() => {
    if (dismissed || filter === 'places' || filter === 'swim') return null
    if (selected?.kind === 'incident') { const i = visibleIncidents.find((x) => x.id === selected.id); if (i) return { kind: 'incident' as const, i } }
    if (selected?.kind === 'event') { const e = visibleEvents.find((x) => x.id === selected.id); if (e) return { kind: 'event' as const, e } }
    return null
  }, [visibleEvents, visibleIncidents, selected, filter, dismissed])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !geoRef.current) return
    const ids = new Set(visibleEvents.map((e) => e.id))
    const feats = geoRef.current.features.filter((f) => ids.has(f.properties.event_id)).map((f) => {
      const tone = toneFor(f.properties.status, f.properties.category)
      return { ...f, properties: { ...f.properties, tone, selected: current?.kind === 'event' && f.properties.event_id === current.e.id, img: `sig-${CATEGORY_ICON[f.properties.category as keyof typeof CATEGORY_ICON]}-${tone}` } }
    })
    ;(map.getSource('events') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats } as never)
  }, [ready, visibleEvents, current])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !incGeoRef.current) return
    const ids = new Set(visibleIncidents.map((i) => i.id))
    const feats = incGeoRef.current.features.filter((f) => ids.has(f.properties.id)).map((f) => {
      if (f.properties.layer !== 'incident') return f
      const tone = incidentTone(f.properties as { status: string; priority?: string })
      const open = !['RESOLVED', 'VERIFIED', 'REJECTED'].includes(f.properties.status)
      return { ...f, properties: { ...f.properties, img: `cnt:${tone}:${f.properties.residents ?? f.properties.signals}`, urgent: open && (f.properties.priority === 'CRITICAL' || f.properties.sla === 'breached'), selected: current?.kind === 'incident' && current.i.id === f.properties.id } }
    })
    ;(map.getSource('inc') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats } as never)
  }, [ready, visibleIncidents, current])

  // ── Caspian Safety ────────────────────────────────────────────────────────
  const swimOn = filter === 'swim'
  const runCheck = useCallback(async (lat: number, lon: number, where: 'gps' | 'map') => {
    setGeoErr(null)
    const res = await fetch(`/api/caspian/check?lat=${lat}&lon=${lon}&lang=${lang}`, { cache: 'no-store' })
    if (!res.ok) { setGeoErr(tx({ en: 'This point is outside the Aktau coast.', ru: 'Точка за пределами побережья Актау.', kk: 'Нүкте Ақтау жағалауынан тыс.' })); return }
    setCheck({ r: await res.json(), where }); setZoneSel(null)
    ;(mapRef.current?.getSource('me') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }] })
    mapRef.current?.easeTo({ center: [lon, lat], zoom: Math.max(mapRef.current.getZoom(), 13), duration: 600, padding: window.innerWidth >= 1024 ? { left: 400, right: 420, top: 0, bottom: 0 } : { top: 0, bottom: 380, left: 0, right: 0 } })
  }, [lang, tx])
  useEffect(() => { swimRef.current = { on: swimOn, check: (a, b, w) => void runCheck(a, b, w) } }, [swimOn, runCheck])
  const checkHere = () => {
    if (!('geolocation' in navigator)) { setGeoErr(tx({ en: 'Location is not available on this device.', ru: 'Геолокация недоступна на этом устройстве.', kk: 'Бұл құрылғыда геолокация жоқ.' })); return }
    setChecking(true); setGeoErr(null)
    navigator.geolocation.getCurrentPosition(
      (p) => { setChecking(false); void runCheck(p.coords.latitude, p.coords.longitude, 'gps') },
      () => { setChecking(false); setGeoErr(tx({ en: 'Could not get your location. Tap the coast on the map instead.', ru: 'Не удалось определить местоположение. Нажмите на побережье на карте.', kk: 'Орныңыз анықталмады. Картадағы жағалауды басыңыз.' })) },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    )
  }
  useEffect(() => {
    if (!swimOn) return
    fetch(`/api/caspian?lang=${lang}`, { cache: 'no-store' }).then((r) => r.json()).then(setCaspian).catch(() => {})
  }, [swimOn, lang])
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    for (const l of ['coast-shore', 'coast-halo', 'coast-zone', 'coast-pin']) map.setLayoutProperty(l, 'visibility', swimOn ? 'visible' : 'none')
    if (!swimOn) { setZoneSel(null); setCheck(null); (map.getSource('me') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] }) }
  }, [ready, swimOn])
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !caspian) return
    const feats = caspian.geojson.features.map((f) => f.properties.layer === 'shore' ? f : ({
      ...f, properties: { ...f.properties, selected: f.properties.id === zoneSel, img: `swim:${f.properties.legal}:${f.properties.operational}:${pinLabel(String(f.properties.name))}` },
    }))
    ;(map.getSource('coast') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats } as never)
  }, [ready, caspian, zoneSel])
  const zone = caspian?.zones.find((z) => z.id === zoneSel) ?? null
  // Frame the coast when the layer opens; fly to a picked zone.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !swimOn || !caspian) return
    const wide = window.innerWidth >= 1024
    if (zone?.location.lat != null) {
      map.flyTo({ center: [zone.location.lon!, zone.location.lat], zoom: 14.6, duration: 700, padding: wide ? { left: 400, right: 420, top: 0, bottom: 0 } : { top: 0, bottom: 420, left: 0, right: 0 } })
    } else if (!zoneSel && !check) {
      map.fitBounds([[51.14, 43.43], [51.33, 43.66]], { padding: wide ? { top: 90, bottom: 40, left: 420, right: 440 } : { top: 130, bottom: 380, left: 30, right: 30 }, duration: 600 })
    }
  }, [ready, swimOn, !!caspian, zoneSel]) // eslint-disable-line react-hooks/exhaustive-deps

  // First view: frame every open incident, clear of the desktop panel.
  const fitted = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || fitted.current || selected || filter === 'swim' || !incGeoRef.current) return
    const pts = incGeoRef.current.features.filter((f) => f.properties.layer === 'incident').map((f) => f.geometry.coordinates as number[])
    if (!pts.length) return
    fitted.current = true
    const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!)
    const wide = window.innerWidth >= 1024
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: wide ? { top: 130, bottom: 60, left: 440, right: 80 } : { top: 150, bottom: 200, left: 30, right: 30 }, maxZoom: 14, duration: 0 })
  }, [ready, incidents, selected])

  // Fly to the selection.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !current) return
    const pts: number[][] = []
    if (current.kind === 'incident') {
      for (const f of incGeoRef.current?.features ?? []) if (f.properties.id === current.i.id) pts.push(f.geometry.coordinates)
    } else {
      for (const f of geoRef.current?.features ?? []) {
        if (f.properties.event_id !== current.e.id) continue
        const walk = (c: any) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk))
        walk(f.geometry.coordinates)
      }
    }
    if (!pts.length) return
    const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!)
    const wide = window.innerWidth >= 1024
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: wide ? { top: 120, bottom: 120, left: 460, right: 120 } : { top: 170, bottom: 420, left: 40, right: 40 }, maxZoom: 15.4, duration: 700 })
  }, [ready, current?.kind === 'incident' ? current.i.id : current?.kind === 'event' ? current.e.id : null]) // eslint-disable-line react-hooks/exhaustive-deps

  // Places layer.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (filter !== 'places') { (map.getSource('places') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] }); return }
    Promise.all(['food', 'pharmacy'].map((c) => fetch(`/api/places/search?q=&category=${c}&lat=${AKTAU[1]}&lon=${AKTAU[0]}`).then((r) => r.json()))).then(([a, b]) => {
      const all = [...a.results, ...b.results].filter((p: Place & { kind: string }) => p.kind === 'place')
      ;(map.getSource('places') as GeoJSONSource).setData({ type: 'FeatureCollection', features: all.map((p: Place) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: p })) })
    })
  }, [ready, filter])

  // Search: local index first (districts / buildings), then cached places.
  useEffect(() => {
    if (q.trim().length < 1) { setResults([]); return }
    const ctl = new AbortController()
    const id = setTimeout(() => fetch(`/api/places/search?q=${encodeURIComponent(q)}&lat=${AKTAU[1]}&lon=${AKTAU[0]}&geocode=1`, { signal: ctl.signal }).then((r) => r.json()).then((d) => setResults(d.results.slice(0, 7))).catch(() => {}), 200)
    return () => { clearTimeout(id); ctl.abort() }
  }, [q])

  const openInc = visibleIncidents.filter((i) => !['VERIFIED', 'REJECTED'].includes(i.status))
  const reports = visibleIncidents.reduce((s, i) => s + i.residents, 0)
  const listItems = useMemo(() => [
    ...visibleIncidents.map((i) => ({ kind: 'incident' as const, i, rank: (i.priority === 'CRITICAL' ? 100 : i.priority === 'HIGH' ? 40 : 0) + (i.sla.level === 'breached' ? 50 : 0) + i.residents })),
    ...visibleEvents.map((e) => ({ kind: 'event' as const, e, rank: (isOngoing(e) ? 60 : 20) + ({ DIRECT: 30, AREA: 20, NEARBY: 10, NO: 0 }[e.relevance ?? 'NO']) })),
  ].sort((a, b) => b.rank - a.rank), [visibleIncidents, visibleEvents])

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-sea">
      <div className="absolute inset-0 lg:bottom-0"><div ref={ref} className="h-full w-full" aria-label="Map of Aktau" /></div>

      {/* Top: search + layers */}
      <div className="pointer-events-none absolute inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-10 flex flex-col gap-2.5 lg:left-[392px] lg:right-5 lg:top-5">
        <div className="pointer-events-auto relative lg:max-w-[460px]">
          <label className="glass flex h-[52px] items-center gap-3 rounded-[18px] px-4 card-shadow">
            <Icon name="search" size={20} className="text-secondary" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ask.map.search')} className="h-full flex-1 bg-transparent t-body text-text outline-none placeholder:text-secondary" />
            <Link href="/report" className="tap -mr-1.5 grid size-9 place-items-center rounded-[12px] beam-fill lg:hidden" aria-label="Report"><Icon name="report" size={17} className="text-on-blue" /></Link>
          </label>
          {results.length ? (
            <div className="absolute inset-x-0 top-[58px] flex flex-col overflow-hidden rounded-[18px] bg-surface card-shadow">
              {results.map((r) => (
                <button key={`${r.kind}-${r.id}`} type="button" className="tap flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2"
                  onClick={() => {
                    setQ(''); setResults([])
                    if (r.kind === 'place') { router.push(`/place/${r.id}`); return }
                    if (r.lat != null && r.lon != null) mapRef.current?.flyTo({ center: [r.lon, r.lat], zoom: r.kind === 'building' ? 17 : 15, duration: 700 })
                  }}>
                  <Icon name={r.kind === 'place' ? 'food' : r.kind === 'building' ? 'home' : 'pin'} size={18} className="text-blue" />
                  <span className="flex min-w-0 flex-col"><span className="t-row truncate text-text">{r.label}</span><span className="t-meta truncate text-secondary">{r.sublabel}</span></span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="pointer-events-auto no-scrollbar -mx-3 flex items-center gap-1.5 overflow-x-auto px-3 pb-1 lg:mx-0 lg:px-0">
          {FILTERS.map((f) => (
            <Chip key={f.key} active={filter === f.key} icon={f.icon} onClick={() => { setFilter(f.key); setSelected(null); setPlace(null) }}>{tx(f.label)}</Chip>
          ))}
        </div>
        {staff && showIncidents ? (
          <div className="pointer-events-auto no-scrollbar -mx-3 flex items-center gap-1.5 overflow-x-auto px-3 pb-1 lg:mx-0 lg:px-0" aria-label={tx({ en: '109 staff views', ru: 'Виды для 109', kk: '109 көріністері' })}>
            <span className="glass flex-none rounded-full px-2.5 py-1.5 t-label !text-[11px] text-secondary card-shadow">109</span>
            {([['overdue', { en: 'Overdue', ru: 'Просрочено', kk: 'Кешіккен' }], ['reopened', { en: 'Reopened', ru: 'Повторно открыто', kk: 'Қайта ашылған' }], ['impact', { en: 'High impact', ru: 'Высокое влияние', kk: 'Үлкен әсер' }], ['heat', { en: 'Heatmap', ru: 'Тепловая карта', kk: 'Жылу картасы' }]] as const).map(([k, l]) => (
              <Chip key={k} active={staffView === k} onClick={() => { setStaffView(staffView === k ? 'none' : k); setSelected(null) }}>{tx(l)}</Chip>
            ))}
          </div>
        ) : null}
      </div>

      {/* Desktop: list panel */}
      <aside className="absolute bottom-5 left-5 top-5 z-10 hidden w-[360px] flex-col overflow-hidden rounded-[26px] bg-surface card-shadow lg:flex">
        <div className="flex flex-col gap-3 border-b border-line p-5">
          {swimOn ? (<>
            <h1 className="t-headline text-text">{tx({ en: 'Where to swim', ru: 'Где купаться', kk: 'Қайда шомылуға болады' })}</h1>
            <SwimLegend />
          </>) : <>
          <div className="flex items-center justify-between"><h1 className="t-headline text-text">{tx({ en: 'Aktau right now', ru: 'Актау сейчас', kk: 'Ақтау қазір' })}</h1><Legend /></div>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat v={openInc.length} l={tx({ en: 'open incidents', ru: 'открытых', kk: 'ашық' })} />
            <MiniStat v={reports} l={tx({ en: 'resident signals', ru: 'сигналов жителей', kk: 'тұрғын сигналы' })} beam />
            <MiniStat v={visibleEvents.length} l={tx({ en: 'official notices', ru: 'уведомлений', kk: 'хабарлама' })} />
          </div>
          </>}
        </div>
        <div className="no-scrollbar flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {swimOn ? <SwimPanel state={caspian} selected={zoneSel} onPick={(id) => { setZoneSel(id); setCheck(null) }} /> : null}
          {swimOn ? null : listItems.map((x) => x.kind === 'incident' ? (
            <button key={x.i.id} type="button" onClick={() => { setSelected({ kind: 'incident', id: x.i.id }); setDismissed(false) }}
              className={`tap flex items-center gap-3 rounded-[16px] p-3 text-left ${current?.kind === 'incident' && current.i.id === x.i.id ? 'bg-surface-2 hairline' : 'hover:bg-surface-2'}`}>
              <span className="grid size-10 flex-none place-items-center rounded-full text-[#0b1320]" style={{ background: TONE[incidentTone(x.i)], color: incidentTone(x.i) === 'red' ? '#fff' : undefined }}><span className="t-num text-[13px] font-bold">{x.i.residents}</span></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="t-row truncate text-text">{incidentHeading(lang, x.i)}</span>
                <span className="t-meta truncate text-secondary">{placeText(lang, x.i)} · {tx(STATUS[x.i.status]?.label ?? STATUS.NEW!.label)}</span>
              </span>
              {x.i.sla.level === 'breached' || x.i.priority === 'CRITICAL' ? <span className="size-2 flex-none rounded-full bg-red" /> : null}
            </button>
          ) : (
            <button key={x.e.id} type="button" onClick={() => { setSelected({ kind: 'event', id: x.e.id }); setDismissed(false) }}
              className={`tap flex items-center gap-3 rounded-[16px] p-3 text-left ${current?.kind === 'event' && current.e.id === x.e.id ? 'bg-surface-2 hairline' : 'hover:bg-surface-2'}`}>
              <span className={`grid size-10 flex-none place-items-center rounded-[12px] ${isOngoing(x.e) ? 'bg-red text-bg' : 'bg-amber text-bg'}`}><Icon name={CATEGORY_ICON[x.e.category]} size={18} /></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="t-row truncate text-text">{headline(lang, x.e).head}</span>
                <span className="t-meta truncate text-secondary">{areasText(lang, x.e)} · {authorityName(x.e)}</span>
              </span>
            </button>
          ))}
          {!listItems.length && !swimOn ? <p className="p-4 t-sub text-secondary">{t('now.calm.city')}</p> : null}
        </div>
      </aside>

      {/* Sheet */}
      <div className="absolute inset-x-0 bottom-[88px] z-10 px-2 lg:bottom-5 lg:left-auto lg:right-5 lg:w-[400px] lg:px-0">
        {swimOn ? (
          zone ? <ZoneSheet z={zone} c={caspian!.conditions} onClose={() => setZoneSel(null)} />
            : check && caspian ? <CheckSheet r={check.r} c={caspian.conditions} where={check.where} onClose={() => { setCheck(null); (mapRef.current?.getSource('me') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] }) }} onPick={(id) => { setZoneSel(id); setCheck(null) }} />
            : <SwimSummarySheet state={caspian} onCheck={checkHere} checking={checking} error={geoErr} onPick={(id) => { setZoneSel(id); setCheck(null) }} />
        ) : place ? <PlaceSheet p={place} onClose={() => setPlace(null)} />
          : current?.kind === 'incident' ? <IncidentSheet i={current.i} onClose={() => setDismissed(true)} />
          : current?.kind === 'event' ? <EventSheet e={current.e} onClose={() => setDismissed(true)} />
          : filter !== 'places' ? <SummarySheet incidents={openInc.length} reports={reports} notices={visibleEvents.length} onPick={() => { const top = listItems[0]; if (top) setSelected(top.kind === 'incident' ? { kind: 'incident', id: top.i.id } : { kind: 'event', id: top.e.id }); setDismissed(false) }} /> : null}
      </div>
    </div>
  )
}

function MiniStat({ v, l, beam }: { v: number; l: string; beam?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-surface-2 p-2.5 hairline">
      <span className={`t-num text-[22px] font-semibold leading-none ${beam ? 'beam-text' : 'text-text'}`}>{v}</span>
      <span className="t-meta leading-tight text-secondary">{l}</span>
    </div>
  )
}

function Legend() {
  const { tx } = useApp()
  return (
    <details className="relative">
      <summary className="tap grid size-8 cursor-pointer list-none place-items-center rounded-full bg-surface-2 text-secondary hairline" aria-label="Legend"><Icon name="layers" size={16} /></summary>
      <div className="absolute right-0 top-10 z-20 flex w-64 flex-col gap-2.5 rounded-[18px] bg-surface p-4 card-shadow">
        <p className="flex items-center gap-2.5 t-meta text-text"><span className="size-2.5 rounded-full" style={{ background: TONE.beam }} />{tx({ en: 'One resident report', ru: 'Одно обращение жителя', kk: 'Тұрғынның бір өтініші' })}</p>
        <p className="flex items-center gap-2.5 t-meta text-text"><span className="grid size-5 place-items-center rounded-full text-[9px] font-bold text-ink" style={{ background: TONE.blue }}>16</span>{tx({ en: 'One incident · residents who reported or confirmed', ru: 'Один инцидент · сколько жителей сообщили или подтвердили', kk: 'Бір оқиға · тұрғындар саны' })}</p>
        <p className="flex items-center gap-2.5 t-meta text-text"><span className="size-5 rounded-[6px]" style={{ background: TONE.amber }} />{tx({ en: 'Official notice (utility / akimat)', ru: 'Официальное уведомление', kk: 'Ресми хабарлама' })}</p>
        <p className="flex items-center gap-2.5 t-meta text-text"><span className="size-5 rounded-full" style={{ background: TONE.beam }} />{tx({ en: 'Being confirmed by residents', ru: 'Подтверждается жителями', kk: 'Тұрғындар растауда' })}</p>
        <p className="flex items-center gap-2.5 t-meta text-text"><span className="size-5 rounded-full" style={{ background: TONE.amber }} />{tx({ en: 'High priority', ru: 'Высокий приоритет', kk: 'Жоғары басымдық' })}</p>
        <p className="flex items-center gap-2.5 t-meta text-text"><span className="size-5 rounded-full" style={{ background: TONE.red }} />{tx({ en: 'Critical, reopened or overdue', ru: 'Критично, снова открыто или просрочено', kk: 'Сыни, қайта ашылған не кешіккен' })}</p>
        <p className="flex items-center gap-2.5 t-meta text-text"><span className="size-5 rounded-full" style={{ background: TONE.green }} />{tx({ en: 'Fixed · verified by residents', ru: 'Решено · подтверждено жителями', kk: 'Шешілді · тұрғындар растады' })}</p>
        <p className="flex items-center gap-2.5 t-meta text-text"><span className="size-5 rounded-full" style={{ background: TONE.grey }} />{tx({ en: 'Closed, not verified yet', ru: 'Закрыто, ещё не проверено', kk: 'Жабылды, әлі тексерілмеген' })}</p>
      </div>
    </details>
  )
}

function SheetFrame({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="sheet-in relative mx-auto flex max-w-[520px] flex-col gap-3 rounded-[28px] bg-surface px-5 pb-4 pt-3 card-shadow lg:max-w-none">
      <div className="mx-auto h-1 w-9 rounded-full bg-border lg:hidden" />
      {onClose ? <button type="button" onClick={onClose} aria-label="Close" className="tap absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-surface-2 text-secondary hairline"><Icon name="x" size={15} /></button> : null}
      {children}
    </div>
  )
}

function SummarySheet({ incidents, reports, notices, onPick }: { incidents: number; reports: number; notices: number; onPick: () => void }) {
  const { lang, tx } = useApp()
  return (
    <div className="lg:hidden">
      <SheetFrame>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="t-label text-faint">{tx({ en: 'Aktau right now', ru: 'Актау сейчас', kk: 'Ақтау қазір' })}</span>
            <span className="t-card text-text">{lang === 'en' ? `${incidents} incidents · ${reports} resident signals · ${notices} notices`
              : lang === 'kk' ? `${incidents} оқиға · ${reports} тұрғын сигналы · ${notices} хабарлама`
              : `${incidents} ${plural('ru', incidents, { en: ['', ''], ru: ['инцидент', 'инцидента', 'инцидентов'], kk: '' })} · ${reports} ${plural('ru', reports, { en: ['', ''], ru: ['сигнал жителей', 'сигнала жителей', 'сигналов жителей'], kk: '' })} · ${notices} уведомл.`}</span>
          </div>
          <Legend />
        </div>
        <Button style="secondary" onClick={onPick}>{tx({ en: 'Show the most urgent', ru: 'Показать самое срочное', kk: 'Ең шұғылын көрсету' })}</Button>
      </SheetFrame>
    </div>
  )
}

function IncidentSheet({ i, onClose }: { i: IncidentLite; onClose: () => void }) {
  const { lang, tx } = useApp()
  const st = STATUS[i.status] ?? STATUS.NEW!
  const open = !['RESOLVED', 'VERIFIED', 'REJECTED', 'EVIDENCE_SUBMITTED'].includes(i.status)
  const eta = ['ROUTED', 'ACCEPTED', 'IN_PROGRESS'].includes(i.status) ? etaLine(lang, i.commit_finish_at) : null
  return (
    <SheetFrame key={i.id} onClose={onClose}>
      <div className="flex items-center gap-2 pr-9">
        <CopilotTag>109</CopilotTag>
        <span className="t-mono text-[12px] font-semibold text-faint">{i.code}</span>
        {i.is_demo ? <Badge tone="demo" className="!h-5 !px-1.5 !text-[9.5px]">DEMO</Badge> : null}
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid size-11 flex-none place-items-center rounded-[14px] ${i.priority === 'CRITICAL' ? 'bg-red text-bg' : 'bg-surface-2 text-text hairline'}`}><Icon name={SERVICE_ICON[i.service]} size={21} /></span>
          <div className="flex min-w-0 flex-col">
            <h2 className="t-headline text-text">{incidentHeading(lang, i)}</h2>
            <p className="t-sub text-secondary">{whereText(lang, i)}</p>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="t-num text-[34px] font-semibold leading-none text-text">{i.residents}</span>
          <span className="t-meta text-faint">{tx({ en: 'residents', ru: 'жителей', kk: 'тұрғын' })}</span>
        </div>
      </div>
      <Pipeline status={i.status} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone} dot>{tx(st.label)}</Badge>
        <PriorityChip level={i.priority} />
        <SlaChip sla={i.sla} />
        {i.team || i.responsible_org ? <span className="t-meta text-secondary">→ {i.team ?? term(lang, i.responsible_org ?? '')}</span> : null}
      </div>
      {eta ? <p className="t-sub text-text" suppressHydrationWarning>{eta}</p> : <p className="t-meta text-secondary">{residentsText(lang, i.residents)}</p>}
      <div className={`grid gap-2.5 ${open ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {open ? <MeTooButton incident={i} /> : null}
        <LinkButton href={`/incident/${i.code}`} style="secondary">{tx({ en: 'Details', ru: 'Подробнее', kk: 'Толығырақ' })}</LinkButton>
      </div>
    </SheetFrame>
  )
}

function EventSheet({ e, onClose }: { e: CityEventDTO; onClose: () => void }) {
  const { lang, t } = useApp()
  const b = statusBadge(lang, e)
  const h = headline(lang, e)
  const tr = trust(lang, e)
  const rel = relevanceText(lang, e)
  const home = e.relevance === 'DIRECT' ? `${rel} · ${areasText(lang, e, { houses: e.building_count > 0 && e.building_count <= 6 })}` : rel
  return (
    <SheetFrame key={e.id} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-1.5 pr-9"><Badge tone={b.tone} dot>{b.label}</Badge><Badge tone={tr.tone}>{tr.label}</Badge>{e.is_demo ? <Badge tone="demo">{t('badge.demo')}</Badge> : null}</div>
      <h2 className="t-headline text-text">{h.head}</h2>
      <p className="t-card text-text" suppressHydrationWarning>{isOngoing(e) ? etaText(lang, e) : [dayWord(lang, e.starts_at), windowText(lang, e)].filter(Boolean).join(' · ')}</p>
      <p className="t-sub text-secondary">{areasText(lang, e)}{home ? ` · ${home}` : ''}</p>
      <p className="flex items-center gap-1.5 t-meta text-secondary" suppressHydrationWarning><Icon name="shield" size={14} className="text-blue" />{authorityName(e)} · {tr.kind} · {t('updated', { ago: agoShort(lang, e.last_confirmed_at) })}</p>
      <div className="grid grid-cols-2 gap-2.5">
        <LinkButton href={`/event/${e.id}`} style="secondary">{t('action.details')}</LinkButton>
        <LinkButton href={`/event/${e.id}#notify`}>{t('action.notifyMe')}</LinkButton>
      </div>
    </SheetFrame>
  )
}

function PlaceSheet({ p, onClose }: { p: Place; onClose: () => void }) {
  const { tx } = useApp()
  return (
    <SheetFrame onClose={onClose}>
      <h2 className="t-headline pr-9 text-text">{p.label}</h2>
      <p className="t-sub text-secondary">{p.sublabel}{p.opening_hours ? ` · ${p.opening_hours}` : ''}</p>
      <LinkButton href={`/place/${p.id}`}>{tx({ en: 'Open', ru: 'Открыть', kk: 'Ашу' })}</LinkButton>
    </SheetFrame>
  )
}
