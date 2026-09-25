// Aktau · Caspian components. Quiet surfaces, one loud thing: the lighthouse
// beam marks whatever the copilot proposes.
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

export type IconName =
  | 'home' | 'map' | 'ask' | 'you' | 'bell' | 'pin' | 'chevron' | 'search' | 'water' | 'power' | 'roads' | 'bus'
  | 'wind' | 'shield' | 'clock' | 'check' | 'food' | 'calendar' | 'back'
  | 'sparkle' | 'mic' | 'phone' | 'chat' | 'camera' | 'instagram' | 'report' | 'lamp' | 'trash' | 'elevator' | 'building'
  | 'flame' | 'merge' | 'route' | 'timer' | 'alert' | 'x' | 'plus' | 'arrow' | 'globe' | 'moon' | 'send' | 'radar' | 'eye'
  | 'layers' | 'thumb' | 'lighthouse' | 'people' | 'logout' | 'sliders' | 'inbox' | 'sewer' | 'tree' | 'gas'
  | 'news' | 'key' | 'external' | 'sun' | 'ticket' | 'film'

/** SVG asset rendered as a mask so it inherits the current text colour (light + dark). */
export function Icon({ name, size = 22, className = '', style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`icon ${className}`} style={{ width: size, height: size, ['--icon' as string]: `url(/icons/${name}.svg)`, ...style }} />
}

/** The Aktau logo: the lighthouse over the Caspian (design/logo-source.webp → scripts/brand-assets.py). */
export function Logo({ size = 32, className = '' }: { size?: number; className?: string }) {
  // Inline size: Tailwind's reset sets img { height: auto }, which lets a flex row stretch the mark.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/images/logo-mark.png" width={size} height={size} style={{ width: size, height: size }} alt="" aria-hidden draggable={false} className={`flex-none select-none rounded-full ${className}`} />
}

export function Card({ children, tone = 'surface', className = '', padding = 20, as: As = 'section' }: { children: ReactNode; tone?: 'surface' | 'soft' | 'amber' | 'red' | 'green' | 'demo' | 'ink'; className?: string; padding?: 12 | 16 | 20 | 24; as?: 'section' | 'div' | 'article' }) {
  const bg = {
    surface: 'bg-surface card-shadow', soft: 'bg-soft', amber: 'bg-amber-soft hairline', red: 'bg-red-soft hairline', green: 'bg-green-soft hairline', demo: 'bg-demo-soft',
    ink: 'dark-scope bg-surface text-text card-shadow',
  }[tone]
  const pad = { 12: 'p-3', 16: 'p-4', 20: 'p-5', 24: 'p-6' }[padding]
  return <As className={`${bg} rounded-[22px] ${pad} flex flex-col ${className}`}>{children}</As>
}

export type BadgeTone = 'official' | 'community' | 'unknown' | 'active' | 'planned' | 'resolved' | 'demo' | 'neutral' | 'beam'

/** Trust & status badges. Confidence (official/community/unknown) is kept visually separate from severity. */
export function Badge({ tone, children, className = '', dot = false }: { tone: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  const cls = {
    official: 'bg-soft text-blue',
    community: 'bg-amber-soft text-amber',
    unknown: 'bg-soft text-secondary',
    active: 'bg-red-soft text-red',
    planned: 'bg-amber-soft text-amber',
    resolved: 'bg-green-soft text-green',
    demo: 'bg-demo-soft text-demo',
    neutral: 'bg-surface-2 text-secondary hairline',
    beam: 'bg-beam-soft text-beam',
  }[tone]
  return (
    <span className={`inline-flex h-[24px] items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold leading-none whitespace-nowrap ${cls} ${className}`}>
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}

/** The copilot's signature tag. Only AI-proposed content carries it. */
export function CopilotTag({ children = 'Copilot', className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-[22px] items-center gap-1 rounded-[7px] bg-beam-soft px-1.5 text-[12px] font-[600] ${className}`}>
      <Icon name="sparkle" size={12} className="text-beam" />
      <span className="beam-text">{children}</span>
    </span>
  )
}

type ButtonStyle = 'primary' | 'secondary' | 'quiet' | 'beam' | 'ink' | 'danger' | 'outline'
const buttonCls = (s: ButtonStyle, full: boolean, size: 'md' | 'sm') =>
  `tap inline-flex ${size === 'sm' ? 'h-10 rounded-[13px] px-3.5 text-[13px]' : 'h-[50px] rounded-[16px] px-5 text-[15px]'} items-center justify-center gap-2 font-bold leading-none select-none disabled:opacity-45 disabled:pointer-events-none ${full ? 'w-full' : ''} ${
    {
      primary: 'bg-blue text-on-blue shadow-[0_8px_20px_-10px_var(--blue)]',
      secondary: 'bg-soft text-blue-strong',
      quiet: 'text-blue',
      beam: 'beam-fill beam-glow',
      ink: 'bg-ink text-white',
      danger: 'bg-red-soft text-red',
      outline: 'hairline bg-surface text-text',
    }[s]
  }`

export function Button({ children, style = 'primary', full = true, size = 'md', ...rest }: { children: ReactNode; style?: ButtonStyle; full?: boolean; size?: 'md' | 'sm' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={`${buttonCls(style, full, size)} ${rest.className ?? ''}`}>{children}</button>
}

export function LinkButton({ href, children, style = 'primary', full = true, size = 'md', className = '' }: { href: string; children: ReactNode; style?: ButtonStyle; full?: boolean; size?: 'md' | 'sm'; className?: string }) {
  return <Link href={href} className={`${buttonCls(style, full, size)} ${className}`}>{children}</Link>
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`h-px w-full bg-line ${className}`} />
}

export function Beacon({ tone = 'blue', pulse = false, live = false }: { tone?: 'blue' | 'amber' | 'red' | 'green' | 'secondary' | 'beam'; pulse?: boolean; live?: boolean }) {
  const c = { blue: 'text-blue', amber: 'text-amber', red: 'text-red', green: 'text-green', secondary: 'text-secondary', beam: 'text-beam' }[tone]
  return <span aria-hidden className={`beacon ${c}`} data-pulse={pulse} data-live={live} />
}

/** Row with leading icon + two lines. */
export function InfoRow({ icon, iconClass = 'text-blue', title, sub, size = 20, href, trailing }: { icon: IconName; iconClass?: string; title: ReactNode; sub?: ReactNode; size?: number; href?: string; trailing?: ReactNode }) {
  const body = (
    <div className="flex min-h-[48px] items-center gap-3">
      <span className="grid size-9 flex-none place-items-center rounded-[12px] bg-surface-2 hairline"><Icon name={icon} size={size - 2} className={iconClass} /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="t-row text-text">{title}</p>
        {sub ? <p className="t-meta text-secondary">{sub}</p> : null}
      </div>
      {trailing}
      {href ? <Icon name="chevron" size={16} className="text-faint" /> : null}
    </div>
  )
  return href ? <Link href={href} className="tap -mx-2 rounded-[14px] px-2 hover:bg-surface-2">{body}</Link> : body
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`tap relative h-7 w-12 flex-none rounded-full transition-colors duration-200 disabled:opacity-60 ${checked ? 'bg-blue' : 'bg-border'}`}
    >
      <span className={`absolute left-0 top-[3px] size-[22px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.2)] transition-transform duration-200 ${checked ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
    </button>
  )
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`t-label text-secondary ${className}`}>{children}</p>
}

export function PageTitle({ children, size = 'title', eyebrow, sub }: { children: ReactNode; size?: 'title' | 'hero' | 'ask'; eyebrow?: ReactNode; sub?: ReactNode }) {
  const cls = size === 'ask' ? 't-title !text-[30px]' : size === 'hero' ? 't-hero' : 't-title'
  return (
    <div className="flex flex-col gap-2">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h1 className={`${cls} text-text [text-wrap:balance]`}>{children}</h1>
      {sub ? <p className="t-body max-w-[52ch] text-secondary">{sub}</p> : null}
    </div>
  )
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="tap -ml-1 inline-flex h-9 items-center gap-1 self-start rounded-full pr-3 t-sub font-semibold text-secondary hover:text-text">
      <Icon name="back" size={18} /> {children}
    </Link>
  )
}

export function SectionHead({ title, action, href }: { title: ReactNode; action?: ReactNode; href?: string }) {
  return (
    <div className="flex h-8 items-end justify-between gap-3">
      <h2 className="t-section text-text">{title}</h2>
      {action && href ? <Link href={href} className="tap t-meta font-bold text-blue">{action}</Link> : action}
    </div>
  )
}

/** Thin confidence / progress meter. `beam` for copilot scores. */
export function Meter({ value, tone = 'blue', className = '' }: { value: number; tone?: 'blue' | 'beam' | 'green' | 'amber' | 'red'; className?: string }) {
  const fill = { blue: 'bg-blue', beam: 'beam-fill', green: 'bg-green', amber: 'bg-amber', red: 'bg-red' }[tone]
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`} role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${fill} transition-[width] duration-700`} style={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }} />
    </div>
  )
}

export function Stat({ value, label, tone = 'text', className = '' }: { value: ReactNode; label: ReactNode; tone?: 'text' | 'beam' | 'red' | 'green' | 'blue'; className?: string }) {
  const c = { text: 'text-text', beam: 'beam-text', red: 'text-red', green: 'text-green', blue: 'text-blue' }[tone]
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className={`t-num text-[28px] font-semibold leading-none ${c}`}>{value}</span>
      <span className="t-meta text-secondary">{label}</span>
    </div>
  )
}

/** Facade-number plaque: "14 / 21" as painted on Aktau's panel blocks. */
export function Plaque({ district, house, size = 64, className = '' }: { district: string; house?: string | null; size?: number; className?: string }) {
  return (
    <span className={`plaque inline-flex items-baseline gap-[0.12em] text-text ${className}`} style={{ fontSize: size }}>
      <span>{district}</span>
      {house ? (<><span className="text-faint" style={{ fontSize: size * 0.62, fontWeight: 300 }}>/</span><span className="text-blue">{house}</span></>) : null}
    </span>
  )
}

export function Chip({ active, children, onClick, icon }: { active?: boolean; children: ReactNode; onClick?: () => void; icon?: IconName }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`tap inline-flex h-9 flex-none items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold ${active ? 'bg-text text-bg' : 'glass text-text card-shadow'}`}>
      {icon ? <Icon name={icon} size={15} /> : null}{children}
    </button>
  )
}
