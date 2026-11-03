export interface PlatformAppearance { cta_color: string | null; favicon_url: string | null }
export type AppearanceQuery = (text: string) => Promise<{ rows: unknown[] }>

/** Two public fields only; no tenant, landing, integration or identity data. */
export async function readPlatformAppearance(query: AppearanceQuery): Promise<PlatformAppearance | null> {
  try {
    const result = await query('SELECT cta_color, favicon_url FROM public.platform_settings LIMIT 2')
    if (result.rows.length > 1) throw new Error('Singleton violation')
    if (result.rows.length === 0) return null
    const row = result.rows[0] as PlatformAppearance | null
    if (!row || typeof row !== 'object'
      || (row.cta_color !== null && (typeof row.cta_color !== 'string' || row.cta_color.length > 64))
      || (row.favicon_url !== null && (typeof row.favicon_url !== 'string' || row.favicon_url.length > 4096))) throw new Error('Invalid appearance')
    return { cta_color: row.cta_color, favicon_url: row.favicon_url }
  } catch { throw new Error('Platform appearance is unavailable') }
}

/** Selection happens before either adapter starts. Own failures never read legacy. */
export function selectPlatformAppearance(env: Record<string, string | undefined>, readers: {
  owned: () => Promise<PlatformAppearance | null>
  legacy: () => Promise<PlatformAppearance | null>
}) {
  return env.OWNED_PLATFORM_APPEARANCE_ENABLED === 'true' ? readers.owned() : readers.legacy()
}
