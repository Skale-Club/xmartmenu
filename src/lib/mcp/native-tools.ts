import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ZodError } from 'zod'
import { AdminMenuError } from '../data/admin-menus'
import { nativeTool,nativeMcpTools } from './native-tool-contracts'
import { nativeMcpDataTool,mcpTenant } from './data/tools'
import { nativeChecklist,describeNativeChecklist,setNativeChecklist,applyNativeChecklistScan } from './data/checklist'
import { currentMcpIdentity,type McpActor } from './data/authority'
import type { McpDatabase } from './data/oauth'
import { nativeMcpActor,nativeMcpConfiguration,nativeMcpDatabase } from './runtime'
import { scanLaunchChecklistSite,type LaunchChecklistScan } from '../admin/launch-checklist-scan'
import { changeNativeSubscription } from '../billing/subscription-native'
import { validateSubscriptionPatch } from '../data/subscription-billing'
import { subscriptionGateway,type SubscriptionGateway } from '../billing/subscription-provider'
import { PlanChangeError } from '../billing/plan-change-model'
import { launchChecklistItemsFor,summarizeLaunchChecklist,type LaunchChecklistStatus } from '../launch-checklist'
import { captureSecurityEvent } from '../observability'
import { revalidateAllPublicMenus } from '../menu/public-menu-cache'

export interface NativeMcpDependencies {
  database:McpDatabase; issuer:string; gateway:SubscriptionGateway
  scan:(url:string)=>Promise<LaunchChecklistScan>
  notify?:(tenantId:string)=>Promise<unknown>
}
const result=(value:unknown):CallToolResult=>({ content:[{ type:'text',text:JSON.stringify(value,null,2) }] })
const failure=(error:unknown):CallToolResult=>({ isError:true,content:[{ type:'text',text:error instanceof AdminMenuError || error instanceof PlanChangeError ? error.message : error instanceof ZodError ? 'Invalid native MCP tool arguments; refresh the client tool schemas.' : 'The native MCP operation is unavailable.' }] })
export async function executeNativeMcpTool(name:string,input:unknown,actor:McpActor,deps:NativeMcpDependencies):Promise<CallToolResult> {
  try {
    if(currentMcpIdentity(actor.oauth).userId!==actor.actorId) throw new AdminMenuError(403,'Current MCP authorization is required')
    if(JSON.stringify(input).length>65536) throw new AdminMenuError(413,'MCP tool arguments are too large')
    const { definition,args }=nativeTool(name,input)
    if(definition.destructive && (process.env.MCP_ALLOW_DESTRUCTIVE!=='true' || args.confirm!==true)) throw new AdminMenuError(403,'MCP destructive actions require the server switch and confirm:true')
    let value:unknown,notifyTenant:string|undefined
    if(name==='update_subscription') {
      const tenantId=await deps.database.run(false,query=>mcpTenant(query,args.tenant)),patch=validateSubscriptionPatch(Object.fromEntries(Object.entries(args).filter(([key])=>key!=='tenant')))
      const changed=await changeNativeSubscription({ ...actor,tenantId,role:'superadmin' },{ mode:'admin',patch,planId:patch.plan_id,cycle:patch.billing_cycle },{ database:deps.database,gateway:deps.gateway,baseUrl:deps.issuer })
      value=changed.body; notifyTenant=changed.sync?.tenantId
    } else if(name==='get_launch_checklist') {
      value=await deps.database.run(false,async query=>{
        const data=await nativeChecklist(query,actor,deps.issuer)
        if(args.tenant) { const id=await mcpTenant(query,args.tenant),tenant=data.tenants.find(row=>row.id===id); if(!tenant) throw new AdminMenuError(404,'Restaurant not found'); return { setupRequired:data.setupRequired,...describeNativeChecklist(tenant) } }
        return { setupRequired:data.setupRequired,restaurants:data.tenants.map(tenant=>({ tenantId:tenant.id,slug:tenant.slug,name:tenant.name,status:tenant.status,siteUrl:tenant.siteUrl,...summarizeLaunchChecklist(tenant.entries,tenant.plan),missing:launchChecklistItemsFor(tenant.plan).filter(item=>(tenant.entries[item.key]?.status ?? 'pending')==='pending').map(item=>item.key) })) }
      })
    } else if(name==='set_launch_checklist_item') {
      value=await deps.database.run(true,async query=>{ const tenantId=await mcpTenant(query,args.tenant,true),entry=await setNativeChecklist(query,actor,tenantId,String(args.itemKey),args.status as LaunchChecklistStatus,args.note as string|undefined); return { updated:true,tenantId,itemKey:args.itemKey,entry } })
    } else if(name==='scan_launch_checklist') {
      const before=await deps.database.run(false,async query=>{ const id=await mcpTenant(query,args.tenant),data=await nativeChecklist(query,actor,deps.issuer),tenant=data.tenants.find(row=>row.id===id); if(!tenant) throw new AdminMenuError(404,'Restaurant not found'); return tenant })
      const scan=await deps.scan(before.siteUrl)
      value=args.apply ? await deps.database.run(true,query=>applyNativeChecklistScan(query,actor,deps.issuer,before.id,scan))
        : await deps.database.run(false,async query=>{ await nativeChecklist(query,actor,deps.issuer); return { scan,marked:[] } })
    } else {
      value=await deps.database.run(definition.write,query=>nativeMcpDataTool(query,actor,name,args,deps.issuer))
      if(name==='xphere_resync') notifyTenant=String((value as Record<string,unknown>).tenant_id)
      if(name==='create_tenant') { const tenant=(value as { tenant?:{ id?:string } }).tenant; notifyTenant=tenant?.id }
    }
    // No post-COMMIT cache/queue/telemetry failure may turn a confirmed billing
    // operation into a 503 or trigger another financial attempt.
    if(definition.write) {
      try { revalidateAllPublicMenus(); captureSecurityEvent(`MCP mutation: ${name}`,{ kind:'mcp',tool:name,userId:actor.actorId }) } catch { /* committed result remains authoritative */ }
    }
    if(notifyTenant && deps.notify) { try { await deps.notify(notifyTenant) } catch { /* native intention remains pending */ } }
    return result(value)
  } catch(error) { return failure(error) }
}
export function registerNativeMcpTools(server:McpServer) {
  for(const definition of nativeMcpTools) server.registerTool(definition.name,{ title:definition.name.replaceAll('_',' '),description:definition.description,inputSchema:definition.schema,
    annotations:{ readOnlyHint:!definition.write,destructiveHint:definition.destructive } },async(args,extra)=>{
    try {
      const actor=await nativeMcpActor(extra),{ issuer }=nativeMcpConfiguration()
      return executeNativeMcpTool(definition.name,args,actor,{ database:nativeMcpDatabase(actor),issuer,gateway:subscriptionGateway,scan:scanLaunchChecklistSite })
    } catch(error) { return failure(error) }
  })
}
