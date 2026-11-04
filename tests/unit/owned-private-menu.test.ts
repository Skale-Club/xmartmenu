import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {OwnedAuthenticationUnavailable} from '@/lib/auth/owned-principal'
const state=vi.hoisted(()=>({customer:vi.fn(),source:vi.fn(),base:vi.fn()}))
vi.mock('@/lib/auth/owned-customer-runtime',()=>({getOwnedCustomer:state.customer}))
vi.mock('@/lib/supabase/server',()=>({createClient:state.source,createServiceClient:state.source}))
vi.mock('@/lib/data/public-menu-runtime',()=>({assertPublicMenuTarget:()=>{},loadOwnedPublicMenuBase:state.base}))
vi.mock('next/cache',()=>({unstable_cache:(fn:unknown)=>fn}))
import {loadPublicMenuData} from '@/lib/menu/public-menu-data'
beforeEach(()=>{
 vi.stubEnv('OWNED_AUTH_ENABLED','true');vi.stubEnv('OWNED_PUBLIC_MENU_ENABLED','true')
 state.base.mockResolvedValue({kind:'menu',tenant:{id:'fixture',slug:'fixture'},menu:{id:'private',is_private:true,price_multiplier:1},categories:[{id:'category'}],products:[{id:'dish',price:10}],tables:[],capabilities:{},optionGroupsByProductId:{},productIngredientsByProductId:{},productMediaByProductId:{}})
 state.source.mockImplementation(()=>{throw Error('Source SDK must not run')})
})
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks()})
it('checks native phone outside the shared content cache and never inherits previous access',async()=>{
 state.customer.mockResolvedValueOnce({userId:'uuid',phoneE164:null}).mockResolvedValueOnce({userId:'uuid',phoneE164:'+15551234567'}).mockResolvedValueOnce(null)
 const a=await loadPublicMenuData({slug:'fixture',tableId:null}),b=await loadPublicMenuData({slug:'fixture',tableId:null}),c=await loadPublicMenuData({slug:'fixture',tableId:null})
 expect(a).toMatchObject({privateAccess:false,products:[],categories:[]});expect(b).toMatchObject({privateAccess:true,products:[{id:'dish'}]});expect(c).toMatchObject({privateAccess:false,products:[]})
 expect(state.customer).toHaveBeenCalledTimes(3);expect(state.source).not.toHaveBeenCalled()
})
it('does not fall back to source identity when native current-account verification fails',async()=>{
 state.customer.mockRejectedValue(new OwnedAuthenticationUnavailable())
 await expect(loadPublicMenuData({slug:'fixture',tableId:null})).rejects.toThrow('unavailable');expect(state.source).not.toHaveBeenCalled()
})
