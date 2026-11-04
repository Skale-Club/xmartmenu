import pg from 'pg'
import { OwnedOrderRepository } from '../../src/lib/data/orders'
import { OwnedPaymentRepository } from '../../src/lib/data/payments'
import { readOwnedPublicMenu } from '../../src/lib/data/public-menu'

type Packet = { protocol: string; nonce: string; password: string; validUntil: number }
type ClientLike = Pick<pg.Client, 'connect' | 'query' | 'end'>
const expected = { profiles: 7, tenants: 3, products: 56, orders: 2, order_items: 6 }

export function validatePacket(value: unknown): Packet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid private packet')
  const v = value as Record<string, unknown>
  if (Object.keys(v).sort().join(',') !== 'nonce,password,protocol,validUntil'
    || v.protocol !== 'xmartmenu-private-read-v1' || typeof v.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(v.nonce)
    || typeof v.password !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v.password)
    || typeof v.validUntil !== 'number' || !Number.isSafeInteger(v.validUntil)
    || v.validUntil <= Date.now() + 20_000 || v.validUntil > Date.now() + 300_000) throw new Error('Invalid private packet')
  return v as Packet
}

export function readerConfiguration(packet: Packet) {
  // No URI or environment aliases: only the reviewed private bridge/role/db.
  return { host: '10.0.4.1', port: 15432, user: 'xmartmenu_staging_reader', database: 'xmartmenu',
    password: packet.password, ssl: false as const, connectionTimeoutMillis: 5000,
    statement_timeout: 5000, query_timeout: 6000, application_name: `xmartmenu-read-proof-${packet.nonce}`,
    options: '-c default_transaction_read_only=on -c lock_timeout=2000 -c idle_in_transaction_session_timeout=10000 -c search_path=pg_catalog,public' }
}

export function assertReadQuery(text: string) {
  // Fixed imported read adapters only; no RPC, locking SELECT or caller SQL.
  if (!/^\s*SELECT\s/i.test(text) || text.includes(';') || /\bFOR\s+(?:UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/i.test(text)
    || /\b(?:public|auth)\s*\.\s*[a-z_][a-z0-9_]*\s*\(/i.test(text)
    || /\b(?:pg_[a-z_]+|set_config|nextval|setval|dblink|lo_import)\w*\s*\(/i.test(text)) throw new Error('Read-only adapter query required')
}

export async function runReadProof(value: unknown, createClient: (config: ReturnType<typeof readerConfiguration>) => ClientLike = config => new pg.Client(config)) {
  const packet = validatePacket(value)
  const client = createClient(readerConfiguration(packet))
  let begun = false
  let reads = 0
  try {
    await client.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    begun = true
    const query = async (text: string, values?: unknown[]) => {
      assertReadQuery(text)
      reads++
      return client.query(text, values)
    }
    const authority = (await query(`SELECT current_database() AS database,current_user AS role,
      current_setting('transaction_read_only') AS read_only,
      EXISTS(SELECT FROM pg_roles WHERE rolname='xmartmenu_runtime' AND NOT rolcanlogin AND rolconnlimit=12) AS runtime_dormant,
      has_schema_privilege(current_user,'public','CREATE') AS can_create,
      has_table_privilege(current_user,'public.orders','INSERT,UPDATE,DELETE,TRUNCATE') AS can_write`)).rows[0]
    if (!authority || authority.database !== 'xmartmenu' || authority.role !== 'xmartmenu_staging_reader'
      || authority.read_only !== 'on' || authority.runtime_dormant !== true || authority.can_create || authority.can_write) throw new Error('Read-only authority refused')
    const counts: Record<string, number> = {}
    for (const table of Object.keys(expected)) {
      const result = await query(`SELECT count(*)::int AS count FROM public.${table}`)
      counts[table] = result.rows[0]?.count
      if (counts[table] !== expected[table as keyof typeof expected]) throw new Error('Candidate snapshot differs')
    }
    const tenants = (await query('SELECT id,slug FROM public.tenants WHERE is_active=true ORDER BY id LIMIT 3')).rows
    if (!tenants.length) throw new Error('Active candidate tenant required')
    let menuRead = false
    for (const tenant of tenants) {
      let menu = await readOwnedPublicMenu(query, tenant.slug, undefined)
      if (menu.kind === 'branches' && typeof menu.locations[0]?.slug === 'string') {
        menu = await readOwnedPublicMenu(query, tenant.slug, menu.locations[0].slug)
      }
      if (menu.kind === 'menu') { menuRead = true; break }
    }
    if (!menuRead) throw new Error('Public menu adapter read failed')
    const order = (await query('SELECT id,tenant_id FROM public.orders ORDER BY id LIMIT 1')).rows[0]
    if (!order) throw new Error('Candidate order required')
    const orders = new OwnedOrderRepository(query, order.tenant_id)
    const settings = await orders.tenantSettings()
    const list = await orders.list({ tenantId: order.tenant_id, role: 'store-admin' }, new Date(Date.now()-48*3600000).toISOString())
    const checkout = await new OwnedPaymentRepository(query).checkout(order.id)
    if (settings.error || !settings.data || list.error || !Array.isArray(list.data) || !checkout || !checkout.order_items.length) throw new Error('Order/payment adapter read failed')
    await client.query('ROLLBACK')
    begun = false
    return { privateSqlRead: true, roleReadOnly: true, runtimeLoginEnabled: false, counts,
      adapters: { publicMenu: true, orders: true, paymentCheckout: true }, queryCount: reads,
      sqlWrites: false, providerCalls: false, applicationCutover: false }
  } finally {
    if (begun) await client.query('ROLLBACK').catch(() => {})
    await client.end().catch(() => {})
    packet.password = ''
  }
}
