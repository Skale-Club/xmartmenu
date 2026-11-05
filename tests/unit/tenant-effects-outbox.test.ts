import { describe,it,expect,vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { enqueueNativeTenantEffect } from '@/lib/data/tenant-effects-outbox'
describe('native CRM transactional handoff',()=>{
 it('records a stable event intention with normalized tags and no provider call',async()=>{
  const id=randomUUID(),tenantId=randomUUID(),query=vi.fn(async()=>({rows:[{id}]}))
  expect(await enqueueNativeTenantEffect(query,{tenantId,reason:'plan_changed',eventId:'event-synthetic',tags:['upgrade','active','upgrade']})).toBe(id)
  expect(query.mock.calls[0]).toBeDefined()
  expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'),[expect.any(String),tenantId,'plan_changed','event-synthetic','["active","upgrade"]'])
 })
 it('reuses an exact duplicate and refuses conflicting event metadata',async()=>{
  const id=randomUUID(),tenantId=randomUUID(),query=vi.fn(async(sql:string)=>({rows:sql.startsWith('INSERT')?[]:[{id,tags:['active']}]}))
  expect(await enqueueNativeTenantEffect(query,{tenantId,reason:'plan_activated',eventId:'event-synthetic',tags:['active']})).toBe(id)
  await expect(enqueueNativeTenantEffect(query,{tenantId,reason:'plan_activated',eventId:'event-synthetic',tags:['other']})).rejects.toMatchObject({status:409})
 })
 it('rejects malformed IDs and unbounded metadata before querying',async()=>{
  const query=vi.fn(async()=>({rows:[]}))
  await expect(enqueueNativeTenantEffect(query,{tenantId:'email@example.test',reason:'manual'})).rejects.toMatchObject({status:400})
  await expect(enqueueNativeTenantEffect(query,{tenantId:randomUUID(),reason:'manual',eventId:'x'.repeat(257)})).rejects.toMatchObject({status:400})
  expect(query).not.toHaveBeenCalled()
 })
})
