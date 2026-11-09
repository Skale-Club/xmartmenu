import { fileURLToPath } from 'node:url'
import { developmentConfig } from './database-target.mjs'

/**
 * Provider settings that development never inherits: payments (Stripe, Connect), CRM
 * (Xphere), Telegram, every AI provider, the QStash workers, the Redis rate limiter,
 * Sentry and the cron secret. Blanked here and, as a second lock, unreachable because
 * the outbound network guard destroys any connection that is not loopback/dev database.
 */
export const BLANKED_PROVIDER_ENV = [
  // Payments
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_CLIENT_ID', 'STRIPE_CHAT_ADDON_PRICE_ID',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  // CRM
  'XPHERE_API_URL', 'XPHERE_API_KEY', 'XPHERE_ORG_ID', 'XPHERE_WORKER_URL', 'NATIVE_TENANT_EFFECTS_WORKER_URL',
  // Telegram
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET',
  // AI
  'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'BLOG_GEMINI_API_KEY', 'ANTHROPIC_API_KEY',
  // Queues, rate limiting, error reporting, scheduled jobs
  'QSTASH_TOKEN', 'QSTASH_URL', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN', 'CRON_SECRET',
]

/** Every OWNED_* boundary flag production sets; DEV_OWNED_STACK turns them all on in development. */
export const OWNED_FLAGS = [
  'OWNED_AUTH_ENABLED', 'OWNED_PLATFORM_APPEARANCE_ENABLED', 'OWNED_PUBLIC_MENU_ENABLED', 'OWNED_ADMIN_MENUS_ENABLED',
  'OWNED_ADMIN_CATALOG_ENABLED', 'OWNED_ORDER_DATA_ENABLED', 'OWNED_PAYMENT_DATA_ENABLED', 'OWNED_ACCOUNT_ADMIN_ENABLED',
  'OWNED_TENANT_ADMIN_ENABLED', 'OWNED_TENANT_EFFECTS_ENABLED', 'OWNED_MCP_ENABLED', 'OWNED_REGISTRATION_ENABLED',
  'OWNED_ONBOARDING_ENABLED', 'OWNED_ADMIN_WAITER_CALLS_ENABLED', 'OWNED_BLOG_ENABLED',
]

/**
 * `DEV_OWNED_STACK=true` (owner decision 2026-11-09): localhost runs like production, on the owned sign-in and
 * every owned boundary, against the dev database. One switch on purpose: branches without this code ignore it,
 * so a shared .env.local never breaks them. Google sign-in uses the shared project (as Xpot does), and phone
 * sign-in uses the development code route instead of SMS (src/app/api/identity/dev-phone/route.ts).
 * Needs DEV_GOOGLE_AUTH_WEB_API_KEY; the origin follows the dev server port.
 * @param {Record<string, string | undefined>} env
 * @param {string} port
 */
export function applyOwnedStack(env, port) {
  if (env.DEV_OWNED_STACK !== 'true') return env
  for (const flag of OWNED_FLAGS) env[flag] = 'true'
  env.GOOGLE_AUTH_ENABLED = 'true'
  env.DEV_GOOGLE_AUTH_SHARED_PROJECT = 'true'
  env.DEV_GOOGLE_AUTH_PROJECT_ID ||= 'skaleclub'
  env.DEV_GOOGLE_AUTH_PROJECT_NUMBER ||= '937861185231'
  env.IDENTITY_ORIGIN = `http://localhost:${port}`
  return env
}

/** Read-only Google identity hosts development may reach when Google sign-in is on. */
export const IDENTITY_HOSTS = ['identitytoolkit.googleapis.com', 'www.googleapis.com']

/** `node --import` flag that installs the outbound guard in every process of the dev server. */
export function guardImportOption() {
  return `--import=${new URL('./dev-outbound-preload.mjs', import.meta.url).href}`
}

/**
 * Environment of the development server: the explicit development project only, no
 * provider credentials, and the fail-closed network guard preloaded.
 * @param {Record<string, string | undefined>} [base]
 */
export function developmentEnvironment(base = process.env, port = '3000') {
  base = applyOwnedStack({ ...base }, port)
  const dev = developmentConfig(base)
  const env = /** @type {Record<string, string | undefined>} */ ({
    ...base,
    NODE_ENV: 'development',
    DATABASE_URL: dev.databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: dev.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: dev.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: dev.serviceKey,
    SUPABASE_PROJECT_REF: dev.ref,
    XPHERE_SYNC_ENABLED: 'false',
    STORAGE_PROVIDER: 'supabase',
  })
  for (const key of BLANKED_PROVIDER_ENV) env[key] = ''
  // The dev database is reached with TLS verify-full (database-target.mjs). Node does not ship Supabase's root
  // CA, so the dev server trusts that one pinned certificate (the same file the ops scripts use) instead of
  // weakening verification.
  if (!env.NODE_EXTRA_CA_CERTS) env.NODE_EXTRA_CA_CERTS = fileURLToPath(new URL('../ops/fixtures/supabase-prod-ca.crt', import.meta.url))
  // Google sign-in on localhost (GOOGLE_AUTH_ENABLED): the server reads the identity project's public
  // config and the token signing keys. Those two read-only hosts only; nothing else is opened.
  if (base.GOOGLE_AUTH_ENABLED === 'true') {
    const hosts = new Set((env.DEV_OUTBOUND_ALLOW_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean))
    for (const host of IDENTITY_HOSTS) hosts.add(host)
    env.DEV_OUTBOUND_ALLOW_HOSTS = [...hosts].join(',')
  }
  const existing = (base.NODE_OPTIONS ?? '').split(/\s+/).filter(option => option && !option.includes('dev-outbound-preload'))
  env.NODE_OPTIONS = [...existing, guardImportOption()].join(' ')
  return env
}
