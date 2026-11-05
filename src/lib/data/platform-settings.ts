import { AdminMenuError, type AdminMenuQuery } from './admin-menus'
import { ownedModeActive, type OwnedModeEnv } from './owned-mode'

/**
 * `public.platform_settings` is a one-row table (unique index on `(true)`).
 * Every read and write of it follows the same source switch: legacy Supabase
 * client while no OWNED_* flag is on, the application's own PostgreSQL after.
 * In owned mode a write never reaches Supabase, whatever fails on the way.
 */
export const platformSettingsOwned = (env: OwnedModeEnv = process.env) => ownedModeActive(env)

/** Columns a caller may project by name (sorted into the SELECT in this order). */
export const PLATFORM_SETTING_COLUMNS = [
  'id', 'app_name', 'brand_name', 'default_primary_color', 'default_accent_color', 'cta_color', 'menu_footer_brand',
  'landing', 'seo_title', 'seo_description', 'favicon_url', 'twitter_handle', 'social_links', 'legal', 'updated_at',
] as const
export type PlatformSettingColumn = (typeof PLATFORM_SETTING_COLUMNS)[number]
export type PlatformSettingsRow = Record<string, unknown>

/** The superadmin form's writable fields: the same list the legacy route accepted. */
export const PLATFORM_WRITABLE_COLUMNS = [
  'app_name', 'brand_name', 'default_primary_color', 'default_accent_color', 'cta_color', 'menu_footer_brand',
  'landing', 'seo_title', 'seo_description', 'favicon_url', 'legal',
] as const

/** Same advisory lock as the native MCP `update_platform_settings`, so writers serialize. */
export const PLATFORM_SETTINGS_LOCK = 'xmartmenu-mcp-platform'

const JSON_COLUMNS = new Set<string>(['landing', 'legal', 'social_links'])
// NOT NULL in the schema: a null would only come back as an opaque 23502.
const REQUIRED_TEXT = new Set<string>(['app_name', 'brand_name', 'default_primary_color', 'default_accent_color', 'cta_color', 'menu_footer_brand'])
// The public appearance reader rejects values beyond these, so refuse to store them.
const MAX_LENGTH: Record<string, number> = { cta_color: 64, favicon_url: 4096, seo_description: 10_000, seo_title: 1_000 }
const DEFAULT_MAX_LENGTH = 500
const MAX_JSON_BYTES = 1_000_000

const invalid = () => new AdminMenuError(400, 'Invalid platform settings')

function projection(columns: readonly PlatformSettingColumn[]) {
  if (!columns.length || columns.some(column => !(PLATFORM_SETTING_COLUMNS as readonly string[]).includes(column))) throw new Error('Invalid platform settings projection')
  return PLATFORM_SETTING_COLUMNS.filter(column => columns.includes(column)).join(', ')
}

/** `'*'` returns the whole row, as `select('*')` did, including columns added later. */
export async function readPlatformSettingsRow(query: AdminMenuQuery, columns: readonly PlatformSettingColumn[] | '*'): Promise<PlatformSettingsRow | null> {
  const sql = columns === '*'
    ? 'SELECT to_jsonb(p) AS row FROM public.platform_settings p LIMIT 2'
    : `SELECT ${projection(columns)} FROM public.platform_settings LIMIT 2`
  const { rows } = await query(sql)
  if (rows.length > 1) throw new Error('Platform settings singleton violation')
  if (!rows[0]) return null
  if (columns !== '*') return rows[0]
  const row = rows[0].row
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid platform settings row')
  return row as PlatformSettingsRow
}

/** Only known fields survive, exactly like the legacy allow-list loop. Throws AdminMenuError(400). */
export function parsePlatformSettingsPatch(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
  const input = body as Record<string, unknown>, patch: Record<string, unknown> = {}
  for (const column of PLATFORM_WRITABLE_COLUMNS) {
    if (!Object.hasOwn(input, column)) continue
    const value = input[column]
    if (JSON_COLUMNS.has(column)) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > MAX_JSON_BYTES) throw invalid()
    } else if (value === null) {
      if (REQUIRED_TEXT.has(column)) throw invalid()
    } else if (typeof value !== 'string' || value.length > (MAX_LENGTH[column] ?? DEFAULT_MAX_LENGTH)) throw invalid()
    patch[column] = value
  }
  return patch
}

/**
 * Update the single row, or create it when the restore left none. Run inside a
 * write transaction; the lock makes the read-then-write atomic across writers.
 */
export async function writePlatformSettingsRow(query: AdminMenuQuery, patch: Record<string, unknown>): Promise<PlatformSettingsRow> {
  const fields = Object.keys(patch)
  if (fields.some(field => !(PLATFORM_WRITABLE_COLUMNS as readonly string[]).includes(field))) throw invalid()
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [PLATFORM_SETTINGS_LOCK])
  const existing = (await query('SELECT id FROM public.platform_settings LIMIT 2')).rows
  if (existing.length > 1) throw new Error('Platform settings singleton violation')
  const values = fields.map(field => (JSON_COLUMNS.has(field) ? JSON.stringify(patch[field]) : patch[field]))
  const placeholder = (field: string, index: number) => (JSON_COLUMNS.has(field) ? `$${index}::jsonb` : `$${index}`)
  const result = existing[0]
    ? await query(`UPDATE public.platform_settings SET ${[...fields.map((field, index) => `${field}=${placeholder(field, index + 2)}`), 'updated_at=now()'].join(', ')}
        WHERE id=$1 RETURNING to_jsonb(platform_settings) AS row`, [existing[0].id, ...values])
    : fields.length
      ? await query(`INSERT INTO public.platform_settings(${fields.join(', ')}) VALUES(${fields.map((field, index) => placeholder(field, index + 1)).join(', ')})
          RETURNING to_jsonb(platform_settings) AS row`, values)
      : await query('INSERT INTO public.platform_settings DEFAULT VALUES RETURNING to_jsonb(platform_settings) AS row')
  const row = result.rows[0]?.row
  if (result.rows.length !== 1 || !row || typeof row !== 'object' || Array.isArray(row)) throw new AdminMenuError(503, 'Platform settings could not be saved')
  return row as PlatformSettingsRow
}
