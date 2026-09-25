"""Builds every logo / app-icon file from design/logo-source.webp (the Aktau logo).

  python3 scripts/brand-assets.py

The source is a blue disc on white. In the app the disc is used as is (transparent
corners). App icons must be full-bleed squares (the OS rounds the corners), so the
disc's own blue gradient is fitted and extended to the square: the disc edge
disappears and the artwork stays exactly as drawn. Needs only Pillow.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'design/logo-source.webp'
WEB = ROOT / 'apps/web/public/images'
IOS = ROOT / 'apps/ios/AktauApp/Assets.xcassets'

im = Image.open(SRC).convert('RGB')
px = im.load()
x0, y0, x1, y1 = Image.eval(im.convert('L'), lambda v: 255 if v < 235 else 0).getbbox()
cx, cy, r = (x0 + x1) / 2, (y0 + y1) / 2, ((x1 - x0) + (y1 - y0)) / 4


def fit_gradient():
    """Least-squares plane c = a + b*x + d*y per channel over plain-blue disc pixels."""
    n = sx = sy = sxx = syy = sxy = 0.0
    sc = [[0.0, 0.0, 0.0] for _ in range(3)]  # per channel: sum c, sum c*x, sum c*y
    for y in range(int(cy - r), int(cy + r), 3):
        for x in range(int(cx - r), int(cx + r), 3):
            if (x - cx) ** 2 + (y - cy) ** 2 > (r - 6) ** 2:
                continue
            p = px[x, y]
            if p[0] > 110 or p[2] < 230:  # skip the white artwork and its soft beams
                continue
            u, v = (x - cx) / r, (y - cy) / r
            n += 1; sx += u; sy += v; sxx += u * u; syy += v * v; sxy += u * v
            for c in range(3):
                sc[c][0] += p[c]; sc[c][1] += p[c] * u; sc[c][2] += p[c] * v
    A = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]]

    def solve(b):  # 3x3 Cramer
        def det(m):
            return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))
        D = det(A)
        out = []
        for i in range(3):
            m = [row[:] for row in A]
            for k in range(3):
                m[k][i] = b[k]
            out.append(det(m) / D)
        return out
    return [solve(sc[c]) for c in range(3)]


COEF = fit_gradient()


def gradient(size: int) -> Image.Image:
    """The disc's blue, extended over a square that exactly covers the disc."""
    g = Image.new('RGB', (size, size))
    gp = g.load()
    for y in range(size):
        v = (y + 0.5) / size * 2 - 1
        for x in range(size):
            u = (x + 0.5) / size * 2 - 1
            gp[x, y] = tuple(max(0, min(255, round(a + b * u + d * v))) for a, b, d in COEF)
    return g


def disc_mask(size: int, inset: float) -> Image.Image:
    """Anti-aliased circle (4x supersampled), inset in source pixels to drop the white fringe."""
    s = size * 4
    m = Image.new('L', (s, s), 0)
    k = inset / (2 * r) * s
    ImageDraw.Draw(m).ellipse((k, k, s - k, s - k), fill=255)
    return m.resize((size, size), Image.LANCZOS)


disc = im.crop((round(cx - r), round(cy - r), round(cx + r), round(cy + r)))


def mark(size: int) -> Image.Image:
    """The logo as drawn: the disc with transparent corners."""
    out = disc.resize((size, size), Image.LANCZOS).convert('RGBA')
    out.putalpha(disc_mask(size, 1.5))
    return out


def feather(size: int, start: float = 0.90, end: float = 0.985) -> Image.Image:
    """Radial fade: opaque inside start*r, transparent from end*r. The artwork ends at ~0.88 r,
    so only plain blue is blended, and the disc's slight edge shading melts into the square."""
    m = Image.new('L', (size, size))
    mp = m.load()
    half = size / 2
    for y in range(size):
        for x in range(size):
            d = (((x + 0.5 - half) ** 2 + (y + 0.5 - half) ** 2) ** 0.5) / half
            t = (end - d) / (end - start)
            mp[x, y] = 255 if t >= 1 else 0 if t <= 0 else round(255 * t * t * (3 - 2 * t))
    return m


def icon(size: int, art_scale: float = 1.0) -> Image.Image:
    """Full-bleed square icon. art_scale < 1 shrinks the disc (maskable safe zone)."""
    bg = gradient(size)
    inner = max(1, round(size * art_scale))
    d = disc.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    bg.paste(d, (off, off), feather(inner))
    return bg


WEB.mkdir(parents=True, exist_ok=True)
mark(256).save(WEB / 'logo-mark.png', optimize=True)
mark(64).save(WEB / 'logo-mark-64.png', optimize=True)
big = icon(1024)
for s in (180, 192, 512):
    big.resize((s, s), Image.LANCZOS).save(WEB / f'app-icon-{s}.png', optimize=True)
# Android maskable: everything important within the central 80% circle.
icon(512, art_scale=0.84).save(WEB / 'app-icon-maskable-512.png', optimize=True)

appicon = IOS / 'AppIcon.appiconset'
appicon.mkdir(parents=True, exist_ok=True)
big.save(appicon / 'icon-1024.png', optimize=True)
(appicon / 'Contents.json').write_text(json.dumps({
    'images': [{'filename': 'icon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
    'info': {'author': 'xcode', 'version': 1},
}, indent=2) + '\n')
(IOS / 'Contents.json').write_text(json.dumps({'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
print(f'disc centre ({cx:.0f}, {cy:.0f}) r={r:.0f} · gradient fit {[[round(c, 1) for c in ch] for ch in COEF]}')
