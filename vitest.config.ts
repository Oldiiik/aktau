import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { TZ: 'UTC' },
  },
})
