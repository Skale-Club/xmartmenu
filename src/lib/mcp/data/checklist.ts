import { AdminMenuError,type AdminMenuQuery } from '../../data/admin-menus'
import { LAUNCH_CHECKLIST_ITEMS,LAUNCH_CHECKLIST_KEYS,LAUNCH_CHECKLIST_STATUSES,isLaunchChecklistItemApplicable,launchChecklistItemsFor,summarizeLaunchChecklist,resolveLaunchChecklistLink,LAUNCH_CHECKLIST_REASON_LABELS,type LaunchChecklistTenant,type LaunchChecklistEntry,type LaunchChecklistStatus } from '../../launch-checklist'
import { deriveLaunchChecklistSignals,type LaunchChecklistSignalInput } from '../../admin/launch-checklist-signals'
import type { LaunchChecklistScan } from '../../admin/launch-checklist-scan'
import { liveFeatures } from '../../plan-settings'
import { planCeiling } from '../../service-modes'
import { requireMcpAuthority,type McpActor } from './authority'

type Row=Record<string,unknown>
export async function nativeChecklist(query:AdminMenuQuery,actor:McpActor,issuer:string) {
  await requireMcpAuthority(query,actor)
  return readNativeChecklist(query,issuer)
}
/** Authority-free read: callers (MCP, superadmin page) authorize before calling. */
export async function readNativeChecklist(query:AdminMenuQuery,issuer:string) {
  const ready=(await query("SELECT to_regclass('public.launch_checklist_items') IS NOT NULL AS ready")).rows[0]?.ready===true
  const rows=(await query(`SELECT to_jsonb(t) AS tenant,to_jsonb(s) AS settings,su.status,p.features,
    EXISTS(SELECT 1 FROM public.stripe_connections c WHERE c.tenant_id=t.id AND c.is_active) AS connected,
    ${ready ? "COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.launch_checklist_items l WHERE l.tenant_id=t.id),'[]')" : "'[]'::jsonb"} AS ticks
    FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id
    LEFT JOIN public.tenant_subscriptions su ON su.tenant_id=t.id LEFT JOIN public.plans p ON p.id=su.plan_id
    ORDER BY t.name,t.id LIMIT 1001`)).rows
  if(rows.length>1000) throw new AdminMenuError(409,'Checklist exceeds the supported limit')
  const tenants:LaunchChecklistTenant[]=rows.map(row=>{
    const t=row.tenant as Row,settings=row.settings as LaunchChecklistSignalInput['settings'],domain=typeof t.custom_domain==='string' ? t.custom_domain : null
    const verified=!!domain && t.custom_domain_verified===true,entries:Record<string,LaunchChecklistEntry>={}
    for(const tick of row.ticks as Row[]) {
      if(typeof tick.item_key!=='string' || !LAUNCH_CHECKLIST_KEYS.has(tick.item_key)) continue
      if(!LAUNCH_CHECKLIST_STATUSES.includes(tick.status as LaunchChecklistStatus)) throw new AdminMenuError(503,'Checklist data is unavailable')
      entries[tick.item_key]={ status:tick.status as LaunchChecklistStatus,note:String(tick.note ?? ''),updatedBy:typeof tick.updated_by==='string' ? tick.updated_by : null,updatedAt:String(tick.updated_at) }
    }
    return { id:String(t.id),name:String(t.name),slug:String(t.slug),status:t.is_active===true ? 'active' : 'inactive',primaryDomain:verified ? domain : null,
      siteUrl:verified ? `https://${domain}` : `${issuer}/${t.slug}`,entries,plan:planCeiling(liveFeatures(row.status as string,row.features as string[])),
      signals:deriveLaunchChecklistSignals({ isActive:t.is_active===true,customDomain:domain,customDomainVerified:verified,settings,stripeConnected:row.connected===true }) }
  })
  return { setupRequired:!ready,tenants }
}
export function describeNativeChecklist(tenant:LaunchChecklistTenant) {
  return { tenantId:tenant.id,slug:tenant.slug,name:tenant.name,status:tenant.status,siteUrl:tenant.siteUrl,customDomain:tenant.primaryDomain,
    progress:summarizeLaunchChecklist(tenant.entries,tenant.plan),items:launchChecklistItemsFor(tenant.plan).map(item=>{
      const entry=tenant.entries[item.key],signal=tenant.signals[item.key]
      return { key:item.key,category:item.category,label:item.label,description:item.description,status:entry?.status ?? 'pending',note:entry?.note || null,updatedBy:entry?.updatedBy ?? null,updatedAt:entry?.updatedAt ?? null,
        detected:signal ? { ok:signal.ok,detail:[signal.value,signal.reason ? LAUNCH_CHECKLIST_REASON_LABELS[signal.reason] : null].filter(Boolean).join(' · ') } : null,
        link:resolveLaunchChecklistLink(item.link,tenant.siteUrl,tenant.primaryDomain) }
    }) }
}
export async function setNativeChecklist(query:AdminMenuQuery,actor:McpActor,tenantId:string,itemKey:string,status:LaunchChecklistStatus,note?:string) {
  await requireMcpAuthority(query,actor,true)
  return writeNativeChecklistItem(query,tenantId,itemKey,status,note,`mcp:${actor.actorId}`)
}
/** Authority-free upsert: callers authorize before calling. */
export async function writeNativeChecklistItem(query:AdminMenuQuery,tenantId:string,itemKey:string,status:LaunchChecklistStatus,note:string|undefined,updatedBy:string) {
  if(!LAUNCH_CHECKLIST_KEYS.has(itemKey) || !LAUNCH_CHECKLIST_STATUSES.includes(status) || (note!==undefined && (typeof note!=='string' || note.length>2000))) throw new AdminMenuError(400,'Invalid checklist item')
  const row=(await query(`INSERT INTO public.launch_checklist_items(tenant_id,item_key,status,note,updated_by,updated_at)
    VALUES($1,$2,$3,COALESCE($4,''),$5,now()) ON CONFLICT(tenant_id,item_key) DO UPDATE SET status=EXCLUDED.status,
      note=CASE WHEN $4::text IS NULL THEN launch_checklist_items.note ELSE EXCLUDED.note END,updated_by=EXCLUDED.updated_by,updated_at=now()
    RETURNING status,note,updated_by,updated_at`,[tenantId,itemKey,status,note?.trim() ?? null,updatedBy])).rows[0]
  if(!row) throw new AdminMenuError(503,'Checklist item was not saved')
  return { status:row.status,note:row.note,updatedBy:row.updated_by,updatedAt:row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at }
}
export async function applyNativeChecklistScan(query:AdminMenuQuery,actor:McpActor,issuer:string,tenantId:string,scan:LaunchChecklistScan) {
  await requireMcpAuthority(query,actor,true)
  if((await query('SELECT id FROM public.tenants WHERE id=$1 FOR NO KEY UPDATE',[tenantId])).rows.length!==1) throw new AdminMenuError(404,'Restaurant not found')
  const current=await nativeChecklist(query,actor,issuer),tenant=current.tenants.find(row=>row.id===tenantId)
  if(!tenant || tenant.siteUrl!==scan.siteUrl) throw new AdminMenuError(409,'Restaurant URL changed; scan it again')
  if(current.setupRequired) throw new AdminMenuError(503,'Reviewed launch checklist schema is required')
  const marked:string[]=[]
  for(const [key,finding] of Object.entries(scan.findings)) {
    const item=LAUNCH_CHECKLIST_ITEMS.find(item=>item.key===key)
    if(!finding.ok || !item || !isLaunchChecklistItemApplicable(item,tenant.plan)) continue
    const note=`Verified by site scan on ${scan.scannedAt.slice(0,10)}: ${finding.evidence}`.slice(0,2000)
    const rows=(await query(`INSERT INTO public.launch_checklist_items(tenant_id,item_key,status,note,updated_by,updated_at) VALUES($1,$2,'done',$3,$4,now())
      ON CONFLICT(tenant_id,item_key) DO UPDATE SET status='done',note=CASE WHEN launch_checklist_items.note<>'' THEN launch_checklist_items.note ELSE EXCLUDED.note END,
        updated_by=EXCLUDED.updated_by,updated_at=now() WHERE launch_checklist_items.status='pending' RETURNING item_key`,[tenantId,key,note,`mcp:${actor.actorId}`])).rows
    if(rows.length) marked.push(key)
  }
  return { scan,marked }
}
