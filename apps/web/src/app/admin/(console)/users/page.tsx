import { listAccounts, getSql } from '@aktau/server'
import { AccountsTable } from '@/components/admin'
import { currentAccount } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const [accounts, me] = await Promise.all([listAccounts(getSql()), currentAccount()])
  return <AccountsTable initial={JSON.parse(JSON.stringify(accounts.map(({ installation_id, session_version, ...a }) => a)))} meId={me!.id} />
}
