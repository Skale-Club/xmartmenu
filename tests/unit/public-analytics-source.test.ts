import {randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
import {AdminMenuError} from '@/lib/data/admin-menus'
const state=vi.hoisted(()=>({source:vi.fn(),owned:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createServiceClient:state.source}))
vi.mock('@/lib/data/public-analytics-runtime',()=>({ingestOwnedPublicAnalytics:state.owned}))
vi.mock('@/lib/rate-limit',()=>({rateLimit:async()=>({ok:true}),getClientIp:()=> '127.0.0.1'}))
vi.mock('@/lib/observability/with-api',()=>({withApi:(_:string,handler:unknown)=>handler}))
vi.mock('@/lib/observability/log',()=>({log:{error:vi.fn()}}))
import {POST} from '@/app/api/public/analytics/route'
const request=()=>new Request('http://localhost/api/public/analytics',{method:'POST',body:JSON.stringify({session:{id:randomUUID(),tenant_id:randomUUID(),menu_id:randomUUID()},events:[{client_event_id:randomUUID(),event_name:'menu_session_started',occurred_at:new Date().toISOString()}]})})
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks()})
it('selects native ingestion before creating any source client',async()=>{
 vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED','true');state.owned.mockResolvedValue({ok:true,received:1})
 expect((await POST(request(),undefined)).status).toBe(200);expect(state.source).not.toHaveBeenCalled();expect(state.owned).toHaveBeenCalledTimes(1)
})
it('returns a native unavailable result without a source write fallback',async()=>{
 vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED','true');state.owned.mockRejectedValue(new AdminMenuError(503,'unavailable'))
 expect((await POST(request(),undefined)).status).toBe(503);expect(state.source).not.toHaveBeenCalled()
})
