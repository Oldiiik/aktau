// Accounts & roles: hashing, sign-in, role changes revoking sessions, the
// last-admin guard, signed session cookies, and the news front page shape.
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adoptInstallation, authenticate, createAccount, createSql, getAccount, newsFront, updateAccount, type Sql } from '@aktau/server'
import { readNewsMeta, newsSection, type SitemapEntry } from '@aktau/connectors'
import { migrate, seed } from '../packages/server/src/db/migrate.ts'
import { canAdmin, canUseCopilot, readSession, signSession } from '../apps/web/src/lib/auth.ts'

let db: PGlite
let server: PGLiteSocketServer
let sql: Sql

beforeAll(async () => {
  db = await PGlite.create({ extensions: { postgis } })
  server = new PGLiteSocketServer({ db, port: 0, maxConnections: 2 })
  await server.start()
  const port = (server as unknown as { server: { address(): { port: number } } }).server.address().port
  sql = createSql(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1 })
  await migrate(sql, () => {})
  await seed(sql, () => {})
})

afterAll(async () => {
  await sql?.end()
  await server?.stop()
  await db?.close()
})

describe('accounts', () => {
  it('creates, authenticates, rejects bad input', async () => {
    const a = await createAccount(sql, { email: ' Admin@Aktau.KZ ', password: 'correct horse battery', role: 'admin' })
    expect(a.email).toBe('admin@aktau.kz')
    expect((await authenticate(sql, 'ADMIN@aktau.kz', 'correct horse battery')).id).toBe(a.id)
    await expect(authenticate(sql, 'admin@aktau.kz', 'wrong password!')).rejects.toMatchObject({ code: 'bad_credentials' })
    await expect(authenticate(sql, 'ghost@aktau.kz', 'whatever12345')).rejects.toMatchObject({ code: 'bad_credentials' })
    await expect(createAccount(sql, { email: 'admin@aktau.kz', password: 'another password' })).rejects.toMatchObject({ code: 'email_taken' })
    await expect(createAccount(sql, { email: 'x@y.kz', password: 'short' })).rejects.toMatchObject({ code: 'weak_password' })
    await expect(createAccount(sql, { email: 'not-an-email', password: 'long enough pw' })).rejects.toMatchObject({ code: 'invalid_email' })
    const [row] = await sql<{ password_hash: string }[]>`select password_hash from accounts where id = ${a.id}`
    expect(row!.password_hash).toMatch(/^scrypt\$/)
    expect(row!.password_hash).not.toContain('correct horse')
  })

  it('role changes and disabling bump the session version; the last admin is protected', async () => {
    const admin = (await authenticate(sql, 'admin@aktau.kz', 'correct horse battery'))
    const op = await createAccount(sql, { email: 'operator@aktau.kz', password: 'operator password', role: 'resident' })
    const promoted = await updateAccount(sql, op.id, { role: 'operator' }, 'test')
    expect(promoted.role).toBe('operator')
    expect(promoted.session_version).toBe(op.session_version + 1)
    await expect(updateAccount(sql, admin.id, { role: 'resident' }, 'test')).rejects.toMatchObject({ code: 'last_admin' })
    await expect(updateAccount(sql, admin.id, { disabled: true }, 'test')).rejects.toMatchObject({ code: 'last_admin' })
    const disabled = await updateAccount(sql, op.id, { disabled: true }, 'test')
    await expect(authenticate(sql, 'operator@aktau.kz', 'operator password')).rejects.toMatchObject({ code: 'disabled' })
    expect(disabled.session_version).toBe(promoted.session_version + 1)
    const audit = await sql`select action from audit_log where entity_type = 'account'`
    expect(audit.length).toBeGreaterThanOrEqual(3)
  })

  it('an account adopts its first installation and hands it to new devices', async () => {
    const r = await createAccount(sql, { email: 'resident@aktau.kz', password: 'resident password' })
    expect(await adoptInstallation(sql, r.id, 'device-a')).toBe('device-a')
    expect(await adoptInstallation(sql, r.id, 'device-b')).toBe('device-a')
    expect((await getAccount(sql, r.id))!.installation_id).toBe('device-a')
  })
})

describe('session cookie', () => {
  it('round-trips, rejects tampering and expiry', async () => {
    process.env.SESSION_SECRET = 'test-secret-test-secret'
    const v = await signSession({ a: '00000000-0000-0000-0000-000000000001', r: 'operator', v: 3 })
    expect(await readSession(v)).toMatchObject({ r: 'operator', v: 3 })
    const [body, sig] = v.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), r: 'admin' })).toString('base64url')
    expect(await readSession(`${forged}.${sig}`)).toBeNull()
    expect(await readSession(await signSession({ a: 'x', r: 'admin', v: 1 }, -10))).toBeNull()
    process.env.SESSION_SECRET = 'rotated-secret-rotated'
    expect(await readSession(v)).toBeNull()
    expect([canUseCopilot('operator'), canUseCopilot('resident'), canAdmin('operator'), canAdmin('admin')]).toEqual([true, false, false, true])
  })
})

describe('news', () => {
  const entry: SitemapEntry = { url: 'https://www.lada.kz/aktau_news/society/158572-kto-reshaet.html', title: 'Кто решает, где ремонтировать дороги', published_at: new Date('2026-09-23T13:23:00Z'), section: 'aktau_news' }
  it('reads headline, summary and image from JSON-LD and never the body', () => {
    const html = `<meta property="og:image" content="https://www.lada.kz/uploads/photos/og.jpg"><script type="application/ld+json">${JSON.stringify({
      '@type': 'NewsArticle', headline: 'Кто решает, где ремонтировать дороги в Мангистау', description: 'Дорожный ремонт идет на 87 объектах, передает Lada.kz.',
      articleBody: 'SECRET FULL BODY', datePublished: '2026-09-23T18:23:00+05:00', image: [{ url: 'https://www.lada.kz/uploads/photos/2026-09/1.jpg', width: 1267, height: 800 }], author: { name: 'Наталья Вронская' },
    })}</script>`
    const n = readNewsMeta(html, entry, 'society')
    expect(n).toMatchObject({ headline: 'Кто решает, где ремонтировать дороги в Мангистау', lede: 'Дорожный ремонт идет на 87 объектах.', author: 'Наталья Вронская', image: { width: 1267 } })
    expect(JSON.stringify(n)).not.toContain('SECRET')
  })
  it('sorts stories into Aktau sections, Kazakhstan and world', () => {
    expect(newsSection(entry)).toBe('society')
    expect(newsSection({ ...entry, url: 'https://www.lada.kz/world-news/1-x.html', title: 'Под Парижем нашли город', section: 'world-news' })).toBe('world')
    expect(newsSection({ ...entry, url: 'https://www.lada.kz/kazakhstan-news/1-x.html', title: 'Новые правила детсадов', section: 'kazakhstan-news' })).toBe('kazakhstan')
    expect(newsSection({ ...entry, url: 'https://www.lada.kz/other/1-x.html', title: 'Реклама', section: 'other' })).toBeNull()
    expect(newsSection({ ...entry, url: 'https://www.lada.kz/sport/1-x.html', title: 'В Актау стартует сезон мотокросса', section: 'sport' })).toBe('sport')
  })
  it('front page has all three strands', async () => {
    const f = await newsFront(sql, 'ru')
    expect(f).toHaveProperty('articles')
    expect(f).toHaveProperty('official')
    expect(f).toHaveProperty('fixed')
    expect(f.pulse).toHaveProperty('open')
  })
})

describe('assistant (basic mode)', () => {
  it('maps everyday questions to OSM tags without false matches', async () => {
    const { guessPlaceTag } = await import('@aktau/server')
    expect(guessPlaceTag('Где починить очки?')).toBe('shop=optician')
    expect(guessPlaceTag('Көзілдірікті қайда жөндеуге болады?')).toBe('shop=optician')
    expect(guessPlaceTag('аптека рядом')).toBe('amenity=pharmacy')
    expect(guessPlaceTag('Будет ли завтра свет?')).toBeNull()
    expect(guessPlaceTag('Есть ли вода в 14 мкр?')).toBeNull()
  })
})
