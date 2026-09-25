'use client'
import Link from 'next/link'
import { useApp } from './app'
import { Icon } from './primitives'
import { PHOTOS } from '@/lib/photos'

export function NotFoundView() {
  const { tx } = useApp()
  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div className="relative h-[220px] overflow-hidden rounded-[24px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PHOTOS.night.src} alt="" className="absolute inset-0 h-full w-full object-cover" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="t-title text-text">{tx({ en: 'This page isn’t here', ru: 'Такой страницы нет', kk: 'Мұндай бет жоқ' })}</h1>
        <p className="t-body text-secondary">{tx({ en: 'The link may be old, or the notice was removed. Everything else in Aktau is where you left it.', ru: 'Ссылка могла устареть или уведомление удалено. Всё остальное на месте.', kk: 'Сілтеме ескірген болуы мүмкін.' })}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Link href="/" className="tap inline-flex h-[50px] items-center justify-center gap-2 rounded-[16px] bg-blue text-[15px] font-bold text-on-blue"><Icon name="home" size={18} />{tx({ en: 'Go home', ru: 'На главную', kk: 'Басты бетке' })}</Link>
        <Link href="/ask" className="tap inline-flex h-[50px] items-center justify-center gap-2 rounded-[16px] text-[15px] font-bold text-blue-strong hairline"><Icon name="ask" size={18} />{tx({ en: 'Ask Aktau', ru: 'Спросить Актау', kk: 'Ақтаудан сұрау' })}</Link>
      </div>
    </div>
  )
}
