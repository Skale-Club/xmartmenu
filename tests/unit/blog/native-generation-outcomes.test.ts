import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({
 facts:vi.fn(),requireFacts:vi.fn(),reserve:vi.fn(),claim:vi.fn(),finish:vi.fn(),reconcile:vi.fn(),fail:vi.fn(),ambiguous:vi.fn(),prepare:vi.fn(),record:vi.fn(),
 call:vi.fn(),upload:vi.fn(),query:vi.fn(),inserts:[] as unknown[][],plain:{length:1000},
}))
vi.mock('@/lib/data/admin-menus-runtime',()=>({ownedAdminTransaction:async(_write:boolean,operation:(query:unknown)=>Promise<unknown>)=>operation(mocks.query)}))
vi.mock('@/lib/storage',()=>({getNativeStorageClient:()=>({upload:mocks.upload})}))
vi.mock('@/lib/blog/generator',()=>({buildBlogEditorialPrompt:()=>({systemMessage:'system',allowedLinkPaths:[]}),parseGeneratedPost:(raw:string)=>JSON.parse(raw),hashSeed:()=>1,readingTimeMinutes:()=>3}))
vi.mock('@/lib/blog/prompt',()=>({assignPillar:()=>({pillar:{id:'pillar',label:'Pillar'}}),TENANT_BLOG_PILLARS:[],sanitizeGeneratedLinks:(content:string)=>content}))
vi.mock('@/lib/blog/content-validator',()=>({sanitizeBlogHtml:(content:string)=>content,getPlainTextLength:()=>mocks.plain.length,slugifyTitle:()=>'synthetic-title'}))
vi.mock('@/lib/blog/contract',()=>({MIN_PLAIN_TEXT_CHARS:600,MAX_PLAIN_TEXT_CHARS:4000}))
vi.mock('@/lib/blog/schedule',()=>({isRunDue:()=>({due:true})}))
vi.mock('@/lib/blog/cover-image',()=>({coverPrompt:()=>'prompt',normaliseTo16x9:async(buffer:Buffer)=>({buffer,mime:'image/webp',extension:'webp'})}))
vi.mock('@/lib/data/tenant-effect-operations',()=>({tenantEffectDigest:()=>'d'.repeat(64)}))
vi.mock('@/lib/blog/native/runtime',()=>({nativeBlogPhase:async(context:unknown,_write:boolean,operation:(query:unknown,current:unknown)=>Promise<unknown>)=>operation(mocks.query,context)}))
vi.mock('@/lib/blog/native/generation-data',()=>({readNativeBlogGenerationFacts:mocks.facts,requireNativeBlogFacts:mocks.requireFacts}))
vi.mock('@/lib/blog/native/operations',()=>({reserveNativeBlogOperation:mocks.reserve,claimNativeBlogOperation:mocks.claim,prepareNativeBlogCall:mocks.prepare,recordNativeBlogCall:mocks.record,finishNativeBlogOperation:mocks.finish,reconcileNativeBlogOperation:mocks.reconcile,failNativeBlogOperation:mocks.fail,ambiguousNativeBlogCoverCalls:mocks.ambiguous,expireStaleNativeBlogOperations:async()=>0}))
vi.mock('@/lib/blog/native/authority',()=>({nativeBlogScope:()=>null,lockNativeBlogScope:async()=>undefined}))
vi.mock('@/lib/blog/native/provider-call',()=>({callNativeBlogAi:mocks.call}))
vi.mock('@/lib/blog/native/telegram',()=>({reserveNativeDraftNotification:async()=>null,dispatchNativeDraftNotification:async()=>({status:'pending'}),drainNativeDraftNotifications:async()=>undefined}))
import {generateNativeBlogPost} from '@/lib/blog/native/generation'
import {NativeBlogDefinitiveError,NativeBlogUnknownOutcomeError} from '@/lib/blog/native/outcome'
import {AdminMenuError} from '@/lib/data/admin-menus'
const context={kind:'cron' as const,scope:null}
const settings={enabled:true,posts_per_day:1,posting_hour:null,last_run_at:null,image_model:'synthetic/image',text_model:'synthetic/text',auto_publish:true,timezone:'UTC',enable_trend_analysis:false}
const text=(content:string)=>({choices:[{message:{content}}]})
const generated=JSON.stringify({title:'Synthetic title',content:'<p>Body</p>',excerpt:'Excerpt',metaDescription:'Meta',focusKeyword:'key',tags:'a,b,c'})
const image={choices:[{message:{images:[{image_url:{url:'data:image/png;base64,'+Buffer.from('synthetic-image').toString('base64')}}]}}]}
beforeEach(()=>{
 vi.clearAllMocks();mocks.inserts.length=0;mocks.plain.length=1000
 const facts={scope:null,settings,choice:{apiKey:'synthetic',keySource:'platform',billable:false,markupPct:0},tenantContext:null,editorial:{posts:[],feedback:[]},recentPillars:[],rssItem:null,digest:'a'.repeat(64)}
 mocks.facts.mockResolvedValue(facts);mocks.requireFacts.mockResolvedValue(facts)
 mocks.reserve.mockResolvedValue({id:'operation',status:'reserved',claimId:null,result:null,input:{}})
 mocks.claim.mockResolvedValue({id:'operation',status:'running',claimId:'claim',result:null,input:{}})
 for(const fn of [mocks.finish,mocks.reconcile,mocks.fail,mocks.ambiguous,mocks.prepare,mocks.record])fn.mockResolvedValue(undefined)
 mocks.upload.mockResolvedValue('https://synthetic.example/cover.webp')
 mocks.query.mockImplementation(async(sql:string,values:unknown[]=[])=>{if(sql.includes('INSERT INTO public.blog_posts'))mocks.inserts.push(values);return {rows:[]}})
 mocks.call.mockImplementation(async(input:{index:number})=>input.index===0?text('Synthetic topic'):input.index===1?text(generated):image)
})
const run=()=>generateNativeBlogPost(context,{trigger:'manual',requestKey:'synthetic-key'})
describe('definitive failures never leave a tenant blocked',()=>{
 it('provider refusal (401/402/429) closes the operation as failed, not reconcile',async()=>{
  mocks.call.mockRejectedValueOnce(new NativeBlogDefinitiveError('AI provider refused the request (HTTP 402)'))
  const result=await run()
  expect(result).toMatchObject({status:'failed',error:'AI provider refused the request (HTTP 402)'})
  expect(mocks.fail).toHaveBeenCalledOnce();expect(mocks.reconcile).not.toHaveBeenCalled()
 })
 it('content with the wrong size is a definitive failure',async()=>{
  mocks.plain.length=10
  const result=await run()
  expect(result.status).toBe('failed');expect(mocks.fail).toHaveBeenCalledOnce();expect(mocks.reconcile).not.toHaveBeenCalled()
 })
 it('malformed generated JSON is a definitive failure',async()=>{
  mocks.call.mockImplementation(async(input:{index:number})=>input.index===0?text('Synthetic topic'):text('not json'))
  expect((await run()).status).toBe('failed');expect(mocks.fail).toHaveBeenCalledOnce();expect(mocks.reconcile).not.toHaveBeenCalled()
 })
 it('a genuinely unknown provider outcome still reconciles',async()=>{
  mocks.call.mockRejectedValueOnce(new NativeBlogUnknownOutcomeError())
  const result=await run()
  expect(result.status).toBe('failed');expect(mocks.reconcile).toHaveBeenCalledOnce();expect(mocks.fail).not.toHaveBeenCalled()
 })
 it('an unseen commit of the final publish is unknown, not silently failed',async()=>{
  mocks.query.mockImplementation(async(sql:string)=>{if(sql.includes('INSERT INTO public.blog_posts'))throw new Error('connection lost');return {rows:[]}})
  expect((await run()).status).toBe('failed');expect(mocks.reconcile).toHaveBeenCalledOnce();expect(mocks.fail).not.toHaveBeenCalled()
 })
})
describe('the cover is optional and never discards the paid post',()=>{
 it('unknown cover outcome publishes with cover=null and keeps the call reviewable',async()=>{
  mocks.call.mockImplementation(async(input:{index:number;optional?:boolean})=>{
   if(input.index===2){expect(input.optional).toBe(true);throw new NativeBlogUnknownOutcomeError()}
   return input.index===0?text('Synthetic topic'):text(generated)
  })
  const result=await run()
  expect(result).toMatchObject({status:'generated',coverSkipped:true})
  expect(mocks.inserts).toHaveLength(1);expect(mocks.inserts[0][10]).toBeNull()
  expect(mocks.ambiguous).toHaveBeenCalledOnce();expect(mocks.finish).toHaveBeenCalledOnce();expect(mocks.reconcile).not.toHaveBeenCalled();expect(mocks.fail).not.toHaveBeenCalled()
 })
 it('upload failure publishes with cover=null',async()=>{
  mocks.upload.mockRejectedValue(new Error('storage down'))
  const result=await run()
  expect(result.status).toBe('generated');expect(mocks.inserts[0][10]).toBeNull();expect(mocks.ambiguous).toHaveBeenCalledOnce()
 })
 it('a healthy cover is attached',async()=>{
  const result=await run()
  expect(result.status).toBe('generated');expect(mocks.inserts[0][10]).toBe('https://synthetic.example/cover.webp')
 })
})
describe('adminMenuTransaction reports every failure, a COMMIT timeout included, as 503: after a paid call that is unknown',()=>{
 const unavailable=()=>new AdminMenuError(503,'Menu service is unavailable')
 it('503 while publishing reconciles instead of failing (a repeat would pay and publish twice)',async()=>{
  mocks.query.mockImplementation(async(sql:string)=>{if(sql.includes('INSERT INTO public.blog_posts'))throw unavailable();return {rows:[]}})
  expect((await run()).status).toBe('failed');expect(mocks.reconcile).toHaveBeenCalledOnce();expect(mocks.fail).not.toHaveBeenCalled()
 })
 it('503 while saving draft_payload reconciles',async()=>{
  mocks.query.mockImplementation(async(sql:string)=>{if(sql.includes('draft_payload'))throw unavailable();return {rows:[]}})
  await run();expect(mocks.reconcile).toHaveBeenCalledOnce();expect(mocks.fail).not.toHaveBeenCalled();expect(mocks.inserts).toHaveLength(0)
 })
 it('503 raised by a step after a call went out reconciles; a 4xx there is still a final failure',async()=>{
  mocks.call.mockRejectedValueOnce(unavailable())
  await run();expect(mocks.reconcile).toHaveBeenCalledOnce()
  vi.clearAllMocks()
  mocks.call.mockRejectedValueOnce(new AdminMenuError(409,'Blog configuration changed'))
  await run();expect(mocks.fail).toHaveBeenCalledOnce();expect(mocks.reconcile).not.toHaveBeenCalled()
 })
 it('503 before any paid call left is still a final failure',async()=>{
  mocks.query.mockImplementation(async(sql:string)=>{if(sql.includes('pillar_id'))throw unavailable();return {rows:[]}})
  await run();expect(mocks.fail).toHaveBeenCalledOnce();expect(mocks.reconcile).not.toHaveBeenCalled();expect(mocks.call).not.toHaveBeenCalled()
 })
})
