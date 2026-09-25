// Afisha: the four listings' parsers on small pages shaped like the real ones,
// then the whole path (connector → source_items → cinema_sessions /
// afisha_events → whatsOn) on real PostgreSQL with the network stubbed.
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  aktauTime, categoryOf, jsonLd, parseInaktauEvent, parseKinoafishaCinemas, parseKinoafishaSchedule, parseSxodimEvent, parseTopbiletEvent,
} from '@aktau/connectors'
import { createSql, lifecycleSweep, runSource, sameShow, whatsOn, withoutCity, type Sql } from '@aktau/server'
import { migrate } from '../packages/server/src/db/migrate.ts'

// Every page the connectors ask for; anything else is a 404.
const web = vi.hoisted(() => ({ pages: new Map<string, string>() }))
vi.mock('../packages/connectors/src/http.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../packages/connectors/src/http.ts')>()
  return { ...real, httpFetch: async (url: string) => ({ status: web.pages.has(url) ? 200 : 404, text: web.pages.get(url) ?? '', headers: {}, url, ms: 1 }) }
})

// ── Pages shaped like the publishers' markup ────────────────────────────────
const KA = 'https://kz.kinoafisha.info'
const CINEMAS = `
  <div class="cinemaList_item"><a href="${KA}/aktau/cinema/101/" class="cinemaList_name">Kinoplexx Aktau</a>
    <div class="cinemaList_addr">14-й мкр., ТРЦ &laquo;Aktau Mall&raquo;</div></div>
  <div class="cinemaList_item"><a href="${KA}/aktau/cinema/102/" class="cinemaList_name">Kinopark Aktau</a></div>
  <a href="${KA}/aktau/cinema/101/" class="cinemaList_name">Kinoplexx Aktau</a>`
const session = (t: string, price?: string) => `<span class="session_time">${t}</span>${price ? ` <span class="session_price">${price}</span>` : ''}`
const film = (id: string, title: string, format: string, sessions: string, extra = '') => `
  <div class="showtimes_item">${extra}
    <a class="showtimesMovie_name" href="${KA}/movies/${id}/">${title}</a>
    <div class="showtimes_formatGroup" data-format="${format}">${sessions}</div>
  </div>`
const schedule = (films: string) => `<html>
  <article class="showtimesListItem_item active" data-schedule-date="2026-09-25">
    <script>var tpl = '${film('7', 'Шаблон', '2D', session('10:00'))}'</script>${films}
    <div class="showtimes_item"><a class="showtimesMovie_name" href="${KA}/movies/9/">Без сеансов</a></div>
  </article></html>`
const PIRATES_EXTRA = `<img class="picture_image" alt="" src="https://img.test/pirates.jpg">
  <span class="showtimesMovie_categories">мультфильм, приключения</span><span class="showtimesMovie_details">6+, 1 ч 30 мин</span>`
const KINOPLEXX = (pirates: string) => schedule(
  film('1', 'Семь пиратов', '2D, KK', pirates, PIRATES_EXTRA) +
  film('2', 'Сердце зверя', '2D, RU', session('21:40', '2 200 ₸') + session('00:10', '2 500 ₸')),
)
const KINOPARK = schedule(film('2', 'Сердце зверя', '3D, RU', session('19:00', 'от 2 800 ₸')))

const SX_ALEX = 'https://sxodim.com/aktau/event/alex-lim-v-aktau'
const SX_EVENT = `<html><script type="application/ld+json">[
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Актау"},{"@type":"ListItem","position":2,"name":"Концерты"}]},
  {"@context":"https://schema.org","@type":"Event","name":"Сольный концерт Alex Lim в Актау","startDate":"2026-09-29T19:00:00+05:00",
   "description":"Большой сольный концерт.
Все хиты","location":{"@type":"Place","name":"Театр им. Н. Жантурина","address":{"@type":"PostalAddress","streetAddress":"8-й микрорайон, 28/2"}},
   "image":["https://img.test/alex.jpg"],"offers":{"@type":"Offer","price":"0","url":"https://sxodim.com/aktau/tickets/alex"}}
]</script></html>`

const TB = 'https://topbilet.kz'
const og = (title: string, desc: string) => `<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
  <meta property="og:image" content="https://img.test/tb.jpg"></head></html>`
const TB_ALEX = og('Сольный концерт Alex Lim в Актау - Купить билет онлайн',
  'Сольный концерт Alex Lim, Дата события: 29.09.2026, 19:00; Место проведения: Театр им. Жантурина, Актау; Цены на билеты: от 7 000 ₸')
const TB_ONER = og('Өнер Қырандары Ақтау қаласында - Купить билет', 'Өнер Қырандары, Дата события: 13.11.2026, 20:00; Место проведения: Театр им. Жантурина, Актау')

const IN = 'https://www.inaktau.kz'
const inaktauPage = (ld: Record<string, unknown>, crumb: string, dates: string) => `<html><head><title>${ld.name} | inaktau.kz</title>
  <script type="application/ld+json">${JSON.stringify({ '@context': 'http://schema.org', '@type': 'Event', ...ld })}</script></head>
  <body><nav>Главная Афиша ${crumb} ${ld.name}</nav><h1>${ld.name}</h1><div>Амфитеатр на набережной</div><div>15А микрорайон</div>${dates}
  <p>Возрастные ограничения: 6+</p></body></html>`
const FESTIVAL = inaktauPage(
  { name: 'Фестиваль-конкурс эстрадного вокала «Каспий – море дружбы»', startDate: '2026-09-25', endDate: '2026-09-27', description: 'фестиваль-конкурс',
    image: 'https://img.test/fest.jpg', location: { '@type': 'Place', name: 'Амфитеатр на набережной', address: '15А микрорайон, Актау' } },
  'Концерты', '<div>25 сентября 19:00</div><div>26 сентября 17:00</div><div>27 сентября 19:00</div>')
const PLAY = inaktauPage(
  { name: 'Спектакль «Қыз Жібек»', startDate: '2026-10-01', description: 'музыкальная драма', location: { '@type': 'Place', name: 'Театр им. Н. Жантурина' } },
  'Театр', '<div>1 октября 19:00</div><div>20 октября 19:00</div>')

function publish(pirates: string) {
  web.pages.clear()
  web.pages.set(`${KA}/aktau/cinema/`, CINEMAS)
  web.pages.set(`${KA}/aktau/cinema/101/schedule/`, KINOPLEXX(pirates))
  web.pages.set(`${KA}/aktau/cinema/102/schedule/`, KINOPARK)
  web.pages.set('https://sxodim.com/aktau/afisha', `<a href="${SX_ALEX}">Alex Lim</a> <a href="https://sxodim.com/aktau/event/gone">404</a>`)
  web.pages.set(SX_ALEX, SX_EVENT)
  web.pages.set(`${TB}/ru/city/aktau`, `<a href="/ru/event/alex-lim">Alex Lim</a> <a href="${TB}/ru/event/oner-kyrandary">Өнер</a>`)
  web.pages.set(`${TB}/ru/event/alex-lim`, TB_ALEX)
  web.pages.set(`${TB}/ru/event/oner-kyrandary`, TB_ONER)
  web.pages.set(`${IN}/afisha`, `<a href="/afisha/20554/festival-kaspij">Фестиваль</a> <a href="${IN}/afisha/20600/spektakl-kyz-zhibek">Қыз Жібек</a>`)
  web.pages.set(`${IN}/afisha/20554/festival-kaspij`, FESTIVAL)
  web.pages.set(`${IN}/afisha/20600/spektakl-kyz-zhibek`, PLAY)
}

describe('Afisha parsers', () => {
  it('Aktau time is UTC+5', () => {
    expect(aktauTime('2026-09-25', 19, 0)).toBe('2026-09-25T14:00:00.000Z')
    expect(aktauTime('2026-09-26', 0, 10)).toBe('2026-09-25T19:10:00.000Z')
  })

  it('categories from the publisher\'s section and the title', () => {
    expect(categoryOf('Стендап Нурлана Сабурова')).toBe('standup')
    expect(categoryOf('Театр', 'Спектакль «Қыз Жібек»')).toBe('theatre')
    expect(categoryOf('Концерты', 'Фестиваль-конкурс эстрадного вокала')).toBe('festival')
    expect(categoryOf('Сольный концерт Alex Lim')).toBe('concert')
    expect(categoryOf('Өнер Қырандары')).toBe('other')
  })

  it('JSON-LD tolerates raw line breaks inside strings and unwraps @graph', () => {
    expect(jsonLd(SX_EVENT).map((x) => x['@type'])).toEqual(['BreadcrumbList', 'Event'])
    expect(jsonLd('<script type="application/ld+json">{"@graph":[{"@type":"Event","name":"A"},{"@type":"Place"}]}</script>')).toHaveLength(2)
    expect(jsonLd('<script type="application/ld+json">{broken</script>')).toEqual([])
  })

  it('Kinoafisha: cinemas once each; sessions by film with price, language, and night shows on the next morning', () => {
    expect(parseKinoafishaCinemas(CINEMAS)).toEqual([
      { id: '101', name: 'Kinoplexx Aktau', address: '14-й мкр., ТРЦ «Aktau Mall»' },
      { id: '102', name: 'Kinopark Aktau', address: null },
    ])
    const [day, ...more] = parseKinoafishaSchedule(KINOPLEXX(session('13:10', 'от 1 500 ₸') + session('16:00')), { id: '101', name: 'Kinoplexx Aktau', address: null })
    expect(more).toHaveLength(0)
    expect(day!.date).toBe('2026-09-25')
    // The template inside <script> is not a film, and a film without sessions is skipped.
    expect(day!.films.map((f) => f.title)).toEqual(['Семь пиратов', 'Сердце зверя'])
    const [pirates, beast] = day!.films
    expect(pirates).toMatchObject({ film_id: '1', genres: 'мультфильм, приключения', details: '6+, 1 ч 30 мин', poster: 'https://img.test/pirates.jpg' })
    expect(pirates!.sessions).toEqual([
      { starts_at: '2026-09-25T08:10:00.000Z', format: '2D, KK', language: 'KK', price_from: 1500 },
      { starts_at: '2026-09-25T11:00:00.000Z', format: '2D, KK', language: 'KK', price_from: null },
    ])
    expect(beast!.sessions.map((s) => [s.starts_at, s.language, s.price_from])).toEqual([
      ['2026-09-25T16:40:00.000Z', 'RU', 2200],
      ['2026-09-25T19:10:00.000Z', 'RU', 2500], // 00:10 after the 25th's evening = 26 Sep 00:10 Aktau
    ])
  })

  it('Sxodim: schema.org Event with its section, venue, ticket link; a zero price is unknown, not free', () => {
    expect(parseSxodimEvent(SX_EVENT, SX_ALEX)).toEqual({
      external_id: 'alex-lim-v-aktau', url: SX_ALEX, ticket_url: 'https://sxodim.com/aktau/tickets/alex', title: 'Сольный концерт Alex Lim в Актау',
      category: 'concert', summary: 'Большой сольный концерт. Все хиты', image_url: 'https://img.test/alex.jpg',
      venue: 'Театр им. Н. Жантурина', address: '8-й микрорайон, 28/2', sessions: ['2026-09-29T14:00:00.000Z'], ends_at: null, price_from: null,
    })
    expect(parseSxodimEvent('<html>no event</html>', SX_ALEX)).toBeNull()
  })

  it('inaktau.kz: every listed session in Aktau time; the year comes from the event, across New Year too', () => {
    const fest = parseInaktauEvent(FESTIVAL, `${IN}/afisha/20554/festival-kaspij`)
    expect(fest).toMatchObject({
      external_id: '20554', category: 'festival', venue: 'Амфитеатр на набережной', address: '15А микрорайон, Актау',
      sessions: ['2026-09-25T14:00:00.000Z', '2026-09-26T12:00:00.000Z', '2026-09-27T14:00:00.000Z'], ends_at: '2026-09-27T18:59:00.000Z',
    })
    const winter = inaktauPage({ name: 'Новогодний концерт', startDate: '2026-12-30' }, 'Концерты', '<div>30 декабря 19:00</div><div>2 января 18:00</div>')
    // Read in March 2027, long after it started: still 2026 and 2027, not 2027 and 2027.
    expect(parseInaktauEvent(winter, `${IN}/afisha/1/x`, new Date('2027-03-01T00:00:00Z'))!.sessions)
      .toEqual(['2026-12-30T14:00:00.000Z', '2027-01-02T13:00:00.000Z'])
    const undated = inaktauPage({ name: 'Выставка', startDate: '2026-10-05' }, 'Выставки', '')
    expect(parseInaktauEvent(undated, `${IN}/afisha/2/y`)!.sessions).toEqual(['2026-10-04T19:00:00.000Z'])
  })

  it('Topbilet: Open Graph date, venue and price; the city suffix is dropped', () => {
    expect(parseTopbiletEvent(TB_ALEX, `${TB}/ru/event/alex-lim`)).toMatchObject({
      external_id: 'alex-lim', title: 'Сольный концерт Alex Lim', category: 'concert', venue: 'Театр им. Жантурина',
      sessions: ['2026-09-29T14:00:00.000Z'], price_from: 7000, ticket_url: `${TB}/ru/event/alex-lim`,
    })
    expect(parseTopbiletEvent(og('Без даты', 'Место проведения: ДК'), `${TB}/ru/event/x`)).toBeNull()
  })

  it('one show on two sites is one show; different artists the same night are not', () => {
    const at = (iso: string) => [iso]
    expect(sameShow({ title: 'Сольный концерт Alex Lim в Актау', sessions: at('2026-09-29T14:00:00Z') }, { title: 'Alex Lim', sessions: at('2026-09-29T14:00:00Z') })).toBe(true)
    expect(sameShow({ title: 'Стендап Нурлан Сабуров', sessions: at('2026-10-02T14:00:00Z') }, { title: 'Стендап Тимур Каргинов', sessions: at('2026-10-02T14:00:00Z') })).toBe(false)
    // The same tour back in spring is a new show.
    expect(sameShow({ title: 'Alex Lim', sessions: at('2026-09-29T14:00:00Z') }, { title: 'Alex Lim', sessions: at('2027-04-10T14:00:00Z') })).toBe(false)
    expect(sameShow({ title: 'Концерт в Актау', sessions: at('2026-09-29T14:00:00Z') }, { title: 'Шоу в Актау', sessions: at('2026-09-29T14:00:00Z') })).toBe(false)
  })

  it('the city suffix goes, the rest of the title stays', () => {
    expect(withoutCity('Сольный концерт Alex Lim в Актау')).toBe('Сольный концерт Alex Lim')
    expect(withoutCity('Большой тур команды «Астана» в городе Актау')).toBe('Большой тур команды «Астана»')
    expect(withoutCity('Тұрсынбек Қабатов Ақтауда')).toBe('Тұрсынбек Қабатов')
    expect(withoutCity('Өнер Қырандары Ақтау қаласында')).toBe('Өнер Қырандары')
    expect(withoutCity('Актау')).toBe('Актау')
    expect(withoutCity('Ночь в Актау джаз-клубе')).toBe('Ночь в Актау джаз-клубе')
  })
})

describe('Afisha on PostgreSQL', () => {
  let db: PGlite
  let server: PGLiteSocketServer
  let sql: Sql
  const NOW = new Date('2026-09-25T06:00:00Z') // 11:00 in Aktau

  beforeAll(async () => {
    db = await PGlite.create({ extensions: { postgis } })
    server = new PGLiteSocketServer({ db, port: 0, maxConnections: 2 })
    await server.start()
    const port = (server as unknown as { server: { address(): { port: number } } }).server.address().port
    sql = createSql(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1 })
    await migrate(sql, () => {})
  })

  afterAll(async () => {
    await sql?.end()
    await server?.stop()
    await db?.close()
  })

  it('reads all four listings and keeps the raw pages', async () => {
    publish(session('13:10', 'от 1 500 ₸') + session('16:00'))
    for (const slug of ['kinoafisha', 'sxodim', 'topbilet', 'inaktau']) {
      expect(await runSource(sql, slug, NOW), slug).toMatchObject({ status: 'SUCCESS' })
    }
    const [n] = await sql<{ items: number; sessions: number; events: number }[]>`
      select (select count(*)::int from source_items) items, (select count(*)::int from cinema_sessions) sessions, (select count(*)::int from afisha_events) events`
    expect(n).toEqual({ items: 2 + 1 + 2 + 2, sessions: 2 + 2 + 1, events: 5 })
  })

  it('films group by title across cinemas; one show from two sites is one card with both links', async () => {
    const w = await whatsOn(sql, { now: NOW })
    expect(w.films.map((f) => [f.title, f.cinemas.map((c) => c.name), f.languages, f.price_from, f.next])).toEqual([
      ['Семь пиратов', ['Kinoplexx Aktau'], ['KK'], 1500, '2026-09-25T08:10:00.000Z'],
      ['Сердце зверя', ['Kinopark Aktau', 'Kinoplexx Aktau'], ['RU'], 2200, '2026-09-25T14:00:00.000Z'],
    ])
    expect(w.shows.map((s) => [s.title, s.category, s.next])).toEqual([
      ['Фестиваль-конкурс эстрадного вокала «Каспий – море дружбы»', 'festival', '2026-09-25T14:00:00.000Z'],
      ['Сольный концерт Alex Lim', 'concert', '2026-09-29T14:00:00.000Z'],
      ['Спектакль «Қыз Жібек»', 'theatre', '2026-10-01T14:00:00.000Z'],
      ['Өнер Қырандары', 'other', '2026-11-13T15:00:00.000Z'],
    ])
    const alex = w.shows[1]!
    expect(alex.sources.map((s) => s.name).sort()).toEqual(['Sxodim', 'Topbilet'])
    expect(alex.price_from).toBe(7000)
    expect(alex.summary).toBe('Большой сольный концерт. Все хиты')
    expect(w.sources.map((s) => [s.slug, s.last_success])).toEqual(expect.arrayContaining([['kinoafisha', NOW.toISOString()], ['topbilet', NOW.toISOString()]]))
  })

  it('a cinema\'s new schedule replaces its day: a dropped session disappears, the other cinema is untouched', async () => {
    publish(session('16:00'))
    expect(await runSource(sql, 'kinoafisha', new Date(NOW.getTime() + 3 * 3600_000))).toMatchObject({ status: 'SUCCESS' })
    const w = await whatsOn(sql, { now: NOW })
    const pirates = w.films.find((f) => f.title === 'Семь пиратов')!
    expect(pirates.cinemas[0]!.sessions.map((s) => s.starts_at)).toEqual(['2026-09-25T11:00:00.000Z'])
    expect(w.films.find((f) => f.title === 'Сердце зверя')!.cinemas).toHaveLength(2)
  })

  it('the lifecycle sweep keeps a show until its last session, then removes it', async () => {
    await lifecycleSweep(sql, new Date('2026-10-10T00:00:00Z'))
    const titles = async () => (await sql<{ title: string }[]>`select title from afisha_events`).map((r) => r.title).sort()
    // The play opened on 1 Oct but plays again on 20 Oct; Alex Lim (29 Sep) and the festival (ended 27 Sep) are gone.
    expect(await titles()).toEqual(['Спектакль «Қыз Жібек»', 'Өнер Қырандары Ақтау қаласында'])
    expect((await sql`select 1 from cinema_sessions`).length).toBe(0)
    await lifecycleSweep(sql, new Date('2026-10-24T00:00:00Z'))
    expect(await titles()).toEqual(['Өнер Қырандары Ақтау қаласында'])
  })
})
