import {beforeEach,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({rows:{} as Record<string,unknown>,revalidate:vi.fn()}))
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}))
vi.mock('@/lib/data/admin-menus-runtime',()=>({ownedAdminTransaction:async(_write:boolean,operation:(query:unknown)=>Promise<unknown>)=>operation(async(sql:string)=>({rows:sql.includes('public.tenants')?[mocks.rows.tenant].filter(Boolean):[mocks.rows.post].filter(Boolean)}))}))
vi.mock('@/lib/blog/native/authority-runtime',()=>({currentNativeBlogActor:vi.fn()}))
vi.mock('@/lib/blog/native/runtime',()=>({nativeBlogPhase:vi.fn()}))
vi.mock('@/lib/blog/native/generation',()=>({generateNativeBlogPost:vi.fn()}))
vi.mock('@/lib/blog/native/rss',()=>({fetchNativeBlogRss:vi.fn()}))
vi.mock('@/lib/blog/native/telegram',()=>({saveNativeTelegramSettings:vi.fn(),checkNativeTelegramWebhook:vi.fn()}))
vi.mock('@/lib/blog/native/admin-data',()=>({readNativeBlogState:vi.fn(),saveNativeBlogSettings:vi.fn(),decideNativeBlogPost:vi.fn(),changeNativeRssSource:vi.fn()}))
import {nativeTenantBlogPublicPaths} from '@/lib/blog/native/actions'
const actor=(scope:string|null)=>({actorId:'a',sessionHash:'h',scope,projectId:'p',subject:'s',authenticatedAt:1,checkedAt:1})
beforeEach(()=>{mocks.rows={tenant:{slug:'cafe'},post:{slug:'first-post'}}})
it('a tenant publish refreshes the slug blog list, the feed and the post page',async()=>{
 expect(await nativeTenantBlogPublicPaths(actor('11111111-1111-4111-8111-111111111111'),'22222222-2222-4222-8222-222222222222')).toEqual(['/cafe/blog','/cafe/blog/rss.xml','/cafe/blog/first-post'])
})
it('without a post only the list and the feed are refreshed; an unknown tenant refreshes nothing',async()=>{
 expect(await nativeTenantBlogPublicPaths(actor('11111111-1111-4111-8111-111111111111'))).toEqual(['/cafe/blog','/cafe/blog/rss.xml'])
 mocks.rows={}
 expect(await nativeTenantBlogPublicPaths(actor('11111111-1111-4111-8111-111111111111'))).toEqual([])
})
it('the platform blog keeps its own path',async()=>{
 expect(await nativeTenantBlogPublicPaths(actor(null))).toEqual(['/blog'])
})
