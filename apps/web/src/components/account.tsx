'use client'
// Sign in / create account. Accounts are optional for residents (they carry
// saved places across devices); staff sign in here to reach 109 Copilot or the
// admin console. Public sign-up always creates a resident.
import Link from 'next/link'
import { useState } from 'react'
import { Avatar, ROLE_LABEL, signOut, useApp, type L3 } from './app'
import { Button, Icon, type IconName } from './primitives'
import { PHOTOS } from '@/lib/photos'

const NEED: Record<string, L3> = {
  admin: { en: 'The admin console is for admin accounts.', ru: 'Админ-панель доступна только администраторам.', kk: 'Әкімші панелі тек әкімшілерге арналған.' },
  operator: { en: '109 Copilot is for 109 operators and admins.', ru: '109 Copilot доступен операторам 109 и администраторам.', kk: '109 Copilot тек 109 операторлары мен әкімшілерге арналған.' },
}

export function SignInView({ next, need }: { next: string | null; need: string | null }) {
  const { me, tx } = useApp()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/you'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mode === 'signup' ? { email, password, name: name || undefined } : { email, password }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error?.message ?? `HTTP ${r.status}`)
      // Full navigation: the layout re-reads the session and the adopted installation.
      location.href = mode === 'signup' ? '/you' : dest
    } catch (x) { setErr((x as Error).message); setBusy(false) }
  }

  return (
    <div className="grid flex-1 content-start gap-6 lg:grid-cols-[1fr_420px] lg:content-center lg:items-center lg:gap-10 lg:py-10">
      <div className="relative -mx-5 -mt-4 h-[168px] overflow-hidden sm:mx-0 sm:mt-0 sm:rounded-[24px] lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PHOTOS.lighthouse.src} alt={PHOTOS.lighthouse.alt} className="absolute inset-0 h-full w-full object-cover" />
      </div>
      <div className="rise hidden flex-col gap-6 lg:flex">
        <div className="relative h-[220px] overflow-hidden rounded-[24px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PHOTOS.lighthouse.src} alt={PHOTOS.lighthouse.alt} className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <h1 className="t-display max-w-[14ch] text-text">{tx({ en: 'Your city, on every device.', ru: 'Ваш город на всех устройствах.', kk: 'Қалаңыз барлық құрылғыда.' })}</h1>
        <ul className="flex max-w-[44ch] flex-col gap-4">
          <Perk icon="home" text={tx({ en: 'Your home, places and alerts follow you to your phone and laptop.', ru: 'Дом, места и уведомления — на телефоне и ноутбуке.', kk: 'Үйіңіз, орындарыңыз және хабарламаларыңыз барлық жерде.' })} />
          <Perk icon="report" text={tx({ en: 'Every report you send to 109 stays in one inbox.', ru: 'Все обращения в 109 — в одном месте.', kk: '109-ға барлық өтініштер бір жерде.' })} />
          <Perk icon="shield" text={tx({ en: 'Aktau still works without an account. Nothing is shared.', ru: 'Aktau работает и без аккаунта. Мы ничего не передаём.', kk: 'Aktau аккаунтсыз да жұмыс істейді.' })} />
        </ul>
      </div>

      <section className="rise rise-1 flex flex-col gap-5 rounded-[28px] bg-surface p-6 card-shadow sm:p-7">
        {need && NEED[need] ? (
          <div className="flex items-start gap-3 rounded-[16px] bg-beam-soft p-3.5">
            <Icon name="key" size={18} className="mt-0.5 text-beam" />
            <p className="t-sub text-text">{tx(NEED[need]!)}{me ? <> {tx({ en: 'You are signed in as', ru: 'Вы вошли как', kk: 'Сіз кірдіңіз:' })} <b>{me.email}</b> ({tx(ROLE_LABEL[me.role])}).</> : null}</p>
          </div>
        ) : null}

        {me && !need ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3"><Avatar me={me} size={48} /><div className="flex flex-col"><span className="t-card text-text">{me.name ?? me.email}</span><span className="t-meta text-secondary">{tx(ROLE_LABEL[me.role])}</span></div></div>
            <Link href={dest} className="tap inline-flex h-[50px] items-center justify-center rounded-[16px] bg-blue text-[15px] font-bold text-on-blue">{tx({ en: 'Continue', ru: 'Продолжить', kk: 'Жалғастыру' })}</Link>
            <Button style="quiet" onClick={() => void signOut()}>{tx({ en: 'Sign out', ru: 'Выйти', kk: 'Шығу' })}</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="t-title text-text">{mode === 'signin' ? tx({ en: 'Sign in', ru: 'Вход', kk: 'Кіру' }) : tx({ en: 'Create an account', ru: 'Создать аккаунт', kk: 'Аккаунт ашу' })}</h2>
              <p className="t-sub text-secondary">{mode === 'signin' ? tx({ en: 'Residents, 109 operators and admins.', ru: 'Жители, операторы 109 и администраторы.', kk: 'Тұрғындар, 109 операторлары және әкімшілер.' }) : tx({ en: 'Takes this device’s places with you.', ru: 'Места с этого устройства перейдут в аккаунт.', kk: 'Осы құрылғының орындары аккаунтқа ауысады.' })}</p>
            </div>
            <div className="flex rounded-[14px] bg-bg p-1 hairline">
              {(['signin', 'signup'] as const).map((m) => (
                <button key={m} type="button" onClick={() => { setMode(m); setErr(null) }} aria-pressed={mode === m}
                  className={`tap h-9 flex-1 rounded-[11px] text-[13px] font-bold ${mode === m ? 'bg-surface text-text card-shadow' : 'text-secondary hover:text-text'}`}>
                  {m === 'signin' ? tx({ en: 'Sign in', ru: 'Войти', kk: 'Кіру' }) : tx({ en: 'New account', ru: 'Новый аккаунт', kk: 'Жаңа аккаунт' })}
                </button>
              ))}
            </div>
            <form className="flex flex-col gap-3" onSubmit={submit}>
              {mode === 'signup' ? <Field label={tx({ en: 'Name (optional)', ru: 'Имя (необязательно)', kk: 'Аты (міндетті емес)' })} value={name} onChange={setName} autoComplete="name" /> : null}
              <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
              <Field label={tx({ en: 'Password', ru: 'Пароль', kk: 'Құпиясөз' })} type="password" value={password} onChange={setPassword} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required
                hint={mode === 'signup' ? tx({ en: 'At least 10 characters.', ru: 'Не менее 10 символов.', kk: 'Кемінде 10 таңба.' }) : undefined} />
              {err ? <p className="flex items-center gap-2 t-sub font-semibold text-red" role="alert"><Icon name="alert" size={16} />{err}</p> : null}
              <Button type="submit" disabled={busy || !email || !password} className="mt-1">{busy ? '…' : mode === 'signin' ? tx({ en: 'Sign in', ru: 'Войти', kk: 'Кіру' }) : tx({ en: 'Create account', ru: 'Создать аккаунт', kk: 'Аккаунт ашу' })}</Button>
            </form>
            <p className="t-meta text-faint">{tx({ en: 'Staff roles (109 operator, admin) are granted by an Aktau admin.', ru: 'Роли сотрудников (оператор 109, администратор) выдаёт администратор Aktau.', kk: 'Қызметкер рөлдерін Aktau әкімшісі береді.' })}</p>
          </>
        )}
      </section>
    </div>
  )
}

function Perk({ icon, text }: { icon: IconName; text: string }) {
  return <li className="flex items-start gap-3"><span className="grid size-9 flex-none place-items-center rounded-[12px] bg-surface card-shadow"><Icon name={icon} size={18} className="text-blue" /></span><span className="t-body pt-2 text-secondary">{text}</span></li>
}

function Field({ label, value, onChange, type = 'text', hint, ...rest }: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; autoComplete?: string; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5 rounded-[16px] bg-bg px-4 pb-2.5 pt-2 hairline">
      <span className="t-label !text-[9.5px] text-faint">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent t-body text-text outline-none" {...rest} />
      {hint ? <span className="t-meta text-faint">{hint}</span> : null}
    </label>
  )
}

/** You → the account block: sign-in invitation, or who you are + staff shortcuts. */
export function AccountSection() {
  const { me, t, tx } = useApp()
  if (!me) {
    return (
      <section className="flex flex-col gap-2 rounded-[22px] bg-soft p-5">
        <p className="t-card text-text">{t('you.sync')}</p>
        <p className="t-meta text-secondary">{t('you.sync.sub')} {tx({ en: 'Until then your places live on this device’s anonymous id.', ru: 'Пока места хранятся на анонимном идентификаторе этого устройства.', kk: 'Әзірге орындар осы құрылғының анонимді идентификаторында сақталады.' })}</p>
        <Link href="/signin" className="tap mt-1 inline-flex h-[50px] items-center justify-center gap-2 rounded-[16px] bg-surface text-[15px] font-bold text-text hairline"><Icon name="you" size={17} />{tx({ en: 'Sign in or create an account', ru: 'Войти или создать аккаунт', kk: 'Кіру немесе аккаунт ашу' })}</Link>
      </section>
    )
  }
  const staff = me.role !== 'resident'
  return (
    <section className="flex flex-col gap-1 rounded-[22px] bg-surface p-2 card-shadow">
      <div className="flex items-center gap-3 p-3">
        <Avatar me={me} size={44} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="t-card truncate text-text">{me.name ?? me.email.split('@')[0]}</span>
          <span className="t-meta truncate text-secondary">{me.email}</span>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${staff ? 'bg-beam-soft text-beam' : 'bg-soft text-blue'}`}>{tx(ROLE_LABEL[me.role])}</span>
      </div>
      {staff ? (
        <Link href="/copilot" className="tap flex min-h-[60px] items-center gap-3 rounded-[14px] px-3 hover:bg-surface-2">
          <Icon name="radar" size={19} className="text-beam" />
          <span className="flex flex-1 flex-col"><span className="t-row text-text">109 Copilot</span><span className="t-meta text-secondary">{tx({ en: 'Incoming signals, incidents, SLA', ru: 'Входящие сигналы, инциденты, сроки', kk: 'Сигналдар, оқиғалар, мерзімдер' })}</span></span>
          <Icon name="chevron" size={16} className="text-faint" />
        </Link>
      ) : null}
      {me.role === 'admin' ? (
        <Link href="/admin" className="tap flex min-h-[60px] items-center gap-3 rounded-[14px] px-3 hover:bg-surface-2">
          <Icon name="key" size={19} className="text-secondary" />
          <span className="flex flex-1 flex-col"><span className="t-row text-text">{tx({ en: 'Admin console', ru: 'Админ-панель', kk: 'Әкімші панелі' })}</span><span className="t-meta text-secondary">{tx({ en: 'Sources, review queue, events, accounts', ru: 'Источники, проверка, события, аккаунты', kk: 'Дереккөздер, тексеру, оқиғалар, аккаунттар' })}</span></span>
          <Icon name="chevron" size={16} className="text-faint" />
        </Link>
      ) : null}
      <button type="button" onClick={() => void signOut()} className="tap flex min-h-[52px] items-center gap-3 rounded-[14px] px-3 text-left hover:bg-surface-2">
        <Icon name="logout" size={19} className="text-secondary" />
        <span className="t-row flex-1 text-text">{tx({ en: 'Sign out', ru: 'Выйти', kk: 'Шығу' })}</span>
      </button>
    </section>
  )
}
