import pg from 'pg'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, '../supabase/migrations/028_profiles_indices.sql'), 'utf8')

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

try {
  await client.connect()
  console.log('Connected. Applying migration 028...')
  await client.query(sql)
  console.log('Migration 028 applied successfully.')
} catch (err) {
  console.error('Migration failed:', err.message)
  process.exit(1)
} finally {
  await client.end()
}
