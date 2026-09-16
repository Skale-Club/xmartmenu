/**
 * Unit-test runner (autoblog-parity XM-10).
 *
 * This repo had no test runner at all. It gains one here rather than shipping
 * the blog's pure modules — the editorial rotation, the HTML allowlist, the
 * retry classifier, the RSS ranker — with nothing guarding them, because those
 * are exactly the pieces where a silent regression is expensive and invisible.
 *
 * Deliberately narrow: `tests/unit` only, node environment, no DOM, no setup
 * file. It does not pretend to cover the app, and it is not wired into CI by
 * this change — run it with `npm test`.
 */
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
