import { Screen } from '@/components/app'
import { HomePicker } from '@/components/you'

export default async function SetHomePage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams
  return <Screen><HomePicker type={type === 'CUSTOM' ? 'CUSTOM' : 'HOME'} /></Screen>
}
