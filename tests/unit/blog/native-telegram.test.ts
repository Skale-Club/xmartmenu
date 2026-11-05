import {beforeEach,it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
const mocks=vi.hoisted(()=>({query:vi.fn(),gate:vi.fn(),reserve:vi.fn(),claim:vi.fn(),prepare:vi.fn(),receipt:vi.fn(),finish:vi.fn(),reconcile:vi.fn(),fail:vi.fn(),callFailure:vi.fn()}))
vi.mock('@/lib/blog/native/runtime',()=>({nativeBlogPhase:async(context:unknown,_write:boolean,operation:(query:unknown,current:unknown)=>Promise<unknown>)=>{await mocks.gate();return operation(mocks.query,context)}}))
vi.mock('@/lib/data/admin-menus-runtime',()=>({ownedAdminTransaction:async(_write:boolean,operation:(query:unknown)=>Promise<unknown>)=>operation(mocks.query)}))
vi.mock('@/lib/crypto',()=>({encryptApiKey:(raw:string)=>'cipher:'+raw,decryptApiKey:(raw:string)=>raw.slice(7)}))
vi.mock('@/lib/ai/openrouter',()=>({OPENROUTER_BASE_URL:'https://synthetic.example'}))
vi.mock('@/lib/blog/native/operations',()=>({reserveNativeBlogOperation:mocks.reserve,claimNativeBlogOperation:mocks.claim,prepareNativeBlogCall:mocks.prepare,recordNativeBlogCall:mocks.receipt,finishNativeBlogOperation:mocks.finish,reconcileNativeBlogOperation:mocks.reconcile,lockNativeBlogOperation:vi.fn(),failNativeBlogOperation:mocks.fail,expireStaleNativeBlogOperations:async()=>0,recordNativeBlogCallFailure:mocks.callFailure}))
import {saveNativeTelegramSettings} from '@/lib/blog/native/telegram'
const context={kind:'browser' as const,actor:{actorId:randomUUID(),sessionHash:'a'.repeat(64),scope:null,projectId:'synthetic',subject:'synthetic-subject',authenticatedAt:1,checkedAt:Date.now()}}
let settings:Record<string,unknown>,operation:Record<string,unknown>|null
beforeEach(()=>{
 vi.clearAllMocks();operation=null
 settings={id:randomUUID(),tenant_id:null,enabled:true,approvals_enabled:true,bot_token:'cipher:syntheticToken',approvals_bot_token:null,chat_ids:['-100123'],approvals_chat_ids:[],webhook_secret:'synthetic-secret'}
 mocks.query.mockImplementation(async(sql:string,values:unknown[]=[])=>{
  if(sql.startsWith('SELECT * FROM public.telegram_settings'))return {rows:[{...settings}]}
  if(sql.startsWith('UPDATE public.telegram_settings'))settings={...settings,enabled:values[2],bot_token:values[3],chat_ids:values[4],approvals_enabled:values[5],approvals_bot_token:values[6],approvals_chat_ids:values[7],webhook_secret:values[8]}
  return {rows:[{id:'synthetic-audit'}]}
 })
 mocks.reserve.mockImplementation(async(_q:unknown,_context:unknown,_kind:string,_key:string,input:unknown)=>operation??(operation={id:randomUUID(),status:'reserved',input,result:null}))
 mocks.claim.mockImplementation(async()=>{operation={...operation,status:'running',claimId:randomUUID()};return operation})
 mocks.reconcile.mockImplementation(async()=>{if(operation)operation.status='reconcile'})
 mocks.finish.mockImplementation(async(_q:unknown,_context:unknown,_id:string,_claim:string,result:unknown)=>{if(operation){operation.status='completed';operation.result=result}})
})
it('disable commits the local revocation before remote deletion and reports that truth after an ambiguous provider outcome',async()=>{
 const send=vi.fn(async()=>{expect(settings.webhook_secret).toBeNull();expect(settings.approvals_enabled).toBe(false);throw new Error('synthetic timeout')})
 const key=randomUUID(),result=await saveNativeTelegramSettings(context,{approvalsEnabled:false},key,send)
 expect(result).toMatchObject({ok:true,pending:true,webhook:null});expect(send).toHaveBeenCalledOnce();expect(mocks.reconcile).toHaveBeenCalledOnce()
 await expect(saveNativeTelegramSettings(context,{approvalsEnabled:false},key,send)).rejects.toMatchObject({status:409})
 expect(send).toHaveBeenCalledOnce()
})
it('unknown registration never saves a configuration as enabled and never repeats the same remote request',async()=>{
 settings={...settings,enabled:false,approvals_enabled:false,webhook_secret:null}
 const send=vi.fn(async()=>{throw new Error('synthetic uncertain response')}),key=randomUUID()
 await expect(saveNativeTelegramSettings(context,{enabled:true,approvalsEnabled:true},key,send)).rejects.toMatchObject({status:409})
 expect(settings.enabled).toBe(false);expect(settings.webhook_secret).toBeNull()
 await expect(saveNativeTelegramSettings(context,{enabled:true,approvalsEnabled:true},key,send)).rejects.toMatchObject({status:409})
 expect(send).toHaveBeenCalledOnce()
})
it('current authority refusal before claiming cannot contact Telegram',async()=>{
 mocks.gate.mockRejectedValueOnce(new Error('synthetic SQL authority denied'))
 const send=vi.fn();await expect(saveNativeTelegramSettings(context,{approvalsEnabled:false},randomUUID(),send)).rejects.toThrow()
 expect(send).not.toHaveBeenCalled();expect(mocks.claim).not.toHaveBeenCalled()
})
it('a wrong token (401) closes the operation as failed and tells the admin what to fix, without reconcile',async()=>{
 settings={...settings,enabled:false,approvals_enabled:false,webhook_secret:null}
 const send=vi.fn(async()=>new Response(JSON.stringify({ok:false,error_code:401,description:'Unauthorized'}),{status:401}))
 await expect(saveNativeTelegramSettings(context,{enabled:true,approvalsEnabled:true},randomUUID(),send)).rejects.toMatchObject({status:409,message:expect.stringContaining('HTTP 401')})
 expect(mocks.fail).toHaveBeenCalledOnce();expect(mocks.reconcile).not.toHaveBeenCalled()
 expect(settings.enabled).toBe(false)
})
it('turning approvals off after a refused deletion succeeds locally and leaves nothing pending',async()=>{
 const send=vi.fn(async()=>new Response('{}',{status:401}))
 const result=await saveNativeTelegramSettings(context,{approvalsEnabled:false},randomUUID(),send)
 expect(result).toMatchObject({ok:true,webhook:null,pending:true});expect(settings.webhook_secret).toBeNull()
 expect(mocks.fail).toHaveBeenCalledOnce();expect(mocks.reconcile).not.toHaveBeenCalled()
})
it('a 5xx from Telegram stays unknown and reconciles',async()=>{
 settings={...settings,enabled:false,approvals_enabled:false,webhook_secret:null}
 const send=vi.fn(async()=>new Response('{}',{status:502}))
 await expect(saveNativeTelegramSettings(context,{enabled:true,approvalsEnabled:true},randomUUID(),send)).rejects.toMatchObject({status:409})
 expect(mocks.reconcile).toHaveBeenCalledOnce();expect(mocks.fail).not.toHaveBeenCalled()
})
it('an earlier pending operation bars enabling but never disabling',async()=>{
 const send=vi.fn(async()=>new Response(JSON.stringify({ok:true,result:true}),{status:200}))
 await saveNativeTelegramSettings(context,{approvalsEnabled:false},randomUUID(),send)
 expect(mocks.reserve.mock.calls.at(-1)?.[6]).toBe(false)
 operation=null
 settings={...settings,enabled:false,approvals_enabled:false,webhook_secret:null}
 await saveNativeTelegramSettings(context,{enabled:true,approvalsEnabled:true},randomUUID(),send)
 expect(mocks.reserve.mock.calls.at(-1)?.[6]).toBe(true)
})
