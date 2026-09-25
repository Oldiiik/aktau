import type { NextConfig } from 'next'
import { join } from 'node:path'

const root = join(import.meta.dirname, '../..')

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@aktau/types', '@aktau/i18n', '@aktau/city-core', '@aktau/normalization', '@aktau/source-ranking', '@aktau/connectors', '@aktau/server', '@aktau/ui'],
  serverExternalPackages: ['postgres', '@anthropic-ai/sdk'],
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
  devIndicators: false,
  // Live demo: phones on the venue Wi-Fi open the dev server by its LAN address
  // (or a tunnel). Development only; production is served normally.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*', '*.local', '**.trycloudflare.com', '**.ngrok-free.app'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=(self)' },
      ],
    }]
  },
}

export default config
