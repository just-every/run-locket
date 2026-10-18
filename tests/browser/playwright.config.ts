import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  // The owner's Mac rule: a mock keychain and basic password store, so no browser asks for the login keychain.
  use: { headless: true, trace: 'off', video: 'off', screenshot: 'off', launchOptions: { args: ['--use-mock-keychain', '--password-store=basic'] } },
  reporter: [['list']],
  outputDir: process.env.LOCKET_BROWSER_OUTPUT || '/tmp/locket-browser-results',
})
