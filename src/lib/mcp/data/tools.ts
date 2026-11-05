import { AdminMenuError,activeAdminMenu,mutateAdminMenu,readAdminMenus,type AdminMenuQuery } from '../../data/admin-menus'
import { findAdminProduct,mutateAdminProduct } from '../../data/admin-products'
import { mutateAdminCategory } from '../../data/admin-categories'
import { readAdminLocations,readAdminDeliveryZones,mutateAdminLocation,mutateAdminDeliveryZone } from '../../data/admin-locations'
import { mutateAdminDisplaySettings } from '../../data/admin-display-settings'
import { readTenants,createTenant,updateTenant,deleteTenant,readPlans,mutatePlan,tenantSettings } from '../../data/tenant-administration'
import { listAdminAccounts,listStaffAccounts,changeAccountAccess,disableAccount,removeStaffAccount,issueStaffAccess } from '../../data/account-administration'
import { writeChatAddonOverride } from '../../data/chat-addon-billing'
import { enqueueNativeTenantEffect } from '../../data/tenant-effects-outbox'
import { UUID } from '../../auth/owned-principal'
import { requireMcpAuthority,type McpActor } from './authority'

type Args=Record<string,unknown>
const clean=(args:Args,...exclude:string[])=>Object.fromEntries(Object.entries(args).filter(([key,value])=>!exclude.includes(key) && value!==undefined))
const single=(rows:Args[],message='Record not found')=>{ if(rows.length!==1) throw new AdminMenuError(rows.length ? 503 : 404,message); return rows[0] }
const bounded=(rows:Args[],limit=1000)=>{ if(rows.length>limit) throw new AdminMenuError(409,'The result exceeds the supported limit'); return rows }
export async function mcpTenant(query:AdminMenuQuery,value:unknown,lock=false) {
  if(typeof value!=='string' || !value || value.length>200) throw new AdminMenuError(400,'A tenant UUID or slug is required')
  const rows=(await query(`SELECT id FROM public.tenants WHERE ${UUID.test(value) ? 'id=$1' : 'slug=$1'} ${lock ? 'FOR NO KEY UPDATE' : ''}`,[value])).rows
  return String(single(rows,'Tenant not found').id)
}
async function locationDelete(query:AdminMenuQuery,tenantId:string,id:string) {
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`xmartmenu-admin-locations:${tenantId}`])
  await query('LOCK TABLE public.locations IN SHARE UPDATE EXCLUSIVE MODE')
  single((await query('SELECT id FROM public.locations WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,tenantId])).rows,'Location not found')
  // Inspect real FK definitions; only known SET NULL references of this same
  // tenant may be cleared. Unknown dependencies fail before deletion.
  const refs=(await query(`SELECT c.convalidated,c.confdeltype,array_length(c.conkey,1) AS columns,n.nspname AS schema,t.relname AS child,
      a.attname AS column,pa.attname AS parent_column,quote_ident(n.nspname)||'.'||quote_ident(t.relname) AS qualified,quote_ident(a.attname) AS quoted_column
    FROM pg_constraint c JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=c.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid=p.oid AND pa.attnum=c.confkey[1]
    WHERE c.contype='f' AND pn.nspname='public' AND p.relname='locations'`)).rows
  for(const ref of refs) {
    if(!ref.convalidated || Number(ref.columns)!==1 || ref.parent_column!=='id') throw new AdminMenuError(409,'Location dependencies require review')
    const known=ref.schema==='public' && ['orders','menu_events','menu_sessions'].includes(String(ref.child)) && ref.column==='location_id' && ref.confdeltype==='n'
    const rows=(await query(`SELECT 1 FROM ${ref.qualified} WHERE ${ref.quoted_column}=$1${known ? ' AND tenant_id<>$2' : ''} LIMIT 1`,known ? [id,tenantId] : [id])).rows
    if(rows.length) throw new AdminMenuError(409,'Location has inconsistent or unknown tenant dependencies')
  }
  await query('DELETE FROM public.locations WHERE id=$1 AND tenant_id=$2',[id,tenantId]); return { ok:true }
}
async function platform(query:AdminMenuQuery,input?:unknown) {
  const allowed=['app_name','brand_name','default_primary_color','default_accent_color','cta_color','menu_footer_brand','landing','seo_title','seo_description','favicon_url']
  const visible=['id',...allowed],projection=visible.join(',')
  const dto=(row:Args)=>Object.fromEntries(visible.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))
  await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-mcp-platform',0))")
  const rows=bounded((await query(`SELECT ${projection} FROM public.platform_settings LIMIT 2`)).rows,1)
  if(input===undefined) return rows[0] ? dto(rows[0]) : {}
  const values=input as Args
  const fields=Object.keys(values)
  if(!fields.length || fields.some(key=>!allowed.includes(key))) throw new AdminMenuError(400,'Invalid platform settings')
  for(const [key,value] of Object.entries(values)) {
    if(key==='landing') { if(value===null || typeof value!=='object' || Array.isArray(value)) throw new AdminMenuError(400,'Invalid landing settings'); continue }
    if(value!==null && (typeof value!=='string' || value.length>10000)) throw new AdminMenuError(400,'Invalid platform value')
    if(key.endsWith('_color') && (typeof value!=='string' || !/^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(value))) throw new AdminMenuError(400,'Invalid color')
  }
  const params=fields.map(key=>key==='landing' ? JSON.stringify(values[key]) : values[key])
  const result=rows[0]
    ? await query(`UPDATE public.platform_settings SET ${fields.map((field,index)=>`${field}=$${index+2}`).join(',')} WHERE id=$1 RETURNING ${projection}`,[rows[0].id,...params])
    : await query(`INSERT INTO public.platform_settings(${fields.join(',')}) VALUES(${fields.map((_,index)=>`$${index+1}`).join(',')}) RETURNING ${projection}`,params)
  return dto(single(result.rows,'Platform settings could not be saved'))
}
export async function nativeMcpDataTool(query:AdminMenuQuery,actor:McpActor,name:string,args:Args,issuer:string) {
  if((name.startsWith('delete_') || name==='demote_staff') && (process.env.MCP_ALLOW_DESTRUCTIVE!=='true' || args.confirm!==true)) throw new AdminMenuError(403,'MCP destructive actions require the server switch and confirm:true')
  const write=!['list_tenants','get_tenant','list_users','list_plans','get_plan','get_platform_settings','list_menus','list_categories','list_products','list_locations','list_delivery_zones','list_orders','get_order','list_staff'].includes(name)
  await requireMcpAuthority(query,actor,write)
  if(name==='list_tenants') {
    const all=await readTenants(query,actor); if(!Array.isArray(all)) throw new AdminMenuError(503,'Tenant list unavailable')
    const term=String(args.search ?? '').toLowerCase(),rows=all.filter(row=>!term || `${row.name} ${row.slug}`.toLowerCase().includes(term)).slice(0,Number(args.limit ?? 200))
    return { count:rows.length,tenants:rows }
  }
  if(name==='create_tenant') return { ...await createTenant(query,actor,args),credentials:null }
  if(name==='list_users') {
    const all:Record<string,unknown>[]=await listAdminAccounts(query,actor),term=String(args.search ?? '').toLowerCase()
    const rows=all.filter(row=>(!args.role || row.role===args.role) && (!term || String(row.full_name ?? '').toLowerCase().includes(term)))
    return { count:Math.min(rows.length,Number(args.limit ?? 200)),total:rows.length,users:rows.slice(0,Number(args.limit ?? 200)) }
  }
  if(name==='update_user') return changeAccountAccess(query,actor,String(args.user_id),clean(args,'user_id'))
  if(name==='delete_user') return { ...await disableAccount(query,actor,String(args.user_id)),deleted:false }
  if(name==='list_plans') { const rows=await readPlans(query,actor); return { count:Array.isArray(rows) ? rows.length : 0,plans:rows } }
  if(name==='get_plan') return readPlans(query,actor,String(args.plan_id))
  if(name==='create_plan' || name==='update_plan' || name==='delete_plan') return mutatePlan(query,actor,name==='create_plan' ? 'create' : name==='delete_plan' ? 'delete' : 'update',args.plan_id as string|undefined,clean(args,'plan_id','confirm'))
  if(name==='get_platform_settings' || name==='update_platform_settings') return platform(query,args.settings)
  if(name==='get_order') {
    const row=single((await query('SELECT to_jsonb(o) AS row FROM public.orders o WHERE id=$1',[args.order_id])).rows,'Order not found').row as Args
    const items=(await query('SELECT to_jsonb(i) AS row FROM public.order_items i JOIN public.orders o ON o.id=i.order_id WHERE o.tenant_id=$1 AND o.id=$2 ORDER BY i.id',[row.tenant_id,args.order_id])).rows
    return { ...row,order_items:items.map(value=>value.row) }
  }
  const tenantId=await mcpTenant(query,args.tenant,write),ctx={ tenantId,role:'superadmin' as const },admin={ ...actor,tenantId,platformOnly:true }
  if(name==='get_tenant') {
    const details=await tenantSettings(query,actor,tenantId),subscription=(await query(`SELECT to_jsonb(s)||jsonb_build_object('plans',to_jsonb(p)) AS row FROM public.tenant_subscriptions s LEFT JOIN public.plans p ON p.id=s.plan_id WHERE s.tenant_id=$1`,[tenantId])).rows
    return { tenant:details.tenant,settings:details.settings,subscription:subscription[0]?.row ?? null }
  }
  if(name==='update_tenant') return updateTenant(query,actor,tenantId,clean(args,'tenant'))
  if(name==='delete_tenant') { await deleteTenant(query,actor,tenantId); return { ok:true } }
  if(name==='update_tenant_settings' || name==='update_branding') return tenantSettings(query,actor,tenantId,name==='update_branding' ? clean(args,'tenant') : args.settings)
  if(name==='update_seo') {
    const str=(value:unknown,max:number)=>typeof value==='string' ? value.trim().slice(0,max) || null : null
    const image=args.seo_og_image_url
    if(image && (typeof image!=='string' || !/^https:\/\//i.test(image.trim()))) throw new AdminMenuError(400,'Use an HTTPS SEO image')
    return mutateAdminDisplaySettings(query,ctx,'seo',{ seo_title:str(args.seo_title,70),seo_description:str(args.seo_description,200),seo_keywords:str(args.seo_keywords,300),seo_og_image_url:str(image,2048),seo_noindex:args.seo_noindex===true })
  }
  if(name==='set_chat_addon_override') return writeChatAddonOverride(query,{ ...ctx,actorId:actor.actorId },args.override)
  if(name==='xphere_resync') return { queued:true,status:'pending',effect_id:await enqueueNativeTenantEffect(query,{ tenantId,reason:'manual' }),tenant_id:tenantId }
  if(name==='list_staff') { const rows=await listStaffAccounts(query,admin); return { tenant_id:tenantId,count:rows.length,staff:rows } }
  if(name==='create_staff' || name==='reset_staff_password') {
    const kind=name==='create_staff' ? 'invite' : 'recovery',result=await issueStaffAccess(query,admin,String(args.recipient_user_id ?? args.staff_id),kind)
    return { ok:true,[kind==='invite' ? 'invitation' : 'recovery']:{ id:result.id,url:`${issuer}/staff-access?${kind}=${encodeURIComponent(result.code)}`,expires_at:result.expires_at,recipient_user_id:result.recipient_user_id },...(kind==='recovery' ? { sessionsRevoked:true } : {}) }
  }
  if(name==='demote_staff') return removeStaffAccount(query,admin,String(args.staff_id))
  if(name==='list_locations') { const rows=await readAdminLocations(query,ctx); return { tenant_id:tenantId,count:rows.length,locations:rows } }
  if(name==='list_delivery_zones') { const rows=await readAdminDeliveryZones(query,ctx); return { tenant_id:tenantId,count:rows.length,delivery_zones:rows } }
  if(name==='create_location' || name==='update_location') return mutateAdminLocation(query,ctx,name==='create_location' ? { kind:'create',body:clean(args,'tenant') } : { kind:'patch',id:String(args.location_id),body:clean(args,'tenant','location_id') })
  if(name==='delete_location') return locationDelete(query,tenantId,String(args.location_id))
  if(['create_delivery_zone','update_delivery_zone','delete_delivery_zone'].includes(name)) return mutateAdminDeliveryZone(query,ctx,name==='create_delivery_zone' ? { kind:'create',body:clean(args,'tenant') } : name==='delete_delivery_zone' ? { kind:'delete',id:String(args.zone_id) } : { kind:'patch',id:String(args.zone_id),body:clean(args,'tenant','zone_id') })
  if(name==='list_orders') {
    const rows=(await query(`SELECT to_jsonb(o)||jsonb_build_object('order_items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id=o.id),'[]')) AS row
      FROM public.orders o WHERE o.tenant_id=$1 AND ($2::text IS NULL OR o.status=$2) AND ($3::timestamptz IS NULL OR o.created_at>=$3) ORDER BY o.created_at DESC,o.id LIMIT $4`,[tenantId,args.status ?? null,args.since_hours ? new Date(Date.now()-Number(args.since_hours)*3600000) : null,args.limit ?? 100])).rows.map(row=>row.row)
    return { tenant_id:tenantId,count:rows.length,orders:rows }
  }
  if(name==='list_menus') { const rows=await readAdminMenus(query,ctx); return { tenant_id:tenantId,count:rows.length,menus:rows } }
  if(name==='list_categories' || name==='list_products') {
    const table=name==='list_categories' ? 'categories' : 'products',limit=table==='products' ? Number(args.limit ?? 500) : 1000
    const rows=bounded((await query(`SELECT to_jsonb(r) AS row FROM public.${table} r WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR r.menu_id=$2)${table==='products' ? ' AND ($3::uuid IS NULL OR r.category_id=$3)' : ''} ORDER BY r.position,r.id LIMIT ${table==='products' ? '$4' : '1001'}`,table==='products' ? [tenantId,args.menu_id ?? null,args.category_id ?? null,limit] : [tenantId,args.menu_id ?? null])).rows,limit).map(row=>row.row)
    return { tenant_id:tenantId,count:rows.length,[table]:rows }
  }
  if(name==='create_menu' || name==='update_menu' || name==='delete_menu') return mutateAdminMenu(query,ctx,name==='create_menu' ? { kind:'create',body:clean(args,'tenant') } : name==='delete_menu' ? { kind:'delete',id:String(args.menu_id) } : { kind:'patch',id:String(args.menu_id),body:clean(args,'tenant','menu_id') })
  if(name==='create_category' || name==='update_category' || name==='delete_category') {
    const result=await mutateAdminCategory(query,ctx,name==='create_category' ? { kind:'create',body:clean(args,'tenant') } : name==='delete_category' ? { kind:'delete',id:String(args.category_id) } : { kind:'patch',id:String(args.category_id),body:clean(args,'tenant','category_id') })
    if(name==='create_category' && 'id' in result) { await query('UPDATE public.categories SET position=$3 WHERE tenant_id=$1 AND id=$2',[tenantId,result.id,args.position ?? 0]); return { ...result,position:args.position ?? 0 } }
    return result
  }
  if(name==='create_product' || name==='update_product' || name==='delete_product') {
    const menus=await readAdminMenus(query,ctx),menu=activeAdminMenu(menus,args.menu_id as string|undefined)
    if(name==='create_product' && (!menu || (args.menu_id && menu.id!==args.menu_id))) throw new AdminMenuError(400,'Menu not found for this tenant')
    const result=await mutateAdminProduct(query,ctx,name==='create_product' ? { kind:'create',selectedMenuId:menu!.id,body:{ ...clean(args,'tenant','menu_id','position'),expectedMenuId:menu!.id } } : name==='delete_product' ? { kind:'delete',id:String(args.product_id) } : { kind:'patch',id:String(args.product_id),body:clean(args,'tenant','product_id','position') })
    if(result && 'id' in result && (name==='create_product' || args.position!==undefined)) {
      await query('UPDATE public.products SET position=$3 WHERE tenant_id=$1 AND id=$2',[tenantId,result.id,args.position ?? 0])
      return findAdminProduct(query,ctx,String(result.id))
    }
    return result
  }
  throw new AdminMenuError(400,'Unknown native MCP data operation')
}
