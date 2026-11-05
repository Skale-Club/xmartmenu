import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({prepare:vi.fn(),receipt:vi.fn(),reconcile:vi.fn(),facts:vi.fn(),failure:vi.fn()}))
vi.mock('@/lib/ai/openrouter',()=>({OPENROUTER_BASE_URL:'https://synthetic.example/api/v1'}))
vi.mock('@/lib/blog/native/runtime',()=>({nativeBlogPhase:async(context:unknown,_write:boolean,operation:(query:unknown,current:unknown)=>Promise<unknown>)=>operation({},context)}))
vi.mock('@/lib/data/admin-menus-runtime',()=>({ownedAdminTransaction:async(_write:boolean,operation:(query:unknown)=>Promise<unknown>)=>operation({})}))
vi.mock('@/lib/blog/native/generation-data',()=>({requireNativeBlogFacts:mocks.facts}))
vi.mock('@/lib/blog/native/operations',()=>({prepareNativeBlogCall:mocks.prepare,recordNativeBlogCall:mocks.receipt,reconcileNativeBlogOperation:mocks.reconcile,recordNativeBlogCallFailure:mocks.failure}))
import {nativeBlogUsage,callNativeBlogAi} from '@/lib/blog/native/provider-call'
import {NativeBlogDefinitiveError,NativeBlogUnknownOutcomeError} from '@/lib/blog/native/outcome'
beforeEach(()=>{vi.clearAllMocks();mocks.prepare.mockResolvedValue(undefined);mocks.receipt.mockResolvedValue(undefined);mocks.reconcile.mockResolvedValue(undefined);mocks.failure.mockResolvedValue(undefined)})
const input={context:{kind:'cron' as const,scope:null},operationId:'synthetic-operation',claimId:'synthetic-claim',index:0,settingsDigest:'a'.repeat(64),choice:{apiKey:'synthetic-offline',keySource:'platform' as const,billable:false,markupPct:0},body:{model:'synthetic/model'}}
it('requires actual finite cost, preserving unknown token counts as null instead of invented zeroes',()=>{
 expect(()=>nativeBlogUsage({usage:{}})).toThrow()
 expect(nativeBlogUsage({usage:{cost:0.125}})).toMatchObject({costUsd:0.125,tokens:null,inputTokens:null,outputTokens:null})
})
it('never sends after SQL denial and records a known response before returning output',async()=>{
 mocks.prepare.mockRejectedValue(new Error('revoked during lookup'))
 const send=vi.fn();await expect(callNativeBlogAi(input,send)).rejects.toThrow();expect(send).not.toHaveBeenCalled()
 mocks.prepare.mockResolvedValue(undefined)
 const provider=vi.fn(async()=>new Response(JSON.stringify({id:'synthetic-generation',usage:{cost:0.125,total_tokens:42},choices:[{message:{content:'Synthetic'}}]}),{status:200}))
 await callNativeBlogAi(input,provider)
 expect(mocks.receipt).toHaveBeenCalledOnce();expect(provider).toHaveBeenCalledOnce()
})
it('timeout or ambiguous receipt commit reconciles once without another provider request',async()=>{
 const send=vi.fn(async()=>{throw new Error('timeout')})
 await expect(callNativeBlogAi(input,send)).rejects.toMatchObject({status:409})
 expect(send).toHaveBeenCalledOnce();expect(mocks.reconcile).toHaveBeenCalledOnce()
 mocks.receipt.mockRejectedValue(new Error('ambiguous COMMIT'))
 const provider=vi.fn(async()=>new Response(JSON.stringify({usage:{cost:0.125}}),{status:200}))
 await expect(callNativeBlogAi(input,provider)).rejects.toMatchObject({status:409})
 expect(provider).toHaveBeenCalledOnce()
})
describe('definitive provider answers fail without reconcile; only unknown outcomes reconcile',()=>{
 for(const status of [400,401,402,403,429])it(`HTTP ${status} is a known refusal`,async()=>{
  const provider=vi.fn(async()=>new Response(JSON.stringify({error:{message:'synthetic'}}),{status}))
  await expect(callNativeBlogAi(input,provider)).rejects.toBeInstanceOf(NativeBlogDefinitiveError)
  expect(provider).toHaveBeenCalledOnce();expect(mocks.reconcile).not.toHaveBeenCalled()
  expect(mocks.failure).toHaveBeenCalledWith(expect.anything(),'synthetic-operation','synthetic-claim',0,{httpStatus:status})
 })
 it('malformed JSON and an oversize body are known refusals',async()=>{
  await expect(callNativeBlogAi(input,vi.fn(async()=>new Response('{not json',{status:200})))).rejects.toBeInstanceOf(NativeBlogDefinitiveError)
  await expect(callNativeBlogAi(input,vi.fn(async()=>new Response('{}',{status:200,headers:{'content-length':'99999999'}})))).rejects.toBeInstanceOf(NativeBlogDefinitiveError)
  expect(mocks.reconcile).not.toHaveBeenCalled()
 })
 it('a body-level provider error with a 4xx code is known',async()=>{
  const provider=vi.fn(async()=>new Response(JSON.stringify({error:{code:402}}),{status:200}))
  await expect(callNativeBlogAi(input,provider)).rejects.toBeInstanceOf(NativeBlogDefinitiveError)
  expect(mocks.reconcile).not.toHaveBeenCalled()
 })
 it('5xx and a missing cost stay unknown and reconcile once',async()=>{
  await expect(callNativeBlogAi(input,vi.fn(async()=>new Response('{}',{status:502})))).rejects.toBeInstanceOf(NativeBlogUnknownOutcomeError)
  expect(mocks.reconcile).toHaveBeenCalledOnce()
  await expect(callNativeBlogAi(input,vi.fn(async()=>new Response(JSON.stringify({usage:{}}),{status:200})))).rejects.toBeInstanceOf(NativeBlogUnknownOutcomeError)
  expect(mocks.reconcile).toHaveBeenCalledTimes(2);expect(mocks.failure).not.toHaveBeenCalled()
 })
 it('optional work (the cover) leaves the operation alone even when its outcome is unknown',async()=>{
  const send=vi.fn(async()=>{throw new Error('timeout')})
  await expect(callNativeBlogAi({...input,index:2,optional:true},send)).rejects.toBeInstanceOf(NativeBlogUnknownOutcomeError)
  expect(mocks.reconcile).not.toHaveBeenCalled()
 })
})
