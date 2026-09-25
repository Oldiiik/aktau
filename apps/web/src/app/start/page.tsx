import type { Metadata } from 'next'
import { StartView } from '@/components/start'
import { getLang } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Aktau' }

// First launch: language, name, home, alerts, location. The root page sends
// anyone without the aktau_onboarded cookie here; it can be reopened any time.
export default async function StartPage() {
  return <StartView initialLang={await getLang()} />
}
