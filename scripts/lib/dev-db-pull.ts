import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type pg from 'pg'
import { developmentDatabaseTarget, findProductionProjectRef } from './database-target.mjs'

/**
 * Core of `npm run db:pull`: replace the data of the DEVELOPMENT database with a
 * READ ONLY snapshot of production, in ONE transaction. The SSH/tunnel plumbing lives
 * in scripts/db-pull.ts; everything here works on already-open connections so it can
 * be rehearsed against a disposable PostgreSQL.
 */

/** A single `pg.Client`: the pull drives BEGIN/COMMIT itself, so it needs one session. */
export type Db = pg.Client

/**
 * Public tables whose rows are NEVER copied from production and are kept as the
 * developer has them (sign-in state and short-lived challenges). The migration ledger
 * (`supabase_migrations.schema_migrations`) lives outside `public` and is never
 * touched. Edit this list deliberately; tests pin it.
 */
export const EXCLUDED_TABLES: readonly string[] = [
  'app_sessions',
  'app_identity_challenges',
  'oauth_codes', // short-lived authorization codes; raw_token is a bearer secret
]

/**
 * Secrets that are copied as structure but never as values. The destination gets NULL,
 * or an empty string where the column is NOT NULL. This keeps Telegram bot tokens and
 * webhook secrets and every stored AI provider key (platform, tenant, chat add-on, blog)
 * out of the development database; Stripe and Xphere credentials live in environment
 * variables, which `npm run dev` blanks. Tests pin this list.
 */
export const SCRUBBED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  telegram_settings: ['bot_token', 'approvals_bot_token', 'webhook_secret'],
  platform_ai_settings: ['openrouter_api_key'],
  tenant_ai_settings: ['openrouter_api_key'],
  chat_addon_settings: ['openrouter_api_key', 'audio_api_key'],
  blog_settings: ['openrouter_api_key'],
}

/**
 * The source is the Xmartmenu database imported into the shared PostgreSQL cluster on
 * 2026-11-04. Production still reads its prior data source (Supabase), so this copy is
 * frozen at the import until the application cutover. Flip this to false at the cutover;
 * a test pins it so the change is deliberate.
 */
export const SOURCE_IS_CANDIDATE = true
export const SOURCE_CANDIDATE_NOTICE =
  'SOURCE IS A CANDIDATE: the xmartmenu database on the shared cluster holds the data imported on 2026-11-04 '
  + 'and is NOT updated by production, which still reads its prior data source. Expect stale data.'

export function isExcludedTable(table: string, excluded: readonly string[] = EXCLUDED_TABLES): boolean {
  return excluded.includes(table)
}

export function isScrubbedColumn(table: string, column: string): boolean {
  return SCRUBBED_COLUMNS[table]?.includes(column) ?? false
}

/** Refuse unless the destination is the declared Supabase DEVELOPMENT project. */
export function assertPullDestination(env: NodeJS.ProcessEnv): { url: string; host: string; projectRef: string } {
  if (env.NODE_ENV === 'production') throw new Error('db:pull never runs with NODE_ENV=production.')
  // Refuses unset or mismatched settings, a known production project and any alias fallback.
  const target = developmentDatabaseTarget(env)
  if (findProductionProjectRef(target.databaseUrl)) throw new Error('The pull destination resolves to a production database.')
  return { url: target.databaseUrl, host: target.host, projectRef: target.ref }
}

export interface ColumnInfo {
  column_name: string
  data_type: string
  udt_name: string
  is_generated: string
  identity_generation: string | null
  is_nullable: string
  column_default: string | null
}
export type SchemaMap = Map<string, ColumnInfo[]>

export async function readSchema(client: Db): Promise<SchemaMap> {
  const { rows } = await client.query<ColumnInfo & { table_name: string }>(`
    select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_generated,
               c.identity_generation, c.is_nullable, c.column_default
    from information_schema.columns c
    join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
    order by c.table_name, c.ordinal_position`)
  const map: SchemaMap = new Map()
  for (const { table_name, ...column } of rows) {
    if (!map.has(table_name)) map.set(table_name, [])
    map.get(table_name)!.push(column)
  }
  return map
}

export interface SchemaDifferences {
  /** In production, absent in the destination. */
  missingTables: string[]
  /** `table.column` present in production, absent in the destination. */
  missingColumns: string[]
  /** `table.column (prod type -> dest type)` */
  changedColumns: string[]
  /** Destination-only columns that are NOT NULL without default: production rows cannot fill them. */
  requiredDestinationColumns: string[]
}

export function compareSchemas(
  production: SchemaMap,
  destination: SchemaMap,
  excluded: readonly string[] = EXCLUDED_TABLES,
): SchemaDifferences {
  const diff: SchemaDifferences = { missingTables: [], missingColumns: [], changedColumns: [], requiredDestinationColumns: [] }
  for (const [table, prodColumns] of production) {
    if (isExcludedTable(table, excluded)) continue
    const destColumns = destination.get(table)
    if (!destColumns) { diff.missingTables.push(table); continue }
    const byName = new Map(destColumns.map(c => [c.column_name, c]))
    const prodNames = new Set(prodColumns.map(c => c.column_name))
    for (const column of prodColumns) {
      const other = byName.get(column.column_name)
      if (!other) { diff.missingColumns.push(`${table}.${column.column_name}`); continue }
      if (column.data_type !== other.data_type || column.udt_name !== other.udt_name) {
        diff.changedColumns.push(`${table}.${column.column_name} (${column.udt_name} -> ${other.udt_name})`)
      }
    }
    for (const column of destColumns) {
      if (!prodNames.has(column.column_name) && column.is_generated !== 'ALWAYS' && !column.identity_generation
        && column.is_nullable === 'NO' && column.column_default === null) {
        diff.requiredDestinationColumns.push(`${table}.${column.column_name}`)
      }
    }
  }
  return diff
}

export function hasSchemaDifferences(diff: SchemaDifferences): boolean {
  return Object.values(diff).some(list => list.length > 0)
}

export function describeSchemaDifferences(diff: SchemaDifferences): string {
  const parts: string[] = []
  if (diff.missingTables.length) parts.push(`tables missing in the destination: ${diff.missingTables.join(', ')}`)
  if (diff.missingColumns.length) parts.push(`columns missing in the destination: ${diff.missingColumns.join(', ')}`)
  if (diff.changedColumns.length) parts.push(`columns with a different type: ${diff.changedColumns.join(', ')}`)
  if (diff.requiredDestinationColumns.length) {
    parts.push(`destination-only NOT NULL columns without default: ${diff.requiredDestinationColumns.join(', ')}`)
  }
  return parts.join('; ')
}

interface ForeignKey { child: string; parent: string }

async function readForeignKeys(client: Db): Promise<ForeignKey[]> {
  const { rows } = await client.query<ForeignKey>(`
    select cc.relname as child, pc.relname as parent
    from pg_constraint k
    join pg_class cc on cc.oid = k.conrelid
    join pg_class pc on pc.oid = k.confrelid
    join pg_namespace cn on cn.oid = cc.relnamespace
    join pg_namespace pn on pn.oid = pc.relnamespace
    where k.contype = 'f' and cn.nspname = 'public' and pn.nspname = 'public'`)
  return rows
}

/** Parents before children. Throws on a cycle between different tables. */
export function foreignKeyOrder(tables: string[], keys: ForeignKey[]): string[] {
  const set = new Set(tables)
  const deps = new Map(tables.map(t => [t, new Set<string>()]))
  for (const { child, parent } of keys) if (set.has(child) && set.has(parent) && child !== parent) deps.get(child)!.add(parent)
  const order: string[] = []
  const done = new Set<string>()
  const visit = (table: string, stack: string[]) => {
    if (done.has(table)) return
    if (stack.includes(table)) throw new Error(`foreign key cycle between tables: ${[...stack, table].join(' -> ')}`)
    for (const parent of deps.get(table)!) visit(parent, [...stack, table])
    done.add(table)
    order.push(table)
  }
  for (const table of [...tables].sort()) visit(table, [])
  return order
}

const q = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`

/** Everything that must be emptied together: copied tables + tables whose FK points at them. */
export function truncationSet(copied: string[], allTables: string[], keys: ForeignKey[]): string[] {
  const set = new Set(copied)
  let grew = true
  while (grew) {
    grew = false
    for (const { child, parent } of keys) {
      if (set.has(parent) && !set.has(child) && allTables.includes(child)) { set.add(child); grew = true }
    }
  }
  return [...set]
}

/** JSON backup of every public table of the destination, written to disk (mode 0600). */
export async function backupDestination(dest: Db, backupDir: string, now = new Date()): Promise<string> {
  mkdirSync(backupDir, { recursive: true })
  const file = join(backupDir, `dev-${now.toISOString().replace(/[:.]/g, '-')}.json`)
  const fd = openSync(file, 'w', 0o600)
  try {
    writeSync(fd, `{"takenAt":${JSON.stringify(now.toISOString())},"tables":{`)
    const tables = [...(await readSchema(dest)).keys()].sort()
    let first = true
    for (const table of tables) {
      writeSync(fd, `${first ? '' : ','}${JSON.stringify(table)}:[`)
      first = false
      const { rows } = await dest.query<{ j: string }>(`select row_to_json(t)::text as j from ${q(table)} t`)
      writeSync(fd, rows.map(r => r.j).join(','))
      writeSync(fd, ']')
    }
    writeSync(fd, '}}')
  } finally {
    closeSync(fd)
  }
  return file
}

export interface PullOptions {
  prod: Db
  dest: Db
  /** Destination connection string, only used for the production-ref refusal. */
  destUrl: string
  excluded?: readonly string[]
  /** Allow the copy to run user triggers when `session_replication_role` cannot be set. */
  allowTriggers?: boolean
  log?: (message: string) => void
}

export interface PullResult {
  copied: Record<string, number>
  /** Emptied but not refilled (excluded/dest-only tables that depend on copied ones). */
  truncated: string[]
  /** Left exactly as they were. */
  kept: string[]
  /** `table.column` whose production value was replaced by NULL/empty. */
  scrubbed: string[]
  triggersDisabled: boolean
}

const CHUNK = 500

/**
 * Replace destination data with production data. Production is read inside one
 * REPEATABLE READ READ ONLY transaction; the destination is rewritten inside one
 * transaction, so any error leaves it untouched. Schema differences abort BEFORE the
 * destination is modified. Both clients must be a single `pg.Client`.
 */
export async function pullDatabase(options: PullOptions): Promise<PullResult> {
  const { prod, dest, destUrl, excluded = EXCLUDED_TABLES, allowTriggers = false } = options
  const log = options.log ?? (() => undefined)
  if (findProductionProjectRef(destUrl)) throw new Error('Refusing: the destination resolves to a production database.')

  await prod.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  let destOpen = false
  try {
    const prodSchema = await readSchema(prod)
    const destSchema = await readSchema(dest)
    const diff = compareSchemas(prodSchema, destSchema, excluded)
    if (hasSchemaDifferences(diff)) {
      throw new Error(`schema mismatch, nothing was changed: ${describeSchemaDifferences(diff)}. Apply the repo migrations to the destination (npm run db:pull does this) or fix the drift first.`)
    }

    const copied = [...prodSchema.keys()].filter(t => destSchema.has(t) && !isExcludedTable(t, excluded))
    const keys = await readForeignKeys(dest)
    const order = foreignKeyOrder(copied, keys)
    const allDest = [...destSchema.keys()]
    const truncate = truncationSet(copied, allDest, keys)
    const truncatedOnly = truncate.filter(t => !copied.includes(t))
    const kept = allDest.filter(t => !truncate.includes(t))
    const selfReferencing = new Set(keys.filter(k => k.child === k.parent).map(k => k.child))
    const scrubbed: string[] = []

    await dest.query('BEGIN')
    destOpen = true
    let triggersDisabled = false
    await dest.query('SAVEPOINT replica_role')
    try {
      await dest.query('SET LOCAL session_replication_role = replica')
      triggersDisabled = true
      await dest.query('RELEASE SAVEPOINT replica_role')
    } catch {
      await dest.query('ROLLBACK TO SAVEPOINT replica_role')
      if (!allowTriggers) {
        throw new Error('this role cannot disable triggers (session_replication_role); user triggers and database webhooks could fire with real data. Re-run with --allow-triggers only if the destination has none.')
      }
      log('! user triggers will fire during the copy (--allow-triggers)')
    }

    // No CASCADE: an unexpected dependent fails and rolls back instead of being wiped.
    await dest.query(`TRUNCATE ${truncate.map(q).join(', ')} RESTART IDENTITY`)

    const counts: Record<string, number> = {}
    for (const table of order) {
      const destColumns = destSchema.get(table)!
      const prodNames = new Set(prodSchema.get(table)!.map(c => c.column_name))
      const columns = destColumns.filter(c => prodNames.has(c.column_name) && c.is_generated !== 'ALWAYS')
      const names = columns.map(c => q(c.column_name)).join(', ')
      // A scrubbed column is still filled (NOT NULL), but never with the production value.
      const selects = columns.map(c => {
        if (!isScrubbedColumn(table, c.column_name)) return q(c.column_name)
        scrubbed.push(`${table}.${c.column_name}`)
        const blank = c.is_nullable === 'NO' ? "''" : 'null'
        return `${blank}::${c.data_type === 'USER-DEFINED' ? q(c.udt_name) : c.udt_name} as ${q(c.column_name)}`
      }).join(', ')
      const overriding = destColumns.some(c => c.identity_generation === 'ALWAYS') ? 'OVERRIDING SYSTEM VALUE ' : ''
      // row_to_json(...)::text keeps bigint/numeric/array/jsonb values byte-exact; the
      // destination type system does the parsing (json_populate_recordset).
      const { rows } = await prod.query<{ j: string }>(`select row_to_json(t)::text as j from ${q(table)} t`)
      const size = selfReferencing.has(table) ? Math.max(rows.length, 1) : CHUNK // self FKs need one statement
      for (let i = 0; i < rows.length; i += size) {
        const payload = `[${rows.slice(i, i + size).map(r => r.j).join(',')}]`
        await dest.query(
          `INSERT INTO ${q(table)} (${names}) ${overriding}SELECT ${selects} FROM json_populate_recordset(null::${q(table)}, $1::json)`,
          [payload],
        )
      }
      counts[table] = rows.length
    }

    // Serial/identity counters continue after the copied ids.
    for (const table of copied) {
      for (const column of destSchema.get(table)!) {
        const { rows } = await dest.query<{ seq: string | null }>(
          "select pg_get_serial_sequence(format('%I.%I', 'public', $1::text), $2::text) as seq", [table, column.column_name])
        const seq = rows[0]?.seq
        if (seq) await dest.query(`select setval($1, coalesce((select max(${q(column.column_name)}) from ${q(table)}), 0) + 1, false)`, [seq])
      }
    }

    await dest.query('COMMIT')
    destOpen = false
    return { copied: counts, truncated: truncatedOnly, kept, scrubbed, triggersDisabled }
  } catch (error) {
    if (destOpen) await dest.query('ROLLBACK').catch(() => undefined)
    throw new Error(`pull aborted, destination unchanged: ${(error as Error).message}`)
  } finally {
    await prod.query('ROLLBACK').catch(() => undefined) // read-only: nothing to commit
  }
}
