#!/usr/bin/env node
/**
 * Runs the Playwright suite against the LOCAL Supabase stack.
 *
 *   npm run db:local        # once: starts Supabase in Docker (migrations + seed)
 *   npm run test:e2e        # this script; extra args go to Playwright
 *   npm run test:e2e -- --project=api --headed
 *
 * Reads the local URL and keys from `supabase status`, so the app server and
 * the tests both talk to the local database — never to the project in
 * .env.local (process env wins over .env files in Next.js).
 */
import { execFileSync, spawn } from 'node:child_process'

function localStatus() {
  try {
    const out = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    return Object.fromEntries(
      out.split(/\r?\n/)
        .map(line => line.match(/^([A-Z_]+)="?(.*?)"?$/))
        .filter(Boolean)
        .map(m => [m[1], m[2]]),
    )
  } catch {
    console.error('Local Supabase is not running. Start it with: npm run db:local (needs Docker).')
    process.exit(1)
  }
}

const status = localStatus()
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  // Test-only values: encryption for chat keys, no external services.
  CHAT_ADDON_ENCRYPTION_KEY: process.env.CHAT_ADDON_ENCRYPTION_KEY ?? '0'.repeat(64),
  // Lets the fixtures drop the cached public menu after direct DB writes.
  MENU_REVALIDATE_SECRET: process.env.MENU_REVALIDATE_SECRET ?? 'e2e-revalidate-secret',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3100',
  OPENROUTER_API_KEY: '',
  // AI calls go to the fake OpenRouter Playwright starts (tests/e2e/mock-openrouter.mjs).
  OPENROUTER_BASE_URL: 'http://localhost:3199/api/v1',
  UPSTASH_REDIS_REST_URL: '',
  UPSTASH_REDIS_REST_TOKEN: '',
  STRIPE_SECRET_KEY: '',
  NEXT_PUBLIC_SENTRY_DSN: '',
  SENTRY_DSN: '',
}

const child = spawn('npx', ['playwright', 'test', ...process.argv.slice(2)], { env, stdio: 'inherit', shell: process.platform === 'win32' })
child.on('exit', code => process.exit(code ?? 1))
