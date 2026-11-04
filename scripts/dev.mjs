import dotenv from 'dotenv'
import { spawn } from 'node:child_process'
import { developmentConfig } from './lib/database-target.mjs'

dotenv.config({ path: ['.env.local', '.env'], quiet: true })
try {
  const dev = developmentConfig()
  const env = { ...process.env, NODE_ENV: 'development', DATABASE_URL: dev.databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: dev.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: dev.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: dev.serviceKey, SUPABASE_PROJECT_REF: dev.ref,
    // Do not inherit production integration credentials into a local writer.
    XPHERE_SYNC_ENABLED: 'false', QSTASH_TOKEN: '', STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '', OPENROUTER_API_KEY: '', CRON_SECRET: '',
    STORAGE_PROVIDER: 'supabase' }
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', ...process.argv.slice(2)], { stdio: 'inherit', env })
  child.on('error', () => { console.error('Development server failed to start'); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
