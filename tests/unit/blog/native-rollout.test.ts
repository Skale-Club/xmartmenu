import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({tx:vi.fn(),posts:vi.fn(),tags:vi.fn(),archive:vi.fn()}))
vi.mock('@/lib/data/admin-menus-runtime',()=>({ownedAdminTransaction:mocks.tx}))
vi.mock('@/lib/seo',async importOriginal=>({...await importOriginal<typeof import('@/lib/seo')>(),PLATFORM_BASE:'https://synthetic.example'}))
vi.mock('@/lib/blog/native/public-data',()=>({readNativePublishedPosts:mocks.posts,readNativeBlogTags:mocks.tags,readNativeBlogArchive:mocks.archive}))
import {nativeBlogFlagProblem,nativeBlogFlagsReady,reportNativeBlogFlags,legacyBlogWritesBlocked} from '@/lib/blog/native/flags'
import {nativeBlogSelected,requireNativeBlogConfiguration} from '@/lib/blog/native/selected'
import {nativePlatformSitemap} from '@/lib/blog/native/sitemap'
describe('flag combinations',()=>{
 it('auth alone does not select the native blog (pages and sitemap keep serving)',()=>{
  expect(nativeBlogSelected({OWNED_AUTH_ENABLED:'true'})).toBe(false)
  expect(nativeBlogSelected({OWNED_AUTH_ENABLED:'true',OWNED_BLOG_ENABLED:'false'})).toBe(false)
  expect(nativeBlogFlagProblem({OWNED_AUTH_ENABLED:'true'})).toBeNull()
 })
 it('both flags select it; nothing set is the quiet default',()=>{
  expect(nativeBlogSelected({OWNED_AUTH_ENABLED:'true',OWNED_BLOG_ENABLED:'true'})).toBe(true)
  expect(nativeBlogFlagsReady({})).toBe(false);expect(nativeBlogFlagProblem({})).toBeNull()
 })
 it('blog without auth is the invalid combination: reported clearly, native stays off, nothing throws',()=>{
  const env={OWNED_BLOG_ENABLED:'true',OWNED_AUTH_ENABLED:'false'}
  expect(nativeBlogSelected(env)).toBe(false)
  expect(nativeBlogFlagProblem(env)).toContain('OWNED_BLOG_ENABLED=true requires OWNED_AUTH_ENABLED=true')
  const log=vi.fn();expect(reportNativeBlogFlags(env,log)).not.toBeNull();expect(log).toHaveBeenCalledOnce()
  expect(String(log.mock.calls[0][0])).toContain('[native-blog]')
 })
 it('a malformed value is reported rather than guessed',()=>{
  expect(nativeBlogFlagProblem({OWNED_BLOG_ENABLED:'yes'})).toContain('must be "true" or "false"')
 })
})
describe('legacy blog writes are refused once data lives in the owned database',()=>{
 it('auth on without the blog flag blocks cron and mutations but still selects the legacy path for public reads',()=>{
  for(const env of [{OWNED_AUTH_ENABLED:'true'},{OWNED_AUTH_ENABLED:'true',OWNED_BLOG_ENABLED:'false'}]){
   expect(legacyBlogWritesBlocked(env)).toBe(true);expect(nativeBlogSelected(env)).toBe(false)
  }
 })
 it('is not blocked when auth is off, or when the native blog is on',()=>{
  expect(legacyBlogWritesBlocked({})).toBe(false);expect(legacyBlogWritesBlocked({OWNED_BLOG_ENABLED:'true'})).toBe(false)
  expect(legacyBlogWritesBlocked({OWNED_AUTH_ENABLED:'true',OWNED_BLOG_ENABLED:'true'})).toBe(false)
 })
})
describe('platform sitemap degrades by block and never throws',()=>{
 beforeEach(()=>{
  vi.clearAllMocks()
  vi.stubEnv('OWNED_BLOG_ENABLED','true');vi.stubEnv('OWNED_AUTH_ENABLED','true')
  mocks.posts.mockResolvedValue([{slug:'first',published_at:'2026-01-02T00:00:00Z'}]);mocks.tags.mockResolvedValue([{slug:'tag'}]);mocks.archive.mockResolvedValue([{year:2026,month:1}])
  mocks.tx.mockImplementation(async(_write:boolean,operation:(query:unknown)=>Promise<unknown>)=>operation(async(sql:string)=>({rows:sql.includes('public.tenants')?[{slug:'cafe',updated_at:new Date(),custom_domain:null,custom_domain_verified:false}]:[]})))
 })
 afterEach(()=>vi.unstubAllEnvs())
 const urls=async()=>(await nativePlatformSitemap()).map(entry=>entry.url)
 it('returns tenants and blog entries when healthy',async()=>{
  const list=await urls()
  expect(list).toContain('https://synthetic.example');expect(list).toContain('https://synthetic.example/cafe');expect(list).toContain('https://synthetic.example/blog/first')
 })
 it('a failing blog read keeps the landing page and the tenant block',async()=>{
  mocks.posts.mockRejectedValue(new Error('db down'))
  const list=await urls()
  expect(list).toContain('https://synthetic.example/cafe');expect(list).not.toContain('https://synthetic.example/blog')
 })
 it('a failing tenant read keeps the blog block',async()=>{
  mocks.tx.mockImplementationOnce(async()=>{throw new Error('db down')})
  const list=await urls()
  expect(list).not.toContain('https://synthetic.example/cafe');expect(list).toContain('https://synthetic.example/blog/first')
 })
 // The static marketing pages (landing, /pricing) never depend on the database.
 it('total database failure and a bad configuration still return the static marketing entries (never a 500)',async()=>{
  mocks.tx.mockRejectedValue(new Error('db down'))
  expect(await urls()).toEqual(['https://synthetic.example','https://synthetic.example/pricing'])
  vi.stubEnv('OWNED_AUTH_ENABLED','false')
  expect(await urls()).toEqual(['https://synthetic.example','https://synthetic.example/pricing'])
  expect(()=>requireNativeBlogConfiguration()).toThrow()
 })
})
