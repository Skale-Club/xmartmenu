/**
 * Unit tests (tests/unit): pure logic, node environment, no DOM, no database.
 * The app and database layers are covered by Playwright (tests/e2e).
 *
 *   npm test               run once
 *   npm run test:coverage  + coverage report in coverage/ (HTML + summary)
 *
 * CI runs both and publishes the reports (.github/workflows/ci.yml).
 */
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'test-results/unit-junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/components/menu/*.ts'],
      exclude: ['**/*.test.ts', 'src/lib/supabase/**'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
})
