import { readFileSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const dotenv = require('dotenv')

// Load .env.local directly since this script runs outside Next.js
try {
  const envLocal = readFileSync('./.env.local', 'utf8')
  envLocal.split('\n').forEach((line) => {
    const [key, ...valueParts] = line.split('=')
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim()
      if (!process.env[key]) process.env[key] = value
    }
  })
} catch {
  // .env.local not found, rely on environment
}

import { DATABASE_URL } from './.env.local'

async function applyMigration() {
  if (!DATABASE_URL) {
    console.error('DATABASE_URL not found in .env.local')
    process.exit(1)
  }

  const migration = readFileSync('./supabase/migrations/029_custom_domain.sql', 'utf8')

  const response = await fetch(DATABASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sql',
      // Supabase direct SQL — use service role key in header if needed
    },
    body: migration,
  })

  if (!response.ok) {
    const text = await response.text()
    console.error('Migration failed:', text)
    process.exit(1)
  }

  console.log('Migration 029 applied successfully')
}

applyMigration()
