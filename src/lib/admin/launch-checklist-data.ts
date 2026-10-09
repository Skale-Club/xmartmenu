import type { SupabaseClient } from '@supabase/supabase-js'
import { getCanonicalUrl } from '@/lib/seo'
import {
  isLaunchChecklistKey,
  type LaunchChecklistEntry,
  type LaunchChecklistResponse,
  type LaunchChecklistStatus,
} from '@/lib/launch-checklist'
import { deriveLaunchChecklistSignals } from '@/lib/admin/launch-checklist-signals'
import { scanLaunchChecklistSite, type LaunchChecklistScan } from '@/lib/admin/launch-checklist-scan'

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

// Data access for the launch checklist, shared by the super-admin page, the
// PUT route and the MCP tools (src/lib/mcp/tools/launch-checklist.ts) so the
// panel and an agent always read and write the same thing.

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

export class LaunchChecklistSetupError extends Error {
  constructor() {
    super('The launch checklist table does not exist yet — apply supabase/migrations/20261009120000_launch_checklist_items.sql')
  }
}

export interface LaunchChecklistWrite {
  tenantId: string
  itemKey: string
  status: LaunchChecklistStatus
  /** Omitted = keep the stored note, so ticking a box never wipes it. */
  note?: string
  updatedBy: string | null
}

/** Upserts one tick. Returns null when the restaurant does not exist. */
export async function setLaunchChecklistItem(
  service: SupabaseClient,
  write: LaunchChecklistWrite,
): Promise<LaunchChecklistEntry | null> {
  const { data: tenant } = await service.from('tenants').select('id').eq('id', write.tenantId).maybeSingle()
  if (!tenant) return null

  const row: Record<string, unknown> = {
    tenant_id: write.tenantId,
    item_key: write.itemKey,
    status: write.status,
    updated_by: write.updatedBy,
    updated_at: new Date().toISOString(),
  }
  const note = write.note?.trim()
  if (note !== undefined) row.note = note

  const { data, error } = await service
    .from('launch_checklist_items')
    .upsert(row, { onConflict: 'tenant_id,item_key' })
    .select('status, note, updated_by, updated_at')
    .single()
  if (error) {
    if (isMissingLaunchChecklistTable(error)) throw new LaunchChecklistSetupError()
    throw error
  }
  return { status: data.status, note: data.note, updatedBy: data.updated_by, updatedAt: data.updated_at }
}

export interface LaunchChecklistScanOutcome {
  scan: LaunchChecklistScan
  /** Items ticked "done" by this run (only ever pending → done). */
  marked: string[]
}

/**
 * Scans the restaurant's live menu (its public address from the DB — never a
 * caller-supplied URL) and, when `apply` is set, ticks every PENDING item the
 * scan verified. Never un-ticks or overrides an N/A: a human's decision wins
 * over a crawler's. Returns null when the restaurant does not exist.
 */
export async function runLaunchChecklistScan(
  service: SupabaseClient,
  tenantId: string,
  opts: { apply: boolean; updatedBy: string },
): Promise<LaunchChecklistScanOutcome | null> {
  const { tenants, setupRequired } = await loadLaunchChecklist(service)
  const tenant = tenants.find((t) => t.id === tenantId)
  if (!tenant) return null
  if (opts.apply && setupRequired) throw new LaunchChecklistSetupError()

  const scan = await scanLaunchChecklistSite(tenant.siteUrl)
  const marked: string[] = []
  if (opts.apply) {
    const day = scan.scannedAt.slice(0, 10)
    for (const [itemKey, finding] of Object.entries(scan.findings)) {
      if (!finding.ok || !isLaunchChecklistKey(itemKey)) continue
      const current = tenant.entries[itemKey]
      if ((current?.status ?? 'pending') !== 'pending') continue
      await setLaunchChecklistItem(service, {
        tenantId,
        itemKey,
        status: 'done',
        // Keep a human's note; otherwise record what the scan saw.
        note: current?.note ? undefined : `Verified by site scan on ${day}: ${finding.evidence}`,
        updatedBy: opts.updatedBy,
      })
      marked.push(itemKey)
    }
  }
  return { scan, marked }
}
