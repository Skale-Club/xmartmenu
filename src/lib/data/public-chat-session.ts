import { hashPhone } from '../crypto'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'

function unique(rows: Record<string, unknown>[]) {
  if (rows.length > 1) throw new AdminMenuError(503, 'Chat information is unavailable')
  return rows[0]
}

/** Mirrors addon availability/override semantics; this is not an Auth identity. */
export async function readPublicChatAddon(query: AdminMenuQuery, tenantId: string) {
  const subscription = unique((await query(`SELECT s.chat_addon_active,s.chat_addon_override,p.chat_addon_available
    FROM public.tenant_subscriptions s LEFT JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1 LIMIT 2`, [tenantId])).rows)
  const settings = unique((await query(`SELECT enabled,rate_limit_per_phone_per_day FROM public.chat_addon_settings WHERE tenant_id=$1 LIMIT 2`, [tenantId])).rows)
  const available = subscription?.chat_addon_available === true
  const override = subscription?.chat_addon_override
  const active = override === true || (override !== false && available && subscription?.chat_addon_active === true)
  return {
    status: { available: available || override === true, active, enabled: active && settings?.enabled === true, overrideApplied: override === true || override === false },
    rateLimit: settings?.rate_limit_per_phone_per_day ?? 30,
  }
}

/** Tenant-scoped anonymous conversation reuse; phone digits never enter SQL. */
export async function createPublicChatSession(query: AdminMenuQuery, slug: string, inputPhone: unknown, now = new Date()) {
  const digits = typeof inputPhone === 'string' ? inputPhone.replace(/\D/g, '') : ''
  if (digits.length < 8 || digits.length > 15) throw new AdminMenuError(400, 'Invalid phone number')
  if (!Number.isFinite(now.getTime())) throw new AdminMenuError(503, 'Chat information is unavailable')
  const tenant = unique((await query(`SELECT id FROM public.tenants WHERE slug=$1 AND is_active=true LIMIT 2 FOR SHARE`, [slug])).rows)
  if (!tenant || typeof tenant.id !== 'string') throw new AdminMenuError(404, 'Tenant not found')
  const { status, rateLimit } = await readPublicChatAddon(query, tenant.id)
  if (!status.enabled) throw new AdminMenuError(403, 'Chat addon not enabled')
  const phoneHash = hashPhone(digits, tenant.id)
  // Fixed namespace + tenant-scoped hash prevents duplicate first-use sessions
  // among native writers without a schema/index migration or a global lock.
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`xmartmenu-chat-session:${tenant.id}:${phoneHash}`])
  const blocked = unique((await query(`SELECT id FROM public.chat_blocked_phones WHERE tenant_id=$1 AND phone_hash=$2 LIMIT 2`, [tenant.id, phoneHash])).rows)
  if (blocked) throw new AdminMenuError(403, 'This number is not allowed to use the assistant')
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0)
  const existing = unique((await query(`SELECT id,message_count FROM public.chat_conversations
    WHERE tenant_id=$1 AND phone_hash=$2 AND started_at>=$3 ORDER BY started_at DESC LIMIT 1`, [tenant.id, phoneHash, start.toISOString()])).rows)
  if (existing) return { conversation_id: existing.id, rate_limit: rateLimit, messages_today: existing.message_count ?? 0 }
  const inserted = await query(`INSERT INTO public.chat_conversations(tenant_id,phone_hash) VALUES($1,$2) RETURNING id`, [tenant.id, phoneHash])
  if (inserted.rows.length !== 1) throw new AdminMenuError(503, 'Failed to create conversation')
  return { conversation_id: inserted.rows[0].id, rate_limit: rateLimit, messages_today: 0 }
}
