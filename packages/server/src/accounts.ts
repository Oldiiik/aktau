// Accounts: optional for residents, required for staff (109 operators, admins).
// Passwords are scrypt hashes; the web layer signs a session cookie carrying
// { account id, session_version } and every privileged request re-reads the
// account here, so a role change or disable takes effect immediately.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { audit } from './audit.ts'
import type { Sql } from './db/client.ts'

export type Role = 'resident' | 'operator' | 'admin'
export const ROLES: readonly Role[] = ['resident', 'operator', 'admin']

export type Account = {
  id: string; email: string; display_name: string | null; role: Role; installation_id: string | null
  session_version: number; disabled: boolean; created_at: string; last_sign_in_at: string | null
}

export class AccountError extends Error {
  constructor(public code: 'invalid_email' | 'weak_password' | 'email_taken' | 'bad_credentials' | 'disabled' | 'last_admin' | 'not_found', message: string) {
    super(message)
    this.name = 'AccountError'
  }
}

const scrypt = (pw: string, salt: Buffer, len: number, o: ScryptOptions) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, len, o, (e, k) => (e ? rej(e) : res(k))))
const N = 16384, R = 8, P = 1, LEN = 32

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(pw.normalize('NFKC'), salt, LEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
  return timingSafeEqual(key, expected)
}

// Burned on unknown emails so the response time does not reveal which exist.
let dummyHash: Promise<string> | undefined

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/
export const normEmail = (e: string) => e.trim().toLowerCase()

function checkPassword(pw: string) {
  if (pw.length < 10) throw new AccountError('weak_password', 'Use at least 10 characters.')
  if (pw.length > 200) throw new AccountError('weak_password', 'Password is too long.')
}

type Row = Omit<Account, 'created_at' | 'last_sign_in_at'> & { password_hash: string; created_at: Date; last_sign_in_at: Date | null }
const project = (r: Row): Account => ({
  id: r.id, email: r.email, display_name: r.display_name, role: r.role, installation_id: r.installation_id,
  session_version: r.session_version, disabled: r.disabled,
  created_at: new Date(r.created_at).toISOString(), last_sign_in_at: r.last_sign_in_at ? new Date(r.last_sign_in_at).toISOString() : null,
})

export async function createAccount(sql: Sql, input: { email: string; password: string; display_name?: string | null; role?: Role; installation_id?: string | null; actor?: string }) {
  const email = normEmail(input.email)
  if (!EMAIL.test(email)) throw new AccountError('invalid_email', 'Enter a valid email address.')
  checkPassword(input.password)
  const hash = await hashPassword(input.password)
  const [row] = await sql<Row[]>`
    insert into accounts (email, display_name, password_hash, role, installation_id)
    values (${email}, ${input.display_name?.trim() || null}, ${hash}, ${input.role ?? 'resident'}, ${input.installation_id ?? null})
    on conflict (lower(email)) do nothing
    returning *`
  if (!row) throw new AccountError('email_taken', 'An account with this email already exists.')
  await audit(sql, input.actor ?? `account:${row.id}`, 'account.create', 'account', row.id, null, { email, role: row.role })
  return project(row)
}

export async function authenticate(sql: Sql, emailIn: string, password: string) {
  const [row] = await sql<Row[]>`select * from accounts where lower(email) = ${normEmail(emailIn)}`
  if (!row) {
    await verifyPassword(password, await (dummyHash ??= hashPassword('not-a-real-password')))
    throw new AccountError('bad_credentials', 'Wrong email or password.')
  }
  if (!(await verifyPassword(password, row.password_hash))) throw new AccountError('bad_credentials', 'Wrong email or password.')
  if (row.disabled) throw new AccountError('disabled', 'This account is disabled.')
  await sql`update accounts set last_sign_in_at = now() where id = ${row.id}`
  return project(row)
}

export async function getAccount(sql: Sql, id: string): Promise<Account | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [row] = await sql<Row[]>`select * from accounts where id = ${id}`
  return row ? project(row) : null
}

/** Binds an installation to the account the first time; returns the one to use on this device. */
export async function adoptInstallation(sql: Sql, id: string, current: string | null): Promise<string | null> {
  const [row] = await sql<{ installation_id: string | null }[]>`
    update accounts set installation_id = coalesce(installation_id, ${current}) where id = ${id} returning installation_id`
  return row?.installation_id ?? current
}

export async function listAccounts(sql: Sql) {
  const rows = await sql<Row[]>`select * from accounts order by case role when 'admin' then 0 when 'operator' then 1 else 2 end, created_at desc limit 500`
  return rows.map(project)
}

export async function updateAccount(sql: Sql, id: string, patch: { role?: Role; disabled?: boolean; display_name?: string | null }, actor: string) {
  const before = await getAccount(sql, id)
  if (!before) throw new AccountError('not_found', 'Account not found.')
  const losesAdmin = before.role === 'admin' && !before.disabled && ((patch.role && patch.role !== 'admin') || patch.disabled === true)
  if (losesAdmin) {
    const [others] = await sql<{ n: number }[]>`select count(*)::int n from accounts where role = 'admin' and not disabled and id <> ${id}`
    if (!others?.n) throw new AccountError('last_admin', 'Aktau needs at least one active admin.')
  }
  // Role or access changes invalidate existing sessions of that account.
  const bump = (patch.role !== undefined && patch.role !== before.role) || (patch.disabled !== undefined && patch.disabled !== before.disabled)
  const [row] = await sql<Row[]>`
    update accounts set
      role = ${patch.role ?? before.role},
      disabled = ${patch.disabled ?? before.disabled},
      display_name = ${patch.display_name === undefined ? before.display_name : patch.display_name?.trim() || null},
      session_version = session_version + ${bump ? 1 : 0}
    where id = ${id} returning *`
  await audit(sql, actor, 'account.update', 'account', id, { role: before.role, disabled: before.disabled }, { role: row!.role, disabled: row!.disabled })
  return project(row!)
}

export async function setPassword(sql: Sql, id: string, password: string, actor: string) {
  checkPassword(password)
  await sql`update accounts set password_hash = ${await hashPassword(password)}, session_version = session_version + 1 where id = ${id}`
  await audit(sql, actor, 'account.password', 'account', id, null, null)
}

/** Ends every session of the account (the signed cookies carry the old version). */
export async function signOutEverywhere(sql: Sql, id: string) {
  await sql`update accounts set session_version = session_version + 1 where id = ${id}`
}
