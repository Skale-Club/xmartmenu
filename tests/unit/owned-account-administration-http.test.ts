import {beforeEach,describe,it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
const mocks=vi.hoisted(()=>({effective:vi.fn(),principal:vi.fn(),require:vi.fn(),context:vi.fn(),mutate:vi.fn(),staff:vi.fn(),users:vi.fn(),source:vi.fn()}))
vi.mock('@/lib/get-effective-tenant',()=>({getEffectiveTenant:mocks.effective}))
vi.mock('@/lib/auth/owned-principal-runtime',()=>({getOwnedPrincipal:mocks.principal}))
vi.mock('@/lib/data/account-administration-runtime',()=>({requireAccountAdministration:mocks.require,accountAdministrationContext:mocks.context,
 accountAdministrationMutation:mocks.mutate,readOwnedStaffAccounts:mocks.staff,readOwnedAdminAccounts:mocks.users}))
vi.mock('@/lib/supabase/server',()=>({createClient:mocks.source,createServiceClient:mocks.source}))
import {ownedAccountsHttp,ownedStaffAccountsHttp} from '@/lib/admin/owned-account-administration-http'
import {AdminMenuError} from '@/lib/data/admin-menus'
const tenant=randomUUID(),recipient=randomUUID(),actor=randomUUID()
const request=(method='GET',body?:object,origin='https://menu.test')=>new Request('https://menu.test/api/admin/staff',{method,headers:{host:'menu.test',origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
beforeEach(()=>{vi.resetAllMocks();mocks.effective.mockResolvedValue({tenantId:tenant,role:'store-admin'});mocks.principal.mockResolvedValue({userId:actor,role:'superadmin'});mocks.context.mockResolvedValue({actorId:actor});mocks.staff.mockResolvedValue([]);mocks.users.mockResolvedValue([]);mocks.mutate.mockResolvedValue({id:randomUUID(),code:'x'.repeat(43),expires_at:new Date(Date.now()+60000).toISOString(),kind:'invite',recipient_user_id:recipient})})
describe('native account/staff HTTP contracts',()=>{
 it('lists native data and issues explicit ownership invitations without passwords or profile creation',async()=>{
  const listed=await ownedStaffAccountsHttp(request());expect(listed.status).toBe(200);expect(await listed.json()).toEqual([])
  const response=await ownedStaffAccountsHttp(request('POST',{recipient_user_id:recipient}));expect(response.status).toBe(201)
  const data=await response.json();expect(data.credentials).toBeUndefined();expect(data.invitation.url).toBe('/staff-access?invite='+'x'.repeat(43));expect(data.invitation.recipient_user_id).toBe(recipient)
  expect(mocks.mutate).toHaveBeenCalledWith('invite',recipient,undefined,tenant,false);expect(mocks.source).not.toHaveBeenCalled()
 })
 it('refuses native feature denial before any legacy effective-tenant fallback and rejects unauthorized staff',async()=>{
  mocks.require.mockImplementation(()=>{throw new AdminMenuError(503,'unavailable')})
  expect((await ownedStaffAccountsHttp(request())).status).toBe(503);expect(mocks.effective).not.toHaveBeenCalled();expect(mocks.source).not.toHaveBeenCalled()
  mocks.require.mockReset();mocks.effective.mockResolvedValue({tenantId:tenant,role:'store-staff'})
  expect((await ownedStaffAccountsHttp(request('POST',{recipient_user_id:recipient}))).status).toBe(403);expect(mocks.mutate).not.toHaveBeenCalled()
 })
 it('denies cross-origin and injected contact/tenant/role fields before any account mutation',async()=>{
  expect((await ownedStaffAccountsHttp(request('POST',{recipient_user_id:recipient},'https://evil.test'))).status).toBe(403)
  for(const body of [{name:'New staff',email:'same@example.test'},{recipient_user_id:recipient,role:'superadmin'},{recipient_user_id:recipient,tenant_id:randomUUID()}])expect((await ownedStaffAccountsHttp(request('POST',body))).status).toBe(400)
  expect(mocks.mutate).not.toHaveBeenCalled();expect(mocks.source).not.toHaveBeenCalled()
 })
 it('reset returns a concrete local session revocation/recovery link and explicit global-tenant authorization is preserved',async()=>{
  mocks.mutate.mockResolvedValue({id:randomUUID(),code:'y'.repeat(43),expires_at:new Date(Date.now()+60000).toISOString(),kind:'recovery',recipient_user_id:recipient})
  const response=await ownedStaffAccountsHttp(request('PATCH'),recipient,tenant),data=await response.json();expect(response.status).toBe(200);expect(data.sessionsRevoked).toBe(true);expect(data.recovery.url).toContain('recovery=');expect(data.credentials).toBeUndefined()
  expect(mocks.mutate).toHaveBeenCalledWith('recovery',recipient,undefined,tenant,true)
  mocks.principal.mockResolvedValue({role:'store-admin'});expect((await ownedStaffAccountsHttp(request(),undefined,tenant)).status).toBe(403)
  expect((await ownedAccountsHttp(request('DELETE',undefined,'https://evil.test'),recipient)).status).toBe(403)
 })
})
