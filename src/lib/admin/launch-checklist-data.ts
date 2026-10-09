import type { SupabaseClient } from '@supabase/supabase-js'
import { getCanonicalUrl } from '@/lib/seo'
import {
  isLaunchChecklistKey,
  type LaunchChecklistEntry,
  type LaunchChecklistResponse,
} from '@/lib/launch-checklist'
import { deriveLaunchChecklistSignals } from '@/lib/admin/launch-checklist-signals'

/**
 * PostgREST answers a query on a table that does not exist yet with
 * PGRST205 ("not in the schema cache"); Postgres itself with 42P01.
 */
export function isMissingLaunchChecklistTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

interface TenantRow {
  id: string
  name: string
  slug: string
  is_active: boolean
  custom_domain: string | null
  custom_domain_verified: boolean
}

interface SettingsRow {
  tenant_id: string
  seo_title: string | null
  seo_description: string | null
  seo_og_image_url: string | null
  seo_noindex: boolean | null
  logo_url: string | null
  phone: string | null
  address: string | null
  city: string | null
  latitude: number | null
}

interface TickRow {
  tenant_id: string
  item_key: string
  status: LaunchChecklistEntry['status']
  note: string
  updated_by: string | null
  updated_at: string
}

/** Every restaurant with its launch-checklist ticks and detected signals. Service role only. */
export async function loadLaunchChecklist(service: SupabaseClient): Promise<LaunchChecklistResponse> {
  const [tenantsRes, settingsRes, ticksRes] = await Promise.all([
    service.from('tenants').select('id, name, slug, is_active, custom_domain, custom_domain_verified').order('name'),
    service.from('tenant_settings').select('tenant_id, seo_title, seo_description, seo_og_image_url, seo_noindex, logo_url, phone, address, city, latitude'),
    service.from('launch_checklist_items').select('tenant_id, item_key, status, note, updated_by, updated_at'),
  ])
  if (tenantsRes.error) throw tenantsRes.error
  if (settingsRes.error) throw settingsRes.error
  const setupRequired = isMissingLaunchChecklistTable(ticksRes.error)
  if (ticksRes.error && !setupRequired) throw ticksRes.error

  const settingsByTenant = new Map(((settingsRes.data ?? []) as SettingsRow[]).map((s) => [s.tenant_id, s]))
  const entriesByTenant = new Map<string, Record<string, LaunchChecklistEntry>>()
  for (const row of (ticksRes.data ?? []) as TickRow[]) {
    if (!isLaunchChecklistKey(row.item_key)) continue
    const entries = entriesByTenant.get(row.tenant_id) ?? {}
    entries[row.item_key] = { status: row.status, note: row.note, updatedBy: row.updated_by, updatedAt: row.updated_at }
    entriesByTenant.set(row.tenant_id, entries)
  }

  return {
    setupRequired,
    tenants: ((tenantsRes.data ?? []) as TenantRow[]).map((t) => {
      const settings = settingsByTenant.get(t.id) ?? null
      const verifiedDomain = t.custom_domain && t.custom_domain_verified ? t.custom_domain : null
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.is_active ? 'active' : 'inactive',
        primaryDomain: verifiedDomain,
        siteUrl: getCanonicalUrl(t),
        entries: entriesByTenant.get(t.id) ?? {},
        signals: deriveLaunchChecklistSignals({
          isActive: t.is_active,
          customDomain: t.custom_domain,
          customDomainVerified: t.custom_domain_verified,
          settings,
        }),
      }
    }),
  }
}
