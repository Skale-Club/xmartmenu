/**
 * SEED-024 helpers: addon status check, menu context serialization, rate limiter.
 *
 * The chat addon is "available" when the tenant's plan has chat_addon_available=true
 * AND the tenant has chat_addon_active=true on their subscription. A superadmin can
 * override via tenant_subscriptions.chat_addon_override (TRUE = force-on, FALSE = force-off).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'

export interface ChatAddonStatus {
  available: boolean       // plan permits it
  active: boolean          // subscription paid AND admin enabled
  enabled: boolean         // chat_addon_settings.enabled
  overrideApplied: boolean // superadmin override is in effect
}

export async function getChatAddonStatus(tenantId: string): Promise<ChatAddonStatus> {
  const supabase = createServiceClient()
  const [{ data: sub }, { data: settings }] = await Promise.all([
    supabase
      .from('tenant_subscriptions')
      .select('chat_addon_active, chat_addon_override, plan_id, plans(chat_addon_available)')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('chat_addon_settings')
      .select('enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  const planAvailable = (sub?.plans as { chat_addon_available?: boolean } | null)?.chat_addon_available ?? false
  const override = (sub as any)?.chat_addon_override as boolean | null | undefined
  const subActive = sub?.chat_addon_active ?? false
  const enabled = settings?.enabled ?? false

  let active = planAvailable && subActive
  let overrideApplied = false
  if (override === true) { active = true; overrideApplied = true }
  if (override === false) { active = false; overrideApplied = true }

  return {
    available: planAvailable || override === true,
    active,
    enabled: active && enabled,
    overrideApplied,
  }
}

/**
 * Build the menu context block injected into the AI system prompt.
 * Includes categories, products, prices, descriptions, options and a few key flags.
 * Kept compact-ish so it doesn't blow the context window even on big menus.
 */
export async function buildMenuContext(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string> {
  // Default menu first; if no default, the most-recent active menu
  const { data: menus } = await supabase
    .from('menus')
    .select('id, name, is_default')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('position')

  const menu = menus?.[0]
  if (!menu) return 'No menu available.'

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase.from('categories').select('id, name, description').eq('menu_id', menu.id).eq('is_active', true).order('position'),
    supabase.from('products').select('id, category_id, name, description, price, original_price, tags').eq('menu_id', menu.id).eq('is_available', true).order('position'),
  ])

  const productIds = (products ?? []).map((p) => p.id)
  const { data: optionGroups } = productIds.length
    ? await supabase
        .from('product_option_groups')
        .select('id, product_id, name, type, required, options:product_options(id, name, price_modifier, base_price)')
        .in('product_id', productIds)
    : { data: [] as any[] }

  const groupsByProduct = new Map<string, any[]>()
  for (const g of optionGroups ?? []) {
    const arr = groupsByProduct.get(g.product_id) ?? []
    arr.push(g)
    groupsByProduct.set(g.product_id, arr)
  }

  const lines: string[] = [`MENU: ${menu.name}`]
  for (const cat of categories ?? []) {
    lines.push(`\n## ${cat.name}`)
    if (cat.description) lines.push(`(${cat.description})`)
    const prods = (products ?? []).filter((p) => p.category_id === cat.id)
    for (const p of prods) {
      const price = p.original_price && p.original_price > p.price
        ? `${p.price} (promo, was ${p.original_price})`
        : `${p.price}`
      const tags = (p.tags as string[] | null)?.length ? ` [${(p.tags as string[]).join(', ')}]` : ''
      lines.push(`- ${p.name} — ${price}${tags} (product_id: ${p.id})`)
      if (p.description) lines.push(`    ${p.description}`)
      const groups = groupsByProduct.get(p.id) ?? []
      for (const g of groups) {
        const opts = (g.options ?? []).map((o: any) => {
          const mod = o.base_price !== null
            ? ` @${o.base_price}`
            : o.price_modifier ? ` ${o.price_modifier > 0 ? '+' : ''}${o.price_modifier}` : ''
          return `${o.name}${mod}`
        }).join(', ')
        lines.push(`    • ${g.name}${g.required ? ' (required)' : ''}: ${opts}`)
      }
    }
  }
  // Products with no category fall under "Other"
  const orphans = (products ?? []).filter((p) => !p.category_id)
  if (orphans.length) {
    lines.push('\n## Other')
    for (const p of orphans) lines.push(`- ${p.name} — ${p.price} (product_id: ${p.id})`)
  }

  return lines.join('\n')
}

/**
 * Counts user messages in the last 24h for a (tenant, phone_hash) pair.
 * Used to enforce rate_limit_per_phone_per_day.
 */
export async function countMessagesLast24h(
  supabase: SupabaseClient,
  tenantId: string,
  phoneHash: string,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('chat_messages')
    .select('id, conversation:chat_conversations!inner(tenant_id, phone_hash)', { count: 'exact', head: true })
    .eq('role', 'user')
    .gte('created_at', since)
    .eq('chat_conversations.tenant_id', tenantId)
    .eq('chat_conversations.phone_hash', phoneHash)
  return count ?? 0
}
