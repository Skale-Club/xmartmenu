import { randomUUID } from 'node:crypto'
import { AdminMenuError,type AdminMenuQuery } from './admin-menus'
import { UUID } from '../auth/owned-principal'
import type { SyncReason } from '../xphere/types'

export const NATIVE_SYNC_REASONS = ['onboarded','plan_activated','plan_changed','past_due','churned','connect_changed','backfill','manual'] as const
export const tenantEffectsSelected=(env:Record<string,string|undefined>=process.env)=>env.OWNED_TENANT_EFFECTS_ENABLED==='true'
export type NativeTenantEffectInput = { tenantId:string; reason:SyncReason; eventId?:string; tags?:string[] }
/** Internal transaction seam. The caller must authorize its actor or verify its
 * provider event before calling. This only records an intention, never delivers
 * to QStash/CRM and never retries a caller's financial operation. */
export async function enqueueNativeTenantEffect(query:AdminMenuQuery,input:NativeTenantEffectInput):Promise<string> {
  if (!UUID.test(input.tenantId) || !NATIVE_SYNC_REASONS.includes(input.reason)
    || (input.eventId !== undefined && (typeof input.eventId !== 'string' || !input.eventId || input.eventId.length > 256))
    || (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some(tag=>typeof tag !== 'string' || !tag || tag.length > 100)))) {
    throw new AdminMenuError(400,'Invalid native CRM intention')
  }
  const tags = [...new Set(input.tags ?? [])].sort(),id=randomUUID()
  const created=(await query(`INSERT INTO public.app_tenant_effects(id,tenant_id,kind,event_id,tags)
    VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(tenant_id,kind,event_id) WHERE event_id IS NOT NULL DO NOTHING RETURNING id`,
    [id,input.tenantId,input.reason,input.eventId ?? null,JSON.stringify(tags)])).rows
  if (created.length === 1) return String(created[0].id)
  if (!input.eventId) throw new AdminMenuError(503,'Native CRM intention was not recorded')
  const existing=(await query(`SELECT id,tags FROM public.app_tenant_effects WHERE tenant_id=$1 AND kind=$2 AND event_id=$3 FOR SHARE`,[input.tenantId,input.reason,input.eventId])).rows
  if (existing.length !== 1 || JSON.stringify(existing[0].tags) !== JSON.stringify(tags)) throw new AdminMenuError(409,'CRM event already has a different intention')
  return String(existing[0].id)
}
