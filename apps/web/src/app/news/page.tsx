import type { Metadata } from 'next'
import { getSql, newsFront } from '@aktau/server'
import { Screen } from '@/components/app'
import { NewsView } from '@/components/news'
import { getLang } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'News · Aktau', description: 'Aktau today: local stories, official notices and what 109 fixed this week — each with its source.' }

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ story?: string; section?: string }> }) {
  const [{ story, section }, lang] = await Promise.all([searchParams, getLang()])
  const front = await newsFront(getSql(), lang)
  return <Screen wide="xl"><NewsView initial={JSON.parse(JSON.stringify(front))} story={story ?? null} section={section ?? null} /></Screen>
}
