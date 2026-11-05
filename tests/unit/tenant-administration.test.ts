import { describe,it,expect,vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { validatePlan,createTenant,readPlans,readTenants,tenantAdministrationSelected } from '@/lib/data/tenant-administration'
const context = { actorId:randomUUID(),sessionHash:'a'.repeat(64) }
const valid = { name:'Menu',monthly_price:10,annual_price:100,transaction_fee_pct:0.015,features:['orders'],is_active:true,sort_order:0 }
describe('native tenant and plan administration boundaries',() => {
  it('defaults off and requires the exact server-side session context before reading any rows',async () => {
    expect(tenantAdministrationSelected({})).toBe(false)
    const query = vi.fn(async () => ({ rows:[] }))
    await expect(readTenants(query,{ ...context,sessionHash:'browser-role' })).rejects.toMatchObject({ status:403 })
    expect(query).not.toHaveBeenCalled()
    await expect(readPlans(query,context)).rejects.toMatchObject({ status:403 })
    expect(query).toHaveBeenCalledTimes(1)
  })
  it('validates finite numeric storage precision, cross-field prices, booleans, arrays and allowlists',() => {
    expect(validatePlan(valid)).toMatchObject({ slug:'menu',monthly_price:10 })
    for (const patch of [{ monthly_price:'10' },{ monthly_price:Infinity },{ monthly_price:0.001 },{ annual_price:1 },{ transaction_fee_pct:10 },{ is_active:'true' },{ features:[{}] },{ sort_order:0.5 },{ stripe_product_id:'external' },{ id:randomUUID() },{ name:'---' }]) {
      expect(() => validatePlan({ ...valid,...patch })).toThrow()
    }
    expect(() => validatePlan({ monthly_price:101 },valid)).toThrow('Annual price')
  })
  it('rejects contact ownership, tenant/role/ID injection before any insert',async () => {
    const query = vi.fn(async (sql: string) => ({ rows:sql.includes('JOIN public.app_sessions') ? [{ id:context.actorId }] : [] }))
    for (const input of [{ name:'Shop',slug:'shop',email:'owner@example.test' },{ name:'Shop',slug:'shop',owner_user_id:randomUUID(),role:'superadmin' },{ name:'Shop',slug:'shop',owner_user_id:context.actorId.toUpperCase() }]) {
      await expect(createTenant(query,context,input)).rejects.toMatchObject({ status:400 })
    }
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false)
  })
})
