import {beforeEach,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({actor:vi.fn(),phase:vi.fn()}))
vi.mock('@/lib/blog/native/authority-runtime',()=>({currentNativeBlogActor:mocks.actor}))
vi.mock('@/lib/blog/native/runtime',()=>({nativeBlogPhase:mocks.phase}))
vi.mock('@/lib/blog/native/generation',()=>({generateNativeBlogPost:vi.fn()}))
vi.mock('@/lib/blog/native/telegram',()=>({saveNativeTelegramSettings:vi.fn()}))
vi.mock('@/lib/blog/native/rss',()=>({fetchNativeBlogRss:vi.fn()}))
import {nativeBlogAdminHttp} from '@/lib/blog/native/admin-http'
import {publicRssAddress} from '@/lib/blog/native/rss-fetch'
import {nativeBlogTelegramSchema,nativeBlogSettingsSchema} from '@/lib/blog/native/input'
beforeEach(()=>vi.clearAllMocks())
it('rejects cross-origin, role/tenant injection, malformed JSON and missing paid nonce before provider/SQL',async()=>{
 const request=(body:string,headers:Record<string,string>={})=>new Request('https://synthetic.example/api/superadmin/blog/generate',{method:'POST',body,headers:{'Content-Type':'application/json',host:'synthetic.example',origin:'https://synthetic.example',...headers}})
 expect((await nativeBlogAdminHttp('settings',request('{}',{origin:'https://other.example'}))).status).toBe(403)
 expect((await nativeBlogAdminHttp('settings',request('{"enabled":true,"role":"superadmin","tenant_id":"other"}'))).status).toBe(400)
 expect((await nativeBlogAdminHttp('settings',request('{'))).status).toBe(400)
 expect((await nativeBlogAdminHttp('generate',request('{}'))).status).toBe(400)
 expect(mocks.actor).not.toHaveBeenCalled();expect(mocks.phase).not.toHaveBeenCalled()
})
it('keeps configured timezone and Telegram body bounds explicit',()=>{
 expect(nativeBlogSettingsSchema.safeParse({timezone:'Not/AZone'}).success).toBe(false)
 expect(nativeBlogTelegramSchema.safeParse({chatIds:Array.from({length:21},()=>'-100123')}).success).toBe(false)
 expect(nativeBlogTelegramSchema.safeParse({botToken:'synthetic',actorId:'injected'}).success).toBe(false)
})
it('RSS cannot resolve loopback, private, link-local, mapped IPv4, multicast or internal IPv6 destinations',()=>{
 for(const address of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1'])expect(publicRssAddress(address)).toBe(false)
 expect(publicRssAddress('8.8.8.8')).toBe(true)
})
