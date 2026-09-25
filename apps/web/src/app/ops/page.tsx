import { redirect } from 'next/navigation'

// 109 Copilot moved into the app at /copilot.
export default function OpsPage() {
  redirect('/copilot')
}
