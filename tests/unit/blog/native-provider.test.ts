import {beforeEach,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({prepare:vi.fn(),receipt:vi.fn(),reconcile:vi.fn(),facts:vi.fn()}))
vi.mock('@/lib/ai/openrouter',()=>({OPENROUTER_BASE_URL:'https://synthetic.example/api/v1'}))
vi.mock('@/lib/blog/native/runtime',()=>({nativeBlogPhase:async(context:unknown,_write:boolean,operation:(query:unknown,current:unknown)=>Promise<unknown>)=>operation({},context)}))
vi.mock('@/lib/data/admin-menus-runtime',()=>({ownedAdminTransaction:async(_write:boolean,operation:(query:unknown)=>Promise<unknown>)=>operation({})}))
vi.mock('@/lib/blog/native/generation-data',()=>({requireNativeBlogFacts:mocks.facts}))
vi.mock('@/lib/blog/native/operations',()=>({prepareNativeBlogCall:mocks.prepare,recordNativeBlogCall:mocks.receipt,reconcileNativeBlogOperation:mocks.reconcile}))
import {nativeBlogUsage,callNativeBlogAi} from '@/lib/blog/native/provider-call'
beforeEach(()=>{vi.clearAllMocks();mocks.prepare.mockResolvedValue(undefined);mocks.receipt.mockResolvedValue(undefined);mocks.reconcile.mockResolvedValue(undefined)})
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
