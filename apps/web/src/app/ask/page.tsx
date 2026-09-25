import { Suspense } from 'react'
import { Screen } from '@/components/app'
import { AssistantView } from '@/components/assistant'

export default function AskPage() {
  return <Screen><Suspense><AssistantView /></Suspense></Screen>
}
