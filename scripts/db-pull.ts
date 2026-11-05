// npm run db:pull — replace the DEVELOPMENT database (Supabase) with a snapshot of the
// Xmartmenu database. `npm run dev` never does this on its own; only this explicit
// command does.
//
// SOURCE CAVEAT: the source is the `xmartmenu` database imported into the shared
// PostgreSQL cluster (container e12scyfsrp822dag7m9wwd4x) on 2026-11-04. Production still
// reads its prior data source, so this copy is frozen at the import (see
// SOURCE_CANDIDATE_NOTICE in scripts/lib/dev-db-pull.ts). The command works regardless
// and prints that notice on every run.
//
// 1. Over SSH, find the container's private address and credentials. They stay in
//    memory; the database is never exposed.
// 2. Open a temporary SSH tunnel (127.0.0.1 only) and refuse any destination that is not
//    the declared Supabase development project (DEV_*), or that is a known production
//    project.
// 3. Save a JSON backup of the destination (../xmartmenu-db-backups/).
// 4. Bring the destination schema to the repo's state with the SQL migrations
//    (scripts/apply-migrations.mjs --apply; never db:push) and compare it with the
//    source. Any difference aborts before data moves.
// 5. Read the source in one READ ONLY snapshot and replace the destination data in ONE
//    transaction: any error leaves the destination untouched. Sign-in state stays local
//    (EXCLUDED_TABLES); Telegram and AI provider secrets are never copied
//    (SCRUBBED_COLUMNS).
// 6. Close the tunnel.
//
// Settings (none secret), in .env.local / .env:
//   XMARTMENU_PROD_SSH            ssh target of the host that runs the cluster (e.g. root@<host>)
//   XMARTMENU_PROD_DB_CONTAINER   PostgreSQL container (default below)
//   XMARTMENU_PROD_DB_NAME        database inside the cluster (default: xmartmenu)
//   DEV_DATABASE_URL, DEV_SUPABASE_PROJECT_REF   the destination, as for npm run dev
// Flags: --allow-triggers  copy even if user triggers cannot be disabled.

import dotenv from 'dotenv'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { resolve } from 'node:path'
import pg from 'pg'
import { installDevOutboundGuard } from './lib/dev-outbound-guard.mjs'
import {
  assertPullDestination, backupDestination, EXCLUDED_TABLES, pullDatabase, SCRUBBED_COLUMNS,
  SOURCE_CANDIDATE_NOTICE, SOURCE_IS_CANDIDATE,
} from './lib/dev-db-pull'

dotenv.config({ path: ['.env.local', '.env'], quiet: true })

const SSH_TARGET = process.env.XMARTMENU_PROD_SSH
const CONTAINER = process.env.XMARTMENU_PROD_DB_CONTAINER || 'e12scyfsrp822dag7m9wwd4x'
const SOURCE_DB = process.env.XMARTMENU_PROD_DB_NAME || 'xmartmenu'
const TUNNEL_PORT = 55435
const BACKUP_DIR = resolve(process.cwd(), '..', 'xmartmenu-db-backups')

function fail(message: string): never {
  throw new Error(message)
}

function ssh(remote: string, what: string): string {
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SSH_TARGET!, remote], { encoding: 'utf8' })
  if (r.status !== 0) fail(`${what}: ${(r.stderr || '').trim().split('\n').pop() || `ssh exited with ${r.status}`}`)
  return r.stdout
}

/** Private address + credentials of the cluster container, read on the server. */
function sourceTarget() {
  if (!/^[a-z0-9]+$/.test(CONTAINER)) fail('XMARTMENU_PROD_DB_CONTAINER must be a plain container name')
  if (!/^[a-z0-9_]+$/.test(SOURCE_DB)) fail('XMARTMENU_PROD_DB_NAME must be a plain database name')
  const ip = ssh(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' ${CONTAINER}`, 'finding the source database')
    .trim().split(/\s+/)[0]
  if (!ip) fail(`container ${CONTAINER} has no network address`)
  // Single quotes: the variables expand inside the container, not on this machine.
  const [user, password] = ssh(`docker exec ${CONTAINER} sh -c 'printf "%s\\n%s" "$POSTGRES_USER" "$POSTGRES_PASSWORD"'`, 'reading the source database settings').split('\n')
  if (!user) fail('could not read the source database user')
  // The cluster also holds the Xmail database: the name is never taken from the container.
  return { ip, url: `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password ?? '')}@127.0.0.1:${TUNNEL_PORT}/${SOURCE_DB}` }
}

async function openTunnel(ip: string) {
  const tunnel = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-N', '-L', `127.0.0.1:${TUNNEL_PORT}:${ip}:5432`, SSH_TARGET!], { stdio: 'ignore' })
  for (let i = 0; i < 40; i++) {
    if (tunnel.exitCode !== null) fail(`ssh tunnel closed (port ${TUNNEL_PORT} busy?)`)
    const open = await new Promise<boolean>(done => {
      const sock = createConnection(TUNNEL_PORT, '127.0.0.1')
      sock.once('connect', () => { sock.destroy(); done(true) })
      sock.once('error', () => done(false))
    })
    if (open) return tunnel
    await new Promise(r => setTimeout(r, 250))
  }
  tunnel.kill()
  return fail('ssh tunnel did not open')
}

function client(url: string, tls: boolean) {
  const ca = process.env.DEV_DATABASE_CA_FILE
  return new pg.Client({
    // pg would read sslmode as verify-full; TLS is configured below instead.
    connectionString: url.replace(/[?&]sslmode=[^&]*/g, m => (m.startsWith('?') ? '?' : '')),
    ssl: tls ? (ca ? { ca: readFileSync(ca, 'utf8') } : { rejectUnauthorized: true }) : false,
  })
}

/** Level the destination schema with the repo's SQL migrations, in a child process. */
function migrateDestination() {
  console.log('→ applying pending SQL migrations to the development database ...')
  const r = spawnSync(process.execPath, ['scripts/apply-migrations.mjs', '--apply'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  })
  if (r.status !== 0) fail(`migrations failed (exit ${r.status}); the data was not touched. A development database with an empty migration ledger needs a baseline first (docs/dev-database-pull.md).`)
}

async function main() {
  console.warn(`! ${SOURCE_IS_CANDIDATE ? SOURCE_CANDIDATE_NOTICE : 'Source: the Xmartmenu production database.'}`)
  if (!SSH_TARGET) fail('set XMARTMENU_PROD_SSH (the ssh target of the host that runs the cluster)')
  const destination = assertPullDestination(process.env)
  // The pull itself only needs loopback (the tunnel) and the development database.
  installDevOutboundGuard({ ...process.env, NODE_ENV: 'development' })
  console.log(`→ destination: development project ${destination.projectRef} (${destination.host})`)

  const dest = client(destination.url, true)
  await dest.connect()
  try {
    console.log('→ backing up the development database ...')
    console.log(`✓ backup ${await backupDestination(dest, BACKUP_DIR)}`)
  } finally {
    await dest.end()
  }

  migrateDestination()

  console.log(`→ connecting to the source through ${SSH_TARGET} ...`)
  const target = sourceTarget()
  const tunnel = await openTunnel(target.ip)
  const prod = client(target.url, false)
  const fresh = client(destination.url, true)
  try {
    await prod.connect()
    await fresh.connect()
    const result = await pullDatabase({
      prod,
      dest: fresh,
      destUrl: destination.url,
      allowTriggers: process.argv.includes('--allow-triggers'),
      log: m => console.warn(m),
    })
    const rows = Object.entries(result.copied).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`)
    console.log(`✓ copied ${rows.length} tables with data: ${rows.join(' ')}`)
    if (result.truncated.length) console.log(`✓ emptied dependents (not refilled): ${result.truncated.join(', ')}`)
    console.log(`✓ secrets blanked: ${result.scrubbed.join(', ') || '-'}`)
    console.log(`✓ kept local: ${result.kept.join(', ') || '-'} (excluded by rule: ${EXCLUDED_TABLES.join(', ')})`)
    console.log(`✓ done. Scrub rules: ${Object.keys(SCRUBBED_COLUMNS).join(', ')}. npm run dev has no payments, CRM, Telegram or AI.`)
    if (SOURCE_IS_CANDIDATE) console.warn(`! ${SOURCE_CANDIDATE_NOTICE}`)
  } finally {
    await prod.end().catch(() => undefined)
    await fresh.end().catch(() => undefined)
    tunnel.kill()
  }
}

main().catch(e => {
  console.error(`✗ ${(e as Error).message}`)
  process.exit(1)
})
