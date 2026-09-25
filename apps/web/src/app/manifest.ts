import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aktau',
    short_name: 'Aktau',
    description: 'Utilities, 109, news and the Caspian for Aktau, with every fact traced to its source.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f7fb',
    theme_color: '#f4f7fb',
    lang: 'ru',
    categories: ['utilities', 'news', 'navigation'],
    icons: [
      { src: '/images/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/images/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/images/app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Сообщить о проблеме', short_name: 'Сообщить', url: '/report' },
      { name: 'Спросить', url: '/ask' },
      { name: 'Новости', url: '/news' },
    ],
  }
}
