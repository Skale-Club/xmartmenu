import {it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
const mocks=vi.hoisted(()=>({actor:vi.fn(),transaction:vi.fn()}))
vi.mock('@/lib/data/tenant-effect-authority-runtime',()=>({currentTenantEffectActor:mocks.actor,tenantEffectsSelected:()=>true}))
vi.mock('@/lib/data/admin-menus-runtime',()=>({ownedAdminTransaction:mocks.transaction}))
vi.mock('@/lib/tenant-effects/execute',()=>({executeNativeSeed:vi.fn(),executeNativeSingleImage:vi.fn(),executeNativeOcr:vi.fn(),executeNativeUpload:vi.fn()}))
vi.mock('@/lib/tenant-effects/upload',()=>({nativeMultipartImage:vi.fn()}))
import {nativeTenantEffectHttp} from '@/lib/tenant-effects/http'
it('rejects cross-origin mutations and cross-site status reads before any provider or SQL lookup',async()=>{
 const tenantId=randomUUID()
 const mutation=await nativeTenantEffectHttp('resync',new Request('https://synthetic.example/api/superadmin/tenants/'+tenantId+'/xphere-resync',{method:'POST',headers:{host:'synthetic.example',origin:'https://other.example'}}),tenantId)
 expect(mutation.status).toBe(403)
 const read=await nativeTenantEffectHttp('status',new Request('https://synthetic.example/api/status',{headers:{'sec-fetch-site':'cross-site'}}),tenantId)
 expect(read.status).toBe(403)
 expect(mocks.actor).not.toHaveBeenCalled();expect(mocks.transaction).not.toHaveBeenCalled()
})
