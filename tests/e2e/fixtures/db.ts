/**
 * Direct database access for assertions and setup, with the service role.
 *
 * Refuses to run against anything but a local Supabase: these tests create
 * orders and flip restaurant settings, so pointing them at production would
 * write real data. (Local dev uses the production project by default —
 * see tests/e2e/README.md for running against the local stack.)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', 'host.docker.internal'])

export function assertLocalSupabase(url = process.env.NEXT_PUBLIC_SUPABASE_URL): string {
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set — start the local stack (npm run db:local) and use npm run test:e2e')
  const host = new URL(url).hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`E2E tests only run against a local Supabase, not ${host}. Refusing to touch a real database.`)
  }
  return url
}

let client: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (client) return client
  const url = assertLocalSupabase()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

export async function getOrder(id: string) {
  const { data, error } = await db()
    .from('orders')
    .select('id, tenant_id, status, order_type, table_id, table_name, total, customer_name, order_items(product_id, quantity, unit_price)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as {
    id: string
    tenant_id: string
    status: string
    order_type: string
    table_id: string | null
    table_name: string | null
    total: number | string
    customer_name: string
    order_items: Array<{ product_id: string; quantity: number; unit_price: number | string }>
  }
}

/** Latest order of a restaurant placed by a given customer name (UI flows). */
export async function findOrderByCustomer(tenantId: string, customerName: string) {
  const { data, error } = await db()
    .from('orders')
    .select('id, status, order_type, table_id, table_name, total')
    .eq('tenant_id', tenantId)
    .eq('customer_name', customerName)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function updateSettings(tenantId: string, patch: Record<string, unknown>) {
  const { error } = await db().from('tenant_settings').update(patch).eq('tenant_id', tenantId)
  if (error) throw error
}

/** A name unique to this run, so tests can find the order they placed. */
export function uniqueName(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
