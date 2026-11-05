import { randomUUID } from 'node:crypto'
import { readFileSync,readdirSync } from 'node:fs'
import { beforeEach,afterEach,expect,it,vi } from 'vitest'
const state=vi.hoisted(()=>({ data:vi.fn(),tenant:vi.fn(),change:vi.fn(),checklist:vi.fn(),set:vi.fn(),apply:vi.fn(),source:vi.fn(),cache:vi.fn() }))
vi.mock('@/lib/mcp/data/tools',()=>({ nativeMcpDataTool:state.data,mcpTenant:state.tenant }))
vi.mock('@/lib/mcp/data/checklist',()=>({ nativeChecklist:state.checklist,describeNativeChecklist:vi.fn(value=>value),setNativeChecklist:state.set,applyNativeChecklistScan:state.apply }))
vi.mock('@/lib/billing/subscription-native',()=>({ changeNativeSubscription:state.change }))
vi.mock('@/lib/billing/subscription-provider',()=>({ subscriptionGateway:{} }))
vi.mock('@/lib/supabase/server',()=>({ createClient:state.source,createServiceClient:state.source }))
vi.mock('@/lib/observability',()=>({ captureSecurityEvent:vi.fn() }))
vi.mock('@/lib/menu/public-menu-cache',()=>({ revalidateAllPublicMenus:state.cache }))
import { nativeMcpTools } from '@/lib/mcp/native-tool-contracts'
import { executeNativeMcpTool,type NativeMcpDependencies } from '@/lib/mcp/native-tools'
import { McpCapabilityIssuer,type McpActor } from '@/lib/mcp/data/authority'
import { AdminMenuError } from '@/lib/data/admin-menus'

const id=randomUUID(),tenant=randomUUID(),record=randomUUID(),identity={ userId:id,grantId:randomUUID(),clientId:'xm_mcp_client_'+'a'.repeat(32),resource:'https://fixture.invalid/api/mcp',projectId:'fixture-project',subject:'verified-subject',authenticatedAt:Math.floor(Date.now()/1000)-60,expiresAt:Math.floor(Date.now()/1000)+900,role:'superadmin' as const,scopes:['mcp:admin'],clientOrigins:['https://client.invalid'] }
let actor:McpActor,depth=0
const database:NativeMcpDependencies['database']={ async run(_write,operation) { depth++; try{return await operation(async()=>({ rows:[] }))}finally{depth--} } }
const deps:NativeMcpDependencies={ database,issuer:'https://fixture.invalid',gateway:{} as NativeMcpDependencies['gateway'],scan:vi.fn(async url=>{ expect(depth).toBe(0); return { siteUrl:url,scannedAt:new Date().toISOString(),homepage:{ ok:true,status:200 },findings:{} } }),notify:vi.fn() }
beforeEach(async()=>{
  vi.stubEnv('MCP_ALLOW_DESTRUCTIVE','true'); depth=0
  actor=await new McpCapabilityIssuer(async()=>identity,async()=>({ disabled:false,validSince:0 })).issue('a'.repeat(64))
  state.tenant.mockResolvedValue(tenant); state.data.mockResolvedValue({ ok:true }); state.change.mockImplementation(async()=>{ expect(depth).toBe(0); return { body:{ changed:true },sync:{ tenantId:tenant,reason:'plan_changed' } } })
  state.checklist.mockResolvedValue({ setupRequired:false,tenants:[{ id:tenant,slug:'fixture',name:'Fixture',siteUrl:'https://fixture.invalid/fixture',entries:{},signals:{},plan:{ orders:false,payments:false,stripe:false } }] })
  state.apply.mockResolvedValue({ scan:{},marked:['site_published'] }); state.set.mockResolvedValue({ status:'done' })
})
afterEach(()=>{ vi.unstubAllEnvs(); vi.clearAllMocks() })
it('native catalogue preserves all 50 actual legacy tool names including factory-created deletes',()=>{
  const folder=new URL('../../src/lib/mcp/tools/',import.meta.url),names:string[]=[]
  for(const file of readdirSync(folder)) { const source=readFileSync(new URL(file,folder),'utf8'); names.push(...[...source.matchAll(/server\.registerTool\(\s*'([^']+)'/g),...source.matchAll(/makeDelete\('([^']+)'/g)].map(match=>match[1])) }
  expect(nativeMcpTools.map(tool=>tool.name).sort()).toEqual(names.sort()); expect(new Set(names).size).toBe(50)
})
const samples:Record<string,Record<string,unknown>>={
  list_tenants:{},get_tenant:{ tenant },create_tenant:{ name:'Restaurant',slug:'restaurant',owner_user_id:record },update_tenant:{ tenant,name:'Restaurant' },update_tenant_settings:{ tenant,settings:{ tagline:'Hello' } },set_chat_addon_override:{ tenant,override:null },xphere_resync:{ tenant },delete_tenant:{ tenant,confirm:true },
  list_users:{},update_user:{ user_id:record,role:'customer' },delete_user:{ user_id:record,confirm:true },list_plans:{},get_plan:{ plan_id:record },create_plan:{ name:'Plan',monthly_price:10,annual_price:100,transaction_fee_pct:1 },update_plan:{ plan_id:record,name:'Plan' },delete_plan:{ plan_id:record,confirm:true },get_platform_settings:{},update_platform_settings:{ settings:{ app_name:'Fixture' } },
  list_menus:{ tenant },list_categories:{ tenant },list_products:{ tenant },create_menu:{ tenant,name:'Menu' },update_menu:{ tenant,menu_id:record,is_active:true },create_category:{ tenant,name:'Category' },update_category:{ tenant,category_id:record,name:'Category' },create_product:{ tenant,name:'Product',price:12 },update_product:{ tenant,product_id:record,price:10 },delete_menu:{ tenant,menu_id:record,confirm:true },delete_category:{ tenant,category_id:record,confirm:true },delete_product:{ tenant,product_id:record,confirm:true },
  list_locations:{ tenant },list_delivery_zones:{ tenant },create_location:{ tenant,name:'Location',slug:'location' },update_location:{ tenant,location_id:record,is_active:false },create_delivery_zone:{ tenant,name:'Zone' },update_delivery_zone:{ tenant,zone_id:record,fee_cents:0 },delete_location:{ tenant,location_id:record,confirm:true },delete_delivery_zone:{ tenant,zone_id:record,confirm:true },
  list_orders:{ tenant },get_order:{ order_id:record },list_staff:{ tenant },create_staff:{ tenant,recipient_user_id:record },reset_staff_password:{ tenant,staff_id:record },demote_staff:{ tenant,staff_id:record,confirm:true },update_branding:{ tenant,primary_color:'#112233',accent_color:'#ffffff' },update_seo:{ tenant,seo_noindex:false },
}
for(const [name,args] of Object.entries(samples)) it(`${name} reaches its native SQL operation with the server actor and no Source constructor`,async()=>{
  const result=await executeNativeMcpTool(name,args,actor,deps)
  expect(result.isError).not.toBe(true); expect(state.data).toHaveBeenCalledWith(expect.any(Function),actor,name,args,'https://fixture.invalid'); expect(state.source).not.toHaveBeenCalled()
})
it('native identities reject obsolete email/password/actor inputs instead of silently creating privileged accounts',async()=>{
  for(const [name,args] of [
    ['create_tenant',{ name:'Store',slug:'store',email:'unverified@example.invalid' }],['create_staff',{ tenant,email:'unverified@example.invalid',name:'Staff' }],
    ['update_user',{ user_id:record,role:'superadmin',actorId:id }],['update_tenant',{ tenant,plan:'paid' }],
  ] as const) expect((await executeNativeMcpTool(name,args,actor,deps)).isError).toBe(true)
  expect(state.data).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('a JSON-shaped authority or substituted actor cannot reach SQL or a provider',async()=>{
  expect((await executeNativeMcpTool('get_platform_settings',{}, { actorId:id,oauth:{ tokenHash:'a'.repeat(64),requiredScope:'mcp:admin' } },deps)).isError).toBe(true)
  expect((await executeNativeMcpTool('get_platform_settings',{}, { ...actor,actorId:record },deps)).isError).toBe(true)
  expect(state.data).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('subscription changes use the financial coordinator outside SQL with the actual OAuth actor',async()=>{
  const result=await executeNativeMcpTool('update_subscription',{ tenant,plan_id:record,billing_cycle:'annual' },actor,deps)
  expect(result.isError).not.toBe(true); expect(state.change).toHaveBeenCalledWith({ ...actor,tenantId:tenant,role:'superadmin' },expect.objectContaining({ mode:'admin',patch:{ plan_id:record,billing_cycle:'annual' } }),expect.objectContaining({ database }))
  expect(state.data).not.toHaveBeenCalled(); expect(state.source).not.toHaveBeenCalled()
})
it('the three checklist operations use native SQL and scan only the stored URL outside SQL',async()=>{
  expect((await executeNativeMcpTool('get_launch_checklist',{ tenant },actor,deps)).isError).not.toBe(true)
  expect((await executeNativeMcpTool('set_launch_checklist_item',{ tenant,itemKey:'site_published',status:'done' },actor,deps)).isError).not.toBe(true)
  expect((await executeNativeMcpTool('scan_launch_checklist',{ tenant,apply:true },actor,deps)).isError).not.toBe(true)
  expect(deps.scan).toHaveBeenCalledWith('https://fixture.invalid/fixture'); expect(state.apply).toHaveBeenCalledWith(expect.any(Function),actor,'https://fixture.invalid',tenant,expect.objectContaining({ siteUrl:'https://fixture.invalid/fixture' })); expect(state.source).not.toHaveBeenCalled()
})
it('native denial never falls back and post-commit cache/CRM failure never repeats a financial action',async()=>{
  state.data.mockRejectedValue(new AdminMenuError(503,'Native SQL unavailable'))
  expect((await executeNativeMcpTool('list_menus',{ tenant },actor,deps)).isError).toBe(true); expect(state.source).not.toHaveBeenCalled()
  state.cache.mockImplementation(()=>{ throw Error('cache unavailable') }); const notify=vi.fn().mockRejectedValue(Error('queue unavailable'))
  expect((await executeNativeMcpTool('update_subscription',{ tenant,billing_cycle:'annual' },actor,{ ...deps,notify })).isError).not.toBe(true)
  expect(state.change).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenCalledWith(tenant)
})
it('destructive tools retain both the server switch and explicit confirmation',async()=>{
  vi.stubEnv('MCP_ALLOW_DESTRUCTIVE','false'); expect((await executeNativeMcpTool('delete_user',{ user_id:record,confirm:true },actor,deps)).isError).toBe(true)
  vi.stubEnv('MCP_ALLOW_DESTRUCTIVE','true'); expect((await executeNativeMcpTool('delete_user',{ user_id:record,confirm:false },actor,deps)).isError).toBe(true)
  expect(state.data).not.toHaveBeenCalled()
})
