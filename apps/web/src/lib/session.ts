// Cookie-backed session: installation id, language, appearance, and the
// optional account. The installation id is a random identifier for anonymous
// personalisation; it is not a credential and carries no personal data.
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { getAccount, getSql } from '@aktau/server'
import type { Lang } from '@aktau/types'
import { readSession, SESSION_COOKIE, type Role } from './auth.ts'

export const COOKIE = { iid: 'aktau_iid', lang: 'aktau_lang', theme: 'aktau_theme', session: SESSION_COOKIE } as const
export type Theme = 'system' | 'light' | 'dark'
/** What the client is allowed to know about the signed-in account. */
export type Me = { id: string; email: string; name: string | null; role: Role }

export async function getLang(): Promise<Lang> {
  const c = (await cookies()).get(COOKIE.lang)?.value
  if (c === 'en' || c === 'ru' || c === 'kk') return c
  const al = (await headers()).get('accept-language') ?? ''
  return /^kk/i.test(al) ? 'kk' : /^ru/i.test(al) ? 'ru' : 'en'
}

export async function getTheme(): Promise<Theme> {
  const c = (await cookies()).get(COOKIE.theme)?.value
  return c === 'light' || c === 'dark' ? c : 'system'
}

export async function getInstallationId(): Promise<string | null> {
  return (await cookies()).get(COOKIE.iid)?.value ?? null
}

/** The signed-in account, verified against the database (once per request). */
export const currentAccount = cache(async (): Promise<Me | null> => {
  const claims = await readSession((await cookies()).get(COOKIE.session)?.value)
  if (!claims) return null
  const a = await getAccount(getSql(), claims.a).catch(() => null)
  if (!a || a.disabled || a.session_version !== claims.v) return null
  return { id: a.id, email: a.email, name: a.display_name, role: a.role }
})
