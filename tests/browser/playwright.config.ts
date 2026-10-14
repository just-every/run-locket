import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: { headless: true, trace: 'off', video: 'off', screenshot: 'off' },
  reporter: [['list']],
  outputDir: process.env.LOCKET_BROWSER_OUTPUT || '/tmp/locket-browser-results',
})
