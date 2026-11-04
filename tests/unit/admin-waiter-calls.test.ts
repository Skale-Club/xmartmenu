import { describe,it,expect,vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readAdminWaiterCalls,updateAdminWaiterCall } from '@/lib/data/admin-waiter-calls'
import { CALL_STALE_MS } from '@/lib/waiter-calls'

const tenantId = randomUUID(), actorId = randomUUID(), callId = randomUUID(), tableId = randomUUID()
const context = { tenantId,actorId,role: 'store-staff' as const }, now = new Date()
const row = (id = callId, created = now) => ({ id,table_id: tableId,table_name: 'Table 1',reason: 'waiter',status: 'open',created_at: created,last_called_at: now,acknowledged_at: null })
function fixture() {
  const state = { actor: { role: 'store-staff',tenant_id: tenantId,must_change_password: false,disabled_at: null as Date | null },status: 'active',features: ['orders'] as unknown,rows: [row()] as Record<string,unknown>[] }
  const query = vi.fn(async (sql: string,_values?: unknown[]) => {
    void _values
    if (sql.includes('FROM public.profiles')) return { rows: [state.actor] }
    if (sql.includes('FROM public.tenant_settings')) return { rows: [{ orders_enabled: false,direct_orders_enabled: false,table_management_enabled: false }] }
    if (sql.includes('FROM public.tenant_subscriptions')) return { rows: [{ status: state.status,features: state.features }] }
    return { rows: state.rows }
  })
  return { state,query }
}

describe('native staff waiter repository',() => {
  it('converts PostgreSQL Date values before sorting and applies the strict two-hour active boundary',async () => {
    const f = fixture(), older = randomUUID()
    f.state.rows = [row(),row(older,new Date(now.getTime()-60000)),row(randomUUID(),new Date(now.getTime()-CALL_STALE_MS)),{ ...row(randomUUID()),status: 'done' }]
    const result = await readAdminWaiterCalls(f.query,context,now)
    expect(result.calls.map(call => call.id)).toEqual([older,callId])
    expect(result.calls[0].created_at).toBe(new Date(now.getTime()-60000).toISOString())
    const [sql,values] = f.query.mock.calls.at(-1)!
    expect(sql).toContain("tenant_id=$1 AND status<>'done'")
    expect(sql).toContain('ORDER BY created_at,id LIMIT 100')
    expect(values?.[0]).toBe(tenantId)
  })
  it('denies customer, disabled/recovery/downgraded and cross-tenant actors before call queries',async () => {
    const f = fixture()
    await expect(readAdminWaiterCalls(f.query,{ ...context,role: 'customer' },now)).rejects.toMatchObject({ status: 403 })
    expect(f.query).not.toHaveBeenCalled()
    for (const patch of [{ tenant_id: randomUUID() },{ role: 'customer' },{ disabled_at: new Date() },{ must_change_password: true }]) {
      const f = fixture(); Object.assign(f.state.actor,patch)
      await expect(updateAdminWaiterCall(f.query,context,callId,'done',now)).rejects.toMatchObject({ status: 403 })
      expect(f.query.mock.calls.some(([sql]) => sql.includes('public.waiter_calls'))).toBe(false)
    }
  })
  it('retains the plan ceiling when switches are off and revokes cancelled/unsupported plans',async () => {
    const f = fixture()
    await expect(readAdminWaiterCalls(f.query,context,now)).resolves.toHaveProperty('calls')
    for (const [status,features] of [['cancelled',['orders']],['past_due',['payments']],['active',[]]] as const) {
      const f = fixture(); f.state.status = status; f.state.features = [...features]
      await expect(readAdminWaiterCalls(f.query,context,now)).rejects.toMatchObject({ status: 403 })
      expect(f.query.mock.calls.some(([sql]) => sql.includes('public.waiter_calls'))).toBe(false)
    }
  })
  it('sets only the server actor for acknowledgment and preserves other timestamps for done',async () => {
    const f = fixture()
    await updateAdminWaiterCall(f.query,context,callId,'acknowledged',now)
    const [ack,values] = f.query.mock.calls.at(-1)!
    expect(ack).toContain('acknowledged_by=$4'); expect(values).toEqual([tenantId,callId,now,actorId])
    expect(ack).not.toContain('done_at=')
    await updateAdminWaiterCall(f.query,context,callId,'done',now)
    const [done,doneValues] = f.query.mock.calls.at(-1)!
    expect(done).toContain("status='done',done_at=$3"); expect(done).not.toContain('acknowledged_by=')
    expect(doneValues).toEqual([tenantId,callId,now])
    expect(f.query.mock.calls.some(([sql]) => sql.includes('FOR SHARE OF p,a'))).toBe(true)
  })
  it('rejects missing calls and invalid status without leaking database records',async () => {
    const f = fixture(); f.state.rows = []
    await expect(updateAdminWaiterCall(f.query,context,callId,'done',now)).rejects.toMatchObject({ status: 404 })
    await expect(updateAdminWaiterCall(f.query,context,callId,'open',now)).rejects.toMatchObject({ status: 400 })
  })
})
