// Lada.kz — Aktau local media. A discovery source: it frequently republishes
// utility announcements ("По информации ГКП «АУЭС» …"). We read the public
// news sitemap (allowed by robots.txt), pick Aktau items that look like
// service notices, and read the NewsArticle JSON-LD on the article page.
// Politeness: ≥ 2 s between requests, at most 6 article fetches per run,
// never re-fetch an article we already stored.
import { detectAuthority } from '@aktau/source-ranking'
import { httpFetch } from './http.ts'
import type { RawSourceItem, SourceConnector } from './types.ts'

const SITEMAP = 'https://www.lada.kz/sitemap.news.xml'
// Outage-like wording only: general articles about roads or buses are not notices.
const RELEVANT_TITLE = /отключ|без (?:воды|света|тепла|газа)|подач[аиу] (?:воды|газа|тепла)|перекр|ограничен\S* движ|авари|порыв|электроснабж|водоснабж|өшір|жабыл/i
const RELEVANT_SECTION = /\/aktau_news\/(communal|incidents|society)\//

export type SitemapEntry = { url: string; title: string; published_at: Date; section: string }

export function parseNewsSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = []
  for (const m of xml.matchAll(/<url>(.*?)<\/url>/gs)) {
    const block = m[1]!
    const url = block.match(/<loc>([^<]+)<\/loc>/)?.[1]
    const title = block.match(/<news:title><!\[CDATA\[(.*?)\]\]><\/news:title>/s)?.[1] ?? block.match(/<news:title>(.*?)<\/news:title>/s)?.[1]
    const date = block.match(/<news:publication_date>([^<]+)<\/news:publication_date>/)?.[1]
    if (url && title && date) out.push({ url, title: title.trim(), published_at: new Date(date), section: url.split('/')[3] ?? '' })
  }
  return out
}

export function isServiceNotice(e: SitemapEntry): boolean {
  return e.url.includes('/aktau_news/') && RELEVANT_SECTION.test(e.url) && RELEVANT_TITLE.test(e.title)
}

type LdArticle = {
  '@type': string; headline?: string; articleBody?: string; description?: string; datePublished?: string; dateModified?: string; articleSection?: string
  image?: Array<{ url?: string; width?: number; height?: number }> | { url?: string; width?: number; height?: number } | string
  author?: { name?: string } | Array<{ name?: string }>
}

export function extractArticle(html: string): LdArticle | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try {
      const d = JSON.parse(m[1]!)
      for (const it of Array.isArray(d) ? d : d['@graph'] ?? [d]) {
        if ((it['@type'] === 'NewsArticle' || it['@type'] === 'Article') && it.articleBody) return it
      }
    } catch { /* malformed block: try the next one */ }
  }
  return null
}

export function articleId(url: string): string | null {
  return url.match(/\/(\d{5,})-/)?.[1] ?? null
}

export const lada: SourceConnector = {
  slug: 'lada',
  job: 'media',
  async fetch(ctx) {
    const sm = await httpFetch(SITEMAP, { timeoutMs: 15_000, minIntervalMs: 2000, headers: { accept: 'application/xml,text/xml' } })
    if (sm.status !== 200) return { items: [], http_status: sm.status, notes: 'sitemap unavailable' }
    const candidates = parseNewsSitemap(sm.text).filter(isServiceNotice).slice(0, 12)
    const items: RawSourceItem[] = []
    let fetched = 0
    for (const c of candidates) {
      const id = articleId(c.url)
      if (!id || (ctx.alreadyHave && (await ctx.alreadyHave(id)))) continue
      if (fetched >= 6) break
      fetched++
      const page = await httpFetch(c.url, { timeoutMs: 15_000, minIntervalMs: 2000, headers: { accept: 'text/html' } })
      if (page.status !== 200) continue
      const art = extractArticle(page.text)
      if (!art?.articleBody) continue
      items.push({
        external_id: id,
        canonical_url: c.url,
        title: art.headline ?? c.title,
        raw_text: art.articleBody,
        raw_json: { ld: art, sitemap: c },
        language: 'ru',
        published_at: art.datePublished ? new Date(art.datePublished) : c.published_at,
        source_updated_at: art.dateModified ? new Date(art.dateModified) : null,
        reported_authority: detectAuthority(art.articleBody)?.key ?? null,
        extractable: true,
      })
    }
    return { items, http_status: 200, notes: `${candidates.length} relevant in sitemap, ${fetched} fetched` }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'News sitemap + NewsArticle JSON-LD; robots.txt respected.' }
  },
}

// ── News (the News page) ────────────────────────────────────────────────────
// Every story in the same sitemap (Aktau first, then Kazakhstan and world), not only service notices. We keep the
// headline, the publisher's own summary, the lead image and a link — never the
// article body. Same politeness: ≥ 2 s between requests, a few pages per run,
// an article is fetched once.
const LOCAL_TITLE = /Актау|Ақтау|Мангист|Маңғыст|Каспи|Жанаозен|Жаңаөзен/i

export type NewsSection = 'society' | 'vlast' | 'incidents' | 'communal' | 'ecology' | 'ekonomika' | 'culture' | 'sport' | 'region' | 'kazakhstan' | 'world'
const SECTIONS: readonly string[] = ['society', 'vlast', 'incidents', 'communal', 'ecology', 'ekonomika', 'culture', 'sport']

export function newsSection(e: SitemapEntry): NewsSection | null {
  const m = e.url.match(/\/aktau_news\/([a-z_]+)\//)
  if (m) return (SECTIONS.includes(m[1]!) ? m[1] : 'region') as NewsSection
  if (LOCAL_TITLE.test(e.title)) return e.section === 'sport' ? 'sport' : 'region'
  if (e.section === 'kazakhstan-news') return 'kazakhstan'
  if (e.section === 'world-news') return 'world'
  return e.section === 'sport' ? 'sport' : null
}
const isLocal = (s: NewsSection) => s !== 'kazakhstan' && s !== 'world'

export type NewsPayload = {
  headline: string; lede: string | null; author: string | null; section: NewsSection; url: string
  image: { url: string; width: number | null; height: number | null } | null; published_at: string
}

const decode = (s: string) => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, d, h, n) =>
  d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', mdash: '—', ndash: '–', laquo: '«', raquo: '»', hellip: '…' } as Record<string, string>)[n.toLowerCase()] ?? m)

function metaContent(html: string, key: string): string | null {
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0]
    if (new RegExp(`(?:property|name)=["']${key.replace(':', '\\:')}["']`, 'i').test(tag)) {
      const c = tag.match(/content=["']([^"']*)["']/i)?.[1]
      if (c) return decode(c).trim()
    }
  }
  return null
}

/** Headline, summary and image from NewsArticle JSON-LD, falling back to Open Graph. */
export function readNewsMeta(html: string, entry: SitemapEntry, section: NewsSection): NewsPayload {
  const ld = extractArticle(html)
  const img = Array.isArray(ld?.image) ? ld!.image[0] : typeof ld?.image === 'string' ? { url: ld.image } : ld?.image
  const ogImg = metaContent(html, 'og:image')
  const imageUrl = img?.url && !/logo/i.test(img.url) ? img.url : ogImg && !/logo/i.test(ogImg) ? ogImg : null
  const author = Array.isArray(ld?.author) ? ld!.author[0]?.name : ld?.author?.name
  const lede = (ld?.description ? decode(ld.description) : metaContent(html, 'og:description'))?.replace(/\s+/g, ' ').replace(/,?\s*передает Lada\.kz[^.]*\.?$/i, '.').trim() || null
  return {
    headline: decode(ld?.headline ?? metaContent(html, 'og:title') ?? entry.title).trim(),
    lede,
    author: author?.trim() || null,
    section,
    url: entry.url,
    image: imageUrl ? { url: imageUrl, width: img?.width ?? (Number(metaContent(html, 'og:image:width')) || null), height: img?.height ?? (Number(metaContent(html, 'og:image:height')) || null) } : null,
    published_at: (ld?.datePublished ? new Date(ld.datePublished) : entry.published_at).toISOString(),
  }
}

/** Lada serves resized copies under /cache/imagine/<size>/uploads/… */
export function ladaImage(url: string, size: '1200' | '340x180' = '1200') {
  return url.replace(/^https:\/\/www\.lada\.kz\/uploads\//, `https://www.lada.kz/cache/imagine/${size}/uploads/`)
}

export const ladaNews: SourceConnector = {
  slug: 'lada_news',
  job: 'media',
  async fetch(ctx) {
    const sm = await httpFetch(SITEMAP, { timeoutMs: 15_000, minIntervalMs: 2000, headers: { accept: 'application/xml,text/xml' } })
    if (sm.status !== 200) return { items: [], http_status: sm.status, notes: 'sitemap unavailable' }
    // Aktau first, then Kazakhstan and the world, each newest first.
    const local = parseNewsSitemap(sm.text).map((e) => ({ e, section: newsSection(e) })).filter((x) => x.section)
      .sort((a, b) => Number(isLocal(b.section!)) - Number(isLocal(a.section!)) || b.e.published_at.getTime() - a.e.published_at.getTime())
    const budget = Number(process.env.NEWS_FETCH_BUDGET ?? 14)
    const items: RawSourceItem[] = []
    let fetched = 0
    for (const { e, section } of local) {
      const id = articleId(e.url)
      if (!id || (ctx.alreadyHave && (await ctx.alreadyHave(id)))) continue
      if (fetched >= budget) break
      fetched++
      const page = await httpFetch(e.url, { timeoutMs: 15_000, minIntervalMs: 2000, headers: { accept: 'text/html' } })
      if (page.status !== 200) continue
      const news = readNewsMeta(page.text, e, section!)
      items.push({
        external_id: id,
        canonical_url: e.url,
        title: news.headline,
        raw_text: news.lede ?? news.headline,
        raw_json: { news, sitemap: e },
        language: /[әғқңөұүһі]/i.test(news.headline) ? 'kk' : 'ru',
        published_at: new Date(news.published_at),
        extractable: false,
      })
    }
    return { items, http_status: 200, notes: `${local.length} stories in sitemap (${local.filter((x) => isLocal(x.section!)).length} Aktau), ${fetched} fetched` }
  },
  async healthCheck() {
    return { ok: true, mode: 'automated', detail: 'Aktau stories from the news sitemap; headline, summary and image only, linked to the publisher.' }
  },
}
