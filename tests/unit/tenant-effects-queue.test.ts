import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
const mocks=vi.hoisted(()=>({verify:vi.fn(),publish:vi.fn()}))
vi.mock('@upstash/qstash',()=>({Receiver:class{verify=mocks.verify},Client:class{publishJSON=mocks.publish}}))
vi.mock('@/lib/data/tenant-effect-authority-runtime',()=>({tenantEffectsSelected:()=>process.env.OWNED_TENANT_EFFECTS_ENABLED==='true'}))
import {verifyNativeTenantWork,publishNativeTenantWork,nativeQueueUrl} from '@/lib/tenant-effects/queue'
beforeEach(()=>{
 vi.stubEnv('OWNED_AUTH_ENABLED','true');vi.stubEnv('OWNED_TENANT_EFFECTS_ENABLED','true')
 vi.stubEnv('NEXT_PUBLIC_APP_URL','https://synthetic.example');vi.stubEnv('QSTASH_TOKEN','synthetic-offline');vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY','synthetic-current');vi.stubEnv('QSTASH_NEXT_SIGNING_KEY','synthetic-next')
 mocks.verify.mockReset().mockResolvedValue(true);mocks.publish.mockReset().mockResolvedValue({})
})
afterEach(()=>vi.unstubAllEnvs())
const request=(body:unknown)=>new Request('https://internal.invalid/api/internal/native-tenant-effects',{method:'POST',body:JSON.stringify(body),headers:{'upstash-signature':'synthetic-signature'}})
it('verifies exact raw bytes against the pinned public URL before accepting only a single operation capability',async()=>{
 const id=randomUUID(),raw={operationId:id}
 await expect(verifyNativeTenantWork(request(raw),'ai')).resolves.toBe(id)
 expect(mocks.verify).toHaveBeenCalledWith({signature:'synthetic-signature',body:JSON.stringify(raw),url:'https://synthetic.example/api/internal/native-tenant-effects'})
 await expect(verifyNativeTenantWork(request({...raw,role:'superadmin'}),'ai')).rejects.toMatchObject({status:400})
 mocks.verify.mockResolvedValue(false)
 await expect(verifyNativeTenantWork(request(raw),'ai')).rejects.toMatchObject({status:401})
})
it('refuses oversized bodies and unconfigured authority without contacting a provider',async()=>{
 await expect(verifyNativeTenantWork(request({operationId:'x'.repeat(9000)}),'ai')).rejects.toMatchObject({status:413})
 expect(mocks.verify).not.toHaveBeenCalled()
 vi.stubEnv('QSTASH_TOKEN','')
 await expect(publishNativeTenantWork('ai',randomUUID())).rejects.toMatchObject({status:503})
 expect(mocks.publish).not.toHaveBeenCalled()
})
it('pins worker paths and gives a continuation its own deduplication key without a browser actor/token',async()=>{
 expect(()=>nativeQueueUrl('ai',{NATIVE_TENANT_EFFECTS_WORKER_URL:'https://synthetic.example/api/other'})).toThrow()
 const id=randomUUID();await publishNativeTenantWork('ai',id,2)
 expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({body:{operationId:id},deduplicationId:`xmartmenu-native:ai:${id}:2`,retries:5}))
})
