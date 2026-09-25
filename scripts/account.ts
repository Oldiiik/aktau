// Staff accounts from the command line (works against PGlite or Supabase):
//   npm run account -- create you@example.com --role admin [--name "Aldiyar"]
//   npm run account -- role you@example.com operator
//   npm run account -- password you@example.com
//   npm run account -- list
// The password is asked for without echo (or taken from ACCOUNT_PASSWORD).
// Leave it empty to generate a strong one, printed once.
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { createAccount, createSql, listAccounts, ROLES, setPassword, updateAccount, type Role } from '../packages/server/src/index.ts'

const [cmd, email, ...rest] = process.argv.slice(2)
const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined }
const sql = createSql(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/postgres', { max: 1 })

function ask(q: string): Promise<string> {
  if (process.env.ACCOUNT_PASSWORD) return Promise.resolve(process.env.ACCOUNT_PASSWORD)
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream }
  let muted = false
  out._writeToOutput = (s) => { if (!muted || s.includes('\n')) out.output.write(muted ? '\n' : s) }
  return new Promise((res) => { rl.question(q, (a) => { rl.close(); res(a) }); muted = true })
}

async function password() {
  const pw = await ask('Password (empty = generate): ')
  if (pw) return { pw, generated: false }
  return { pw: randomBytes(12).toString('base64url'), generated: true }
}

async function find(e: string) {
  const a = (await listAccounts(sql)).find((x) => x.email === e.trim().toLowerCase())
  if (!a) throw new Error(`No account ${e}`)
  return a
}

try {
  if (cmd === 'list') console.table((await listAccounts(sql)).map(({ email, role, disabled, display_name, last_sign_in_at }) => ({ email, role, disabled, name: display_name, last_sign_in_at })))
  else if (cmd === 'create' && email) {
    const role = (flag('role') ?? 'resident') as Role
    if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(', ')}`)
    const { pw, generated } = await password()
    const a = await createAccount(sql, { email, password: pw, role, display_name: flag('name') ?? null, actor: 'cli' })
    console.log(`✓ ${a.email} · ${a.role}${generated ? `\n  password: ${pw}   (shown once)` : ''}`)
  } else if (cmd === 'role' && email && rest[0]) {
    const a = await updateAccount(sql, (await find(email)).id, { role: rest[0] as Role }, 'cli')
    console.log(`✓ ${a.email} is now ${a.role}`)
  } else if (cmd === 'password' && email) {
    const { pw, generated } = await password()
    await setPassword(sql, (await find(email)).id, pw, 'cli')
    console.log(`✓ password changed, other sessions signed out${generated ? `\n  password: ${pw}   (shown once)` : ''}`)
  } else {
    console.log('usage: npm run account -- create <email> --role admin|operator|resident [--name <name>] | role <email> <role> | password <email> | list')
    process.exitCode = 1
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await sql.end()
}
