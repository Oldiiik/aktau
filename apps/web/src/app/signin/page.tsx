import type { Metadata } from 'next'
import { Screen } from '@/components/app'
import { SignInView } from '@/components/account'

export const metadata: Metadata = { title: 'Sign in · Aktau' }

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; need?: string }> }) {
  const { next, need } = await searchParams
  return <Screen wide><SignInView next={next ?? null} need={need ?? null} /></Screen>
}
