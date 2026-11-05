import { beforeEach,describe,it,expect,vi } from 'vitest'
import { randomUUID } from 'node:crypto'
const mocks=vi.hoisted(()=>({read:vi.fn(),claim:vi.fn(),complete:vi.fn(),reconcile:vi.fn(),enabled:vi.fn(),metadata:vi.fn(),publish:vi.fn()}))
vi.mock('@/lib/tenant-effects/publish-pending',()=>({publishPendingNativeTenantEffects:mocks.publish}))
vi.mock('@/lib/data/admin-menus-runtime',()=>({ownedAdminTransaction:async(_write:boolean,operation:(query:unknown)=>Promise<unknown>)=>operation({})}))
vi.mock('@/lib/data/native-crm-effects',async importOriginal=>({...await importOriginal<typeof import('@/lib/data/native-crm-effects')>(),readNativeCrmFacts:mocks.read,claimNativeCrmEffect:mocks.claim,completeNativeCrmEffect:mocks.complete,reconcileNativeCrmEffect:mocks.reconcile}))
vi.mock('@/lib/auth/identity-services',()=>({getIdentityServices:()=>({config:{web:{projectId:'skaleclub'}},customerAccount:mocks.metadata})}))
vi.mock('@/lib/xphere/client',()=>({isXphereEnabled:mocks.enabled,postXphereSync:vi.fn()}))
import { dispatchNativeCrmEffect } from '@/lib/tenant-effects/crm'
import { verifiedNativeCrmResponse } from '@/lib/data/native-crm-effects'
describe('native CRM real-outcome boundary',()=>{
 const id=randomUUID(),claimId=randomUUID(),tenantId=randomUUID(),payload={source:'xmartmenu' as const,event:'manual',occurred_at:new Date().toISOString(),company:{id:tenantId,name:'Synthetic',owner_name:null,email:null,website:null},opportunity:{stage:'Active' as const,value:10,currency:'BRL',pipeline:'XmartMenu Lifecycle'}}
 const response={ok:true,account_id:randomUUID(),contact_id:null,opportunity_id:randomUUID()}
 beforeEach(()=>{vi.clearAllMocks();mocks.publish.mockReset().mockResolvedValue({queued:true});mocks.enabled.mockReturnValue(true);mocks.read.mockResolvedValue({id,status:'pending',tenantId,owner:null});mocks.claim.mockResolvedValue({claimId,payload,requestDigest:'a'.repeat(64),tenantId});mocks.complete.mockResolvedValue(undefined);mocks.reconcile.mockResolvedValue(undefined)})
 it('keeps disabled integration pending, without SQL claim or fabricated delivery',async()=>{
  mocks.enabled.mockReturnValue(false);const send=vi.fn()
  expect(await dispatchNativeCrmEffect(id,send)).toEqual({status:'pending',reason:'crm-disabled'})
  expect(send).not.toHaveBeenCalled();expect(mocks.claim).not.toHaveBeenCalled()
 })
 it('requires real mandatory UUIDs and ok=true, allowing an explicitly absent contact',()=>{
  expect(verifiedNativeCrmResponse(response)).toEqual(response)
  for(const patch of [{ok:false},{account_id:null},{opportunity_id:'invented'},{contact_id:'contact@example.test'}])expect(()=>verifiedNativeCrmResponse({...response,...patch})).toThrow()
 })
 it('persists IDs only after a validated provider response under the exact claim',async()=>{
  const send=vi.fn(async()=>({disabled:false as const,response}))
  expect(await dispatchNativeCrmEffect(id,send)).toEqual({status:'delivered'})
  expect(send).toHaveBeenCalledOnce();expect(send).toHaveBeenCalledWith(payload,{idempotencyKey:`xmartmenu-native:${id}`})
  expect(mocks.complete).toHaveBeenCalledWith({},id,claimId,'a'.repeat(64),response)
 })
 it('never retries a timeout or an ambiguous receipt commit, and duplicate claims do not resend notes',async()=>{
  const send=vi.fn(async()=>{throw new Error('synthetic timeout')})
  expect(await dispatchNativeCrmEffect(id,send)).toEqual({status:'reconcile'});expect(send).toHaveBeenCalledOnce();expect(mocks.complete).not.toHaveBeenCalled()
  mocks.read.mockResolvedValue({id,status:'reconcile'});expect(await dispatchNativeCrmEffect(id,send)).toEqual({status:'reconcile'});expect(send).toHaveBeenCalledOnce()
  mocks.read.mockResolvedValue({id,status:'pending',owner:null});mocks.complete.mockRejectedValue(new Error('synthetic ambiguous COMMIT'))
  const success=vi.fn(async()=>({disabled:false as const,response}));expect(await dispatchNativeCrmEffect(id,success)).toEqual({status:'reconcile'});expect(success).toHaveBeenCalledOnce()
  mocks.claim.mockResolvedValue({skipped:'processing'});expect(await dispatchNativeCrmEffect(id,success)).toEqual({status:'processing'});expect(success).toHaveBeenCalledOnce()
 })
 it('reports a committed delivery truthfully when publishing the next intention fails',async()=>{
  mocks.publish.mockRejectedValue(new Error('synthetic unavailable queue'))
  const send=vi.fn(async()=>({disabled:false as const,response}))
  expect(await dispatchNativeCrmEffect(id,send)).toEqual({status:'delivered'})
  expect(mocks.complete).toHaveBeenCalledOnce();expect(mocks.reconcile).not.toHaveBeenCalled();expect(send).toHaveBeenCalledOnce()
 })
 it('does not mark malformed 2xx or disabled client response as delivered',async()=>{
  const malformed=vi.fn(async()=>({disabled:false as const,response:{...response,ok:false}}))
  expect(await dispatchNativeCrmEffect(id,malformed)).toEqual({status:'reconcile'});expect(mocks.complete).not.toHaveBeenCalled()
  const disabled=vi.fn(async()=>({disabled:true as const}));expect(await dispatchNativeCrmEffect(id,disabled)).toEqual({status:'reconcile'});expect(mocks.complete).not.toHaveBeenCalled()
 })
})
