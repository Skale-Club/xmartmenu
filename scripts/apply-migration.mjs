// Compatibility entry point: use the canonical ledger, transactions and guards.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
const args = process.argv.slice(2)
const files = args.filter(arg => !arg.startsWith('--'))
const flags = args.filter(arg => arg.startsWith('--'))
const known = new Set(readdirSync(new URL('../supabase/migrations/', import.meta.url)))
if (!files.length || files.some(file => !known.has(file) || !file.endsWith('.sql'))) {
  console.error('Usage: node scripts/apply-migration.mjs <existing-file.sql> [--apply] [--target=development|production]')
  process.exitCode = 1
} else {
  for (const file of files) {
    const result = spawnSync(process.execPath, ['scripts/apply-migrations.mjs', `--only=${file}`, ...flags], { stdio: 'inherit' })
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
  }
}
