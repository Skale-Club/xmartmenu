import {afterEach,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({source:vi.fn(),owned:vi.fn(),capabilities:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createServiceClient:state.source}))
vi.mock('@/lib/tenant-plan',()=>({getTenantCapabilities:state.capabilities}))
vi.mock('@/lib/data/admin-analytics-runtime',()=>({readOwnedAdminAnalytics:state.owned}))
import {loadAdminAnalytics} from '@/lib/admin/analytics-data'
const context={tenantId:'fixture',role:'store-admin' as const},window={startedAt:'start',endedAt:'end',previousStartedAt:'previous',menuId:null,locationId:null}
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks()})
it('uses the explicit admin-data selection without constructing legacy clients or plan readers',async()=>{
 vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED','true');state.owned.mockResolvedValue({overview:{sessions:1}})
 expect(await loadAdminAnalytics(context,window)).toEqual({overview:{sessions:1}})
 expect(state.owned).toHaveBeenCalledWith(context,window);expect(state.source).not.toHaveBeenCalled();expect(state.capabilities).not.toHaveBeenCalled()
})
it('does not silently return source or empty data after a native query error',async()=>{
 vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED','true');state.owned.mockRejectedValue(new Error('unavailable'))
 await expect(loadAdminAnalytics(context,window)).rejects.toThrow('unavailable');expect(state.source).not.toHaveBeenCalled()
})
it('retains all six legacy RPC selections when the admin data flag is off',async()=>{
 vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED','false')
 const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockResolvedValue({data:[]}),maybeSingle:vi.fn().mockResolvedValue({data:null})}
 const service={from:vi.fn().mockReturnValue(chain),rpc:vi.fn(async(name:string)=>({data:name==='get_menu_analytics_overview'?[{sessions:1}]:name==='get_menu_product_analytics'?[]:{},error:null}))}
 state.source.mockReturnValue(service);state.capabilities.mockResolvedValue({plan:{payments:false}})
 expect((await loadAdminAnalytics(context,window)).overview).toEqual({sessions:1})
 expect(service.rpc).toHaveBeenCalledTimes(6);expect(state.owned).not.toHaveBeenCalled()
})
