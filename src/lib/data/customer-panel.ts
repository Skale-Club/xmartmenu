import type { Order, OrderItem } from '@/types/database'
import { UUID } from '../auth/owned-principal'
import type { OwnedCustomer } from '../auth/owned-customer'
import { ITEM_COLUMNS, ORDER_COLUMNS, OrderDataError, type OrderQuery } from './orders'

export interface CustomerPanelTenant { id: string; name: string; slug: string; settings: {
  primary_color: string | null; accent_color: string | null; address: string | null; phone: string | null; currency: string | null; logo_url: string | null
} }
const projection = (fields: string,alias: string) => `to_jsonb((SELECT value FROM (SELECT ${fields.split(' ').map(field => `${alias}.${field}`).join(',')}) value))`

export class CustomerPanelRepository {
  constructor(private query: OrderQuery) {}
  async panel(customer: OwnedCustomer,slug: string) {
    if (customer.mustChangePassword || !UUID.test(customer.userId)) throw new OrderDataError(403,'Account recovery is required')
    if (!slug || slug.length > 200) throw new OrderDataError(404,'Restaurant not found')
    const admitted = await this.query(`SELECT a.id FROM public.app_accounts a JOIN public.profiles p ON p.id=a.id
      WHERE a.id=$1 AND a.disabled_at IS NULL AND coalesce(p.must_change_password,false)=false
        AND p.role IN ('customer','store-admin','store-staff','superadmin','admin','super-admin')${customer.phoneE164 ? ' FOR SHARE OF a,p' : ''}`,[customer.userId])
    if (admitted.rows.length !== 1) throw new OrderDataError(403,'Account access is unavailable')
    const result = await this.query(`SELECT jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'settings',jsonb_build_object(
      'primary_color',s.primary_color,'accent_color',s.accent_color,'address',s.address,'phone',s.phone,'currency',s.currency,'logo_url',s.logo_url)) AS row
      FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id WHERE t.slug=$1 AND t.is_active=true LIMIT 2`,[slug])
    if (result.rows.length > 1) throw new OrderDataError(503,'Restaurant data is unavailable')
    const tenant = result.rows[0]?.row as CustomerPanelTenant | undefined
    if (!tenant) return null
    if (!UUID.test(tenant.id)) throw new OrderDataError(503,'Restaurant data is unavailable')
    let linkingUnavailable = false
    if (customer.phoneE164) {
      if (!/^\+[1-9]\d{7,14}$/.test(customer.phoneE164)) throw new OrderDataError(403,'Verified phone required')
      // Same predicates as link_orders_to_verified_phone. Never overwrites an
      // already-owned row or uses an old number, suffix, profile/contact field.
      await this.query('SAVEPOINT customer_phone_claim')
      try {
        await this.query(`UPDATE public.orders SET customer_id=$2,customer_linked_at=now(),customer_link_method='verified_phone'
          WHERE tenant_id=$1 AND customer_id IS NULL AND customer_phone_e164=$3 AND $3 ~ '^\\+[1-9][0-9]{7,14}$'`,[tenant.id,customer.userId,customer.phoneE164])
      } catch {
        await this.query('ROLLBACK TO SAVEPOINT customer_phone_claim'); linkingUnavailable = true
      }
      await this.query('RELEASE SAVEPOINT customer_phone_claim')
    }
    const orders = await this.query(`SELECT ${projection(ORDER_COLUMNS,'o')}||jsonb_build_object('order_items',coalesce((
      SELECT jsonb_agg(${projection(ITEM_COLUMNS,'i')} ORDER BY i.id) FROM public.order_items i WHERE i.order_id=o.id),'[]'::jsonb)) AS row
      FROM public.orders o WHERE o.tenant_id=$1 AND o.customer_id=$2 ORDER BY o.created_at DESC,o.id LIMIT 25`,[tenant.id,customer.userId])
    return { tenant,orders: orders.rows.map(value => value.row as Order & { order_items: OrderItem[] }),linkingUnavailable }
  }
}
