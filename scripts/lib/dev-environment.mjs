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

/** `node --import` flag that installs the outbound guard in every process of the dev server. */
export function guardImportOption() {
  return `--import=${new URL('./dev-outbound-preload.mjs', import.meta.url).href}`
}

/**
 * Environment of the development server: the explicit development project only, no
 * provider credentials, and the fail-closed network guard preloaded.
 * @param {Record<string, string | undefined>} [base]
 */
export function developmentEnvironment(base = process.env) {
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
  const existing = (base.NODE_OPTIONS ?? '').split(/\s+/).filter(option => option && !option.includes('dev-outbound-preload'))
  env.NODE_OPTIONS = [...existing, guardImportOption()].join(' ')
  return env
}
