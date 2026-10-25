/**
 * End-to-end and API integration tests (tests/e2e), against the app running
 * on a LOCAL Supabase seeded by supabase/seed.sql. See tests/e2e/README.md.
 *
 * Every failure keeps a trace (step-by-step DOM, network and console you can
 * replay with `npx playwright show-trace`), a video and a screenshot, and the
 * HTML report links them — the record of what the test did and saw.
 */
import { defineConfig, devices } from '@playwright/test'

// Not 3000: never reuse an `npm run dev` that may point at the production database.
const PORT = Number(process.env.E2E_PORT ?? 3100)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`
const isCI = !!process.env.CI

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
    ...(isCI ? [['github'] as ['github']] : []),
  ],
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'api',
      testMatch: /api\/.*\.spec\.ts/,
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      testMatch: /flows\/guest-menu\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop',
      testMatch: /flows\/staff\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  // Locally: `npm run test:e2e` starts the dev server against the local stack.
  // CI starts the production build itself and sets E2E_SKIP_WEBSERVER.
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: process.env.E2E_SERVER_COMMAND ?? `npm run dev -- --port ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !isCI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
})
