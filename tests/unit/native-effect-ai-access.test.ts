import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest'
import { randomUUID } from 'node:crypto'
const mocks=vi.hoisted(()=>({actor:vi.fn(),prepare:vi.fn(),record:vi.fn(),reconcile:vi.fn()}))
vi.mock('@/lib/data/admin-menus-runtime',()=>({ownedAdminTransaction:async(_write:boolean,operation:(query:unknown)=>Promise<unknown>)=>operation({})}))
vi.mock('@/lib/data/tenant-effect-authority-runtime',()=>({currentTenantEffectActor:mocks.actor}))
vi.mock('@/lib/data/tenant-effect-authority',()=>({requireTenantEffectActor:vi.fn()}))
vi.mock('@/lib/data/ai-access',()=>({readPlatformAiRecord:vi.fn(async()=>null)}))
vi.mock('@/lib/data/tenant-effect-calls',()=>({prepareTenantEffectCall:mocks.prepare,recordTenantEffectCall:mocks.record,reconcileTenantEffectCall:mocks.reconcile}))
import { nativeEffectAiAccess } from '@/lib/tenant-effects/ai-access'
import type { TenantOperation } from '@/lib/data/tenant-effect-operations'
describe('native paid AI calls never retry ambiguous outcomes or use Source',()=>{
 const operation:TenantOperation={id:randomUUID(),tenantId:randomUUID(),actorId:randomUUID(),sessionHash:'a'.repeat(64),kind:'seed',input:{},status:'running',claimId:randomUUID(),result:null}
 const claimId=randomUUID(),url='https://openrouter.ai/api/v1/chat/completions'
 beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('OPENROUTER_API_KEY','synthetic-offline-key');mocks.actor.mockResolvedValue({actorId:operation.actorId,sessionHash:operation.sessionHash});mocks.prepare.mockResolvedValue(undefined);mocks.record.mockResolvedValue(undefined);mocks.reconcile.mockResolvedValue(undefined)})
 afterEach(()=>vi.unstubAllEnvs())
 it('requires the claim commit before fetch and records the exact cost once',async()=>{
  const request=vi.fn(async()=>Response.json({id:'synthetic-generation',model:'synthetic/model',usage:{cost:0.123,total_tokens:42},choices:[]}))
  const access=await nativeEffectAiAccess(operation,claimId,'seed',0,request)
  await access.fetchImpl(url,{method:'POST',body:'{"model":"synthetic/model"}'})
  expect(mocks.prepare).toHaveBeenCalledOnce();expect(request).toHaveBeenCalledOnce();expect(mocks.record).toHaveBeenCalledWith({},operation.id,claimId,0,expect.objectContaining({costUsd:0.123,tokens:42,feature:'seed'}))
  await expect(access.fetchImpl(url,{method:'POST'})).rejects.toMatchObject({status:409});expect(request).toHaveBeenCalledOnce()
 })
 it('does not send after revocation or a failed/ambiguous prepared-call commit',async()=>{
  const request=vi.fn();mocks.prepare.mockRejectedValue(new Error('synthetic prepared COMMIT unknown'))
  const access=await nativeEffectAiAccess(operation,claimId,'seed',0,request)
  await expect(access.fetchImpl(url,{method:'POST'})).rejects.toThrow();expect(request).not.toHaveBeenCalled()
 })
 it('marks timeout, missing cost and failed receipt commit for reconciliation without estimating or charging again',async()=>{
  for(const request of [vi.fn(async()=>{throw new Error('synthetic timeout')}),vi.fn(async()=>Response.json({usage:{total_tokens:2}}))]){
   const access=await nativeEffectAiAccess(operation,claimId,'seed',0,request)
   await expect(access.fetchImpl(url,{method:'POST'})).rejects.toMatchObject({status:409});expect(request).toHaveBeenCalledOnce()
  }
  expect(mocks.record).not.toHaveBeenCalled()
  mocks.record.mockRejectedValue(new Error('synthetic receipt COMMIT unknown'))
  const request=vi.fn(async()=>Response.json({usage:{cost:0,total_tokens:0}})),access=await nativeEffectAiAccess(operation,claimId,'seed',0,request)
  await expect(access.fetchImpl(url,{method:'POST'})).rejects.toMatchObject({status:409});expect(request).toHaveBeenCalledOnce();expect(mocks.reconcile).toHaveBeenCalledTimes(3)
 })
})
