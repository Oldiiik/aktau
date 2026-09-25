import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { AppProvider } from '@/components/app'
import { currentAccount, getInstallationId, getLang, getTheme } from '@/lib/session'
import './globals.css'

export const metadata: Metadata = {
  title: 'Aktau — your city, in one place',
  description: 'Calm when clear, honest when uncertain. Utilities, roads, weather and the Caspian for Aktau, with every fact traced to its source.',
  applicationName: 'Aktau',
  appleWebApp: { capable: true, title: 'Aktau', statusBarStyle: 'default' },
  icons: { icon: [{ url: '/images/logo-mark-64.png', type: 'image/png', sizes: '64x64' }, { url: '/images/logo-mark.png', type: 'image/png', sizes: '256x256' }], apple: '/images/app-icon-180.png' },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f4f7fb' }, { media: '(prefers-color-scheme: dark)', color: '#0b1320' }],
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [lang, theme, iid, me] = await Promise.all([getLang(), getTheme(), getInstallationId(), currentAccount()])
  return (
    <html lang={lang} data-theme={theme === 'system' ? undefined : theme} suppressHydrationWarning>
      <body>
        <AppProvider lang={lang} installationId={iid} me={me}>{children}</AppProvider>
      </body>
    </html>
  )
}
