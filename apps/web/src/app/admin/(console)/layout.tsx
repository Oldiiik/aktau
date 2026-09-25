import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/admin'
import { currentAccount } from '@/lib/session'

// The editor console is for admin accounts only (the proxy routes; this checks
// the account against the database: role, disabled, session version).
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await currentAccount()
  if (me?.role !== 'admin') redirect(`/signin?next=/admin${me ? '&need=admin' : ''}`)
  return <AdminShell demo={process.env.DEMO_MODE === 'true'}>{children}</AdminShell>
}
