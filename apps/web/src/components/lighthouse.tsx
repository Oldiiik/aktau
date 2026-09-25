'use client'
// The hero: Aktau's real microdistricts, drawn from our own area polygons,
// with the lighthouse on the 4 mkr apartment block sweeping its beam across
// the city. Resident reports appear as sparks and fly into the incident they
// belong to — many signals, one incident. Pure canvas, no map tiles.
import { useEffect, useRef } from 'react'

type Pt = [number, number]
type Ring = Pt[]
type Area = { rings: Ring[]; label: Pt | null; d: string | null }
type Inc = { x: number; y: number; n: number; shown: number; tone: string; pulse: number }
type Spark = { x: number; y: number; tx: number; ty: number; t: number; inc: Inc; lit: number }

const TONES: Record<string, string> = { NEW: '#ffb23f', DISPUTED: '#ff6b5b', RESOLVED: '#4ed6a0', VERIFIED: '#4ed6a0' }

export function LighthouseMap({ className = '', focus = 'right' }: { className?: string; focus?: 'right' | 'center' }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let alive = true
    let visible = true
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let areas: Area[] = []
    let incidents: Inc[] = []
    let dots: Array<{ x: number; y: number; lit: number }> = []
    const sparks: Spark[] = []
    let lighthouse: Pt = [51.148, 43.648]
    let proj = (p: Pt): Pt => p
    let W = 0, H = 0, dpr = 1

    const fit = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      const r = canvas.getBoundingClientRect()
      W = r.width; H = r.height
      canvas.width = W * dpr; canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const pts = areas.flatMap((a) => a.rings.flat())
      if (!pts.length) return
      const k = Math.cos((43.65 * Math.PI) / 180)
      const xs = pts.map((p) => p[0] * k), ys = pts.map((p) => p[1])
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      const wide = W > 900
      const boxW = wide && focus === 'right' ? W * 0.58 : W * 0.96
      const boxH = H * (wide ? 0.86 : 0.7)
      const s = Math.min(boxW / (x1 - x0), boxH / (y1 - y0))
      const ox = wide && focus === 'right' ? W * 0.4 + (boxW - (x1 - x0) * s) / 2 : (W - (x1 - x0) * s) / 2
      const oy = wide ? (H - (y1 - y0) * s) / 2 : H * 0.28 + (boxH - (y1 - y0) * s) / 2
      proj = (p: Pt) => [ox + (p[0] * k - x0) * s, oy + (y1 - p[1]) * s]
    }

    const load = async () => {
      try {
        const [ag, ig] = await Promise.all([
          fetch('/api/map/areas').then((r) => r.json()),
          fetch('/api/map/incidents').then((r) => r.json()).catch(() => ({ features: [] })),
        ])
        const polys: Area[] = []
        const labels = new Map<string, Pt>()
        for (const f of ag.features) {
          if (f.properties.kind === 'label' && f.geometry) labels.set(f.properties.slug, f.geometry.coordinates)
        }
        for (const f of ag.features) {
          if (f.properties.kind !== 'outline' || !f.geometry) continue
          const g = f.geometry
          const rings: Ring[] = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p: Ring[]) => p[0]) : []
          polys.push({ rings, label: labels.get(f.properties.slug) ?? null, d: f.properties.designator })
          if (f.properties.designator === '4' && labels.get(f.properties.slug)) lighthouse = labels.get(f.properties.slug)!
        }
        areas = polys
        fit()
        const incs = ig.features.filter((f: any) => f.properties.layer === 'incident')
        incidents = incs.map((f: any) => { const [x, y] = proj(f.geometry.coordinates); return { x, y, n: f.properties.signals, shown: f.properties.signals, tone: TONES[f.properties.status] ?? '#58a6ff', pulse: 0 } })
        dots = ig.features.filter((f: any) => f.properties.layer === 'signal').map((f: any) => { const [x, y] = proj(f.geometry.coordinates); return { x, y, lit: 0 } })
        if (!incidents.length) {
          // No live incidents (fresh database): seed a few presentational ones on real districts.
          incidents = areas.filter((a) => a.label).slice(0, 6).map((a, i) => { const [x, y] = proj(a.label!); return { x, y, n: [16, 7, 3, 4, 2, 2][i]!, shown: [16, 7, 3, 4, 2, 2][i]!, tone: i === 0 ? '#58a6ff' : i === 3 ? '#ffb23f' : '#58a6ff', pulse: 0 } })
        }
      } catch { /* the hero still draws its beam */ }
    }

    let last = performance.now()
    let spawnAt = 0
    const draw = (now: number) => {
      if (!alive) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      ctx.clearRect(0, 0, W, H)
      const [lx, ly] = proj(lighthouse)
      const theta = reduce ? -0.6 : (now / 1000) * 0.42
      const spread = 0.26

      // Beam: a warm wedge from the lighthouse, fading with distance.
      const R = Math.hypot(W, H)
      const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 0.75)
      grad.addColorStop(0, 'rgba(255,199,102,0.38)')
      grad.addColorStop(0.35, 'rgba(255,150,70,0.10)')
      grad.addColorStop(1, 'rgba(255,138,61,0)')
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.arc(lx, ly, R, theta - spread, theta + spread); ctx.closePath(); ctx.fill()
      ctx.restore()

      const inBeam = (x: number, y: number) => {
        let a = Math.atan2(y - ly, x - lx) - theta
        a = Math.atan2(Math.sin(a), Math.cos(a))
        return Math.max(0, 1 - Math.abs(a) / (spread * 1.3))
      }

      // Districts.
      ctx.lineWidth = 1
      for (const a of areas) {
        const lit = a.label ? inBeam(...proj(a.label)) : 0
        ctx.strokeStyle = `rgba(67,198,201,${0.16 + lit * 0.45})`
        ctx.fillStyle = `rgba(67,198,201,${0.02 + lit * 0.06})`
        for (const ring of a.rings) {
          ctx.beginPath()
          ring.forEach((p, i) => { const [x, y] = proj(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
          ctx.closePath(); ctx.fill(); ctx.stroke()
        }
        if (a.label && a.d && W > 500) {
          const [x, y] = proj(a.label)
          ctx.fillStyle = `rgba(234,242,243,${0.12 + lit * 0.5})`
          ctx.font = '600 11px "Unbounded Variable", sans-serif'
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(a.d, x, y)
        }
      }

      // Individual reports.
      for (const d of dots) {
        d.lit = Math.max(d.lit * 0.96, inBeam(d.x, d.y))
        ctx.fillStyle = `rgba(255,178,63,${0.35 + d.lit * 0.65})`
        ctx.beginPath(); ctx.arc(d.x, d.y, 1.6 + d.lit * 1.4, 0, Math.PI * 2); ctx.fill()
      }

      // New sparks fly into their incident.
      if (!reduce && incidents.length && now > spawnAt) {
        spawnAt = now + 900 + Math.random() * 900
        const inc = incidents[Math.floor(Math.random() * Math.min(incidents.length, 5))]!
        const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 120
        sparks.push({ x: inc.x + Math.cos(a) * r, y: inc.y + Math.sin(a) * r, tx: inc.x, ty: inc.y, t: 0, inc, lit: 1 })
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!
        s.t += dt / 1.6
        const e = 1 - Math.pow(1 - Math.min(1, s.t), 3)
        const x = s.x + (s.tx - s.x) * e, y = s.y + (s.ty - s.y) * e
        ctx.strokeStyle = `rgba(255,199,102,${0.5 * (1 - e)})`
        ctx.beginPath(); ctx.moveTo(s.x + (s.tx - s.x) * Math.max(0, e - 0.18), s.y + (s.ty - s.y) * Math.max(0, e - 0.18)); ctx.lineTo(x, y); ctx.stroke()
        ctx.fillStyle = '#ffd58a'
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill()
        if (s.t >= 1) { s.inc.shown += 1; s.inc.pulse = 1; sparks.splice(i, 1) }
      }

      // Incidents: one ring per physical problem.
      for (const inc of incidents) {
        const lit = inBeam(inc.x, inc.y)
        const r = 7 + Math.sqrt(inc.shown) * 3.2
        inc.pulse = Math.max(0, inc.pulse - dt * 1.2)
        if (inc.pulse > 0) {
          ctx.strokeStyle = `rgba(255,199,102,${inc.pulse * 0.8})`
          ctx.lineWidth = 2
          ctx.beginPath(); ctx.arc(inc.x, inc.y, r + (1 - inc.pulse) * 26, 0, Math.PI * 2); ctx.stroke()
        }
        ctx.fillStyle = inc.tone
        ctx.globalAlpha = 0.18 + lit * 0.2
        ctx.beginPath(); ctx.arc(inc.x, inc.y, r + 6, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 1
        ctx.beginPath(); ctx.arc(inc.x, inc.y, r, 0, Math.PI * 2); ctx.fill()
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(6,20,28,0.9)'; ctx.stroke()
        ctx.fillStyle = '#0b1320'
        ctx.font = `700 ${r > 16 ? 12 : 10}px "Unbounded Variable", sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(inc.shown), inc.x, inc.y + 0.5)
      }

      // The lighthouse itself.
      ctx.fillStyle = '#fff4d6'
      ctx.shadowColor = 'rgba(255,199,102,0.9)'; ctx.shadowBlur = 18
      ctx.beginPath(); ctx.arc(lx, ly, 4.5, 0, Math.PI * 2); ctx.fill()
      ctx.shadowBlur = 0

      if (!reduce && visible) raf = requestAnimationFrame(draw)
    }

    const io = new IntersectionObserver(([e]) => {
      const was = visible
      visible = !!e?.isIntersecting
      if (visible && !was && !reduce) { last = performance.now(); raf = requestAnimationFrame(draw) }
    })
    io.observe(canvas)
    const onResize = () => {
      const before = proj
      fit()
      // Re-project incidents & dots from their old screen positions is lossy; reload instead.
      if (before !== proj) void load()
    }
    window.addEventListener('resize', onResize)
    fit()
    void load().then(() => { raf = requestAnimationFrame(draw) })
    return () => { alive = false; cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener('resize', onResize) }
  }, [focus])
  return <canvas ref={ref} className={className} aria-hidden />
}
