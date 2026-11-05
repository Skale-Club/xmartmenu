import {beforeEach,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({state:{} as Record<string,unknown>}))
vi.mock('@/lib/data/ai-access',()=>({readPlatformAiRecord:async()=>({openrouter_api_key:null,default_billing_mode:'platform',default_markup_pct:30}),readTenantAiRecord:async()=>null}))
vi.mock('@/lib/crypto',()=>({decryptApiKey:(value:string)=>value}))
vi.mock('@/lib/ai/openrouter',()=>({platformOpenRouterKey:()=>'synthetic-platform-key'}))
vi.mock('@/lib/blog/native/authority',()=>({nativeBlogScope:(context:{scope:string|null})=>context.scope,requireNativeBlogContext:async()=>({slug:'cafe',name:'Cafe'})}))
import {readNativeBlogGenerationFacts,requireNativeBlogFacts} from '@/lib/blog/native/generation-data'
const scope='11111111-1111-4111-8111-111111111111'
const context={kind:'cron' as const,scope}
const query=async(sql:string)=>{
 const rows=(value:unknown)=>({rows:Array.isArray(value)?value:[value]})
 if(sql.includes('FROM public.blog_settings'))return rows(mocks.state.settings)
 if(sql.includes('FROM public.tenant_settings'))return rows({address:mocks.state.address,business_type:'restaurant'})
 if(sql.includes('FROM public.categories'))return rows([{name:'Mains'}])
 if(sql.includes('FROM public.products'))return rows(mocks.state.dishes)
 if(sql.includes('FROM public.blog_posts'))return rows(mocks.state.posts)
 if(sql.includes('FROM public.blog_post_feedback'))return rows(mocks.state.feedback)
 if(sql.includes('FROM public.blog_generation_jobs'))return {rows:[]}
 if(sql.includes('FROM public.blog_rss_items'))return {rows:[]}
 return {rows:[]}
}
beforeEach(()=>{
 mocks.state.settings={id:'s',tenant_id:scope,enabled:true,posts_per_day:1,text_model:'synthetic/text',image_model:'',openrouter_api_key:null,last_run_at:null,updated_at:new Date(),lock_acquired_at:null,rss_enabled:false,seo_keywords:'',timezone:'UTC'}
 mocks.state.address='Rua A';mocks.state.dishes=[{name:'Feijoada',description:'x',category:'Mains'}];mocks.state.posts=[{title:'One',slug:'one',status:'published',focus_keyword:null}];mocks.state.feedback=[]
})
const digest=async()=>(await readNativeBlogGenerationFacts(query as never,context))!.digest
it('editing a dish, the address, a post or feedback during generation does not change the authorisation digest',async()=>{
 const before=await digest()
 mocks.state.dishes=[{name:'Feijoada completa',description:'edited',category:'Mains'},{name:'New dish',description:null,category:null}]
 mocks.state.address='Rua B';mocks.state.posts=[{title:'Two',slug:'two',status:'draft',focus_keyword:'k'}];mocks.state.feedback=[{post_title:'One',verdict:'approved',reason:null}]
 expect(await digest()).toBe(before)
 await expect(requireNativeBlogFacts(query as never,context,before)).resolves.toBeTruthy()
})
it('the snapshot still carries the editorial context taken at the start',async()=>{
 const facts=await readNativeBlogGenerationFacts(query as never,context)
 expect(facts?.tenantContext?.dishes[0].name).toBe('Feijoada');expect(facts?.editorial.posts[0].title).toBe('One')
})
it('configuration, key and billing changes still invalidate the paid operation',async()=>{
 const before=await digest()
 mocks.state.settings={...(mocks.state.settings as object),text_model:'synthetic/other'}
 expect(await digest()).not.toBe(before)
 await expect(requireNativeBlogFacts(query as never,context,before)).rejects.toMatchObject({status:409})
 mocks.state.settings={...(mocks.state.settings as object),text_model:'synthetic/text',openrouter_api_key:'new-key'}
 expect(await digest()).not.toBe(before)
})
