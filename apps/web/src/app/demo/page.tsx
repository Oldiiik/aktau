import type { Metadata } from 'next'
import { DemoView } from '@/components/demo'

export const metadata: Metadata = { title: 'Live demo · Aktau' }

// Split-screen jury demo. Gated like /ops (it embeds the operator console).
export default function DemoPage() {
  return <DemoView />
}
