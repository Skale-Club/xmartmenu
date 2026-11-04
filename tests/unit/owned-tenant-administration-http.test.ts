import { beforeEach,describe,it,expect,vi } from 'vitest'
const runtime=vi.hoisted(()=>({ownedPlans:vi.fn(),ownedTenants:vi.fn(),ownedTenantSettings:vi.fn(),ownedTenantMenuRows:vi.fn()}))
vi.mock('@/lib/data/tenant-administration-runtime',()=>runtime)
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
import { ownedTenantAdministrationHttp } from '@/lib/admin/owned-tenant-administration-http'
import { AdminMenuError } from '@/lib/data/admin-menus'
const request=(method='POST',body:unknown={name:'Shop',slug:'shop',owner_user_id:'exact-uuid'},origin='https://example.test')=>new Request('https://example.test/api/superadmin/tenants',{method,headers:{origin,'content-type':'application/json'},...(method==='GET'||method==='DELETE'?{}:{body:JSON.stringify(body)})})
describe('native administration HTTP boundary',()=>{
 beforeEach(()=>vi.clearAllMocks())
 it('rejects cross-origin mutations before runtime or data access',async()=>{
  expect((await ownedTenantAdministrationHttp('tenants',request('POST',{},'https://other.test'))).status).toBe(403)
  expect(runtime.ownedTenants).not.toHaveBeenCalled()
 })
 it('uses exact bounded JSON input, returns truthful creation/disable and delete semantics without credentials',async()=>{
  runtime.ownedTenants.mockResolvedValue({tenant:{id:'new'},owner_id:'exact-uuid',externalSync:'pending-native-dispatch'})
  const response=await ownedTenantAdministrationHttp('tenants',request());expect(response.status).toBe(201)
  expect(runtime.ownedTenants).toHaveBeenCalledWith('create',undefined,{name:'Shop',slug:'shop',owner_user_id:'exact-uuid'})
  expect((await response.json()).credentials).toBeUndefined()
  runtime.ownedPlans.mockResolvedValue(null);expect((await ownedTenantAdministrationHttp('plans',request('DELETE'),'plan')).status).toBe(204)
 })
 it('fails closed on owned denial and reports archive conflicts without claiming a deletion',async()=>{
  runtime.ownedTenants.mockRejectedValue(new AdminMenuError(409,'Deactivate this restaurant instead'))
  const response=await ownedTenantAdministrationHttp('tenants',request('DELETE'),'tenant')
  expect(response.status).toBe(409);expect(await response.json()).toEqual({error:'Deactivate this restaurant instead'})
  runtime.ownedTenants.mockRejectedValue(new Error('private SQL details'))
  expect(await (await ownedTenantAdministrationHttp('tenants')).json()).toEqual({error:'Tenant administration is unavailable'})
 })
 it('rejects unsupported content types, malformed and oversized streams before write',async()=>{
  const invalid=new Request('https://example.test/api/superadmin/tenants',{method:'POST',headers:{origin:'https://example.test','content-type':'text/plain'},body:'{}'})
  expect((await ownedTenantAdministrationHttp('tenants',invalid)).status).toBe(400)
  expect((await ownedTenantAdministrationHttp('tenants',request('POST',{name:'x'.repeat(65536)}))).status).toBe(413)
  const malformed=new Request('https://example.test/api/superadmin/tenants',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:'{'})
  expect((await ownedTenantAdministrationHttp('tenants',malformed)).status).toBe(400);expect(runtime.ownedTenants).not.toHaveBeenCalled()
 })
})
