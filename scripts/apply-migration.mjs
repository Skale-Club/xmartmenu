// Generic migration runner: applies one or more migration files by name.
//   node scripts/apply-migration.mjs 051_awaiting_payment_status.sql 052_plan_stripe_prices.sql
// Loads DATABASE_URL from .env.local (same as apply-migration-032.mjs).
import pg from 'pg'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  const envLocal = readFileSync(join(__dirname, '../.env.local'), 'utf8')
  envLocal.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eq = trimmed.indexOf('=')
    if (eq < 1) return
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  })
} catch {}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node scripts/apply-migration.mjs <file.sql> [more.sql...]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing — set it in .env.local')
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

try {
  await client.connect()
  for (const f of files) {
    const sql = readFileSync(join(__dirname, '../supabase/migrations/', f), 'utf8')
    console.log(`Applying ${f}...`)
    await client.query(sql)
    console.log(`  ✓ ${f} applied`)
  }
} catch (err) {
  console.error('Migration failed:', err.message)
  process.exit(1)
} finally {
  await client.end()
}
