import { AdminMenuError,type AdminMenuQuery } from './admin-menus'
import { requireTenantAdministrator,type TenantAdminContext } from './tenant-administration'
import { enqueueNativeTenantEffect } from './tenant-effects-outbox'
import { UUID } from '../auth/owned-principal'

type Cursor={at:string|null;id:string}
function decodeCursor(raw?:string|null):Cursor|null {
  if(!raw)return null
  try {
    if(raw.length>256||!/^v1\.[A-Za-z0-9_-]+$/.test(raw))throw Error()
    const value=JSON.parse(Buffer.from(raw.slice(3),'base64url').toString('utf8'))
    if(!value||Object.keys(value).sort().join(',')!=='at,id'||!UUID.test(value.id)
      ||(value.at!==null&&(typeof value.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.at)||!Number.isFinite(Date.parse(value.at)))))throw Error()
    return value
  }catch{throw new AdminMenuError(400,'Invalid native backfill cursor')}
}
/** Same-transaction bounded intentions. No network or Source reads. The caller
 * supplies current browser/provider or persisted OAuth authority, never a role. */
export async function enqueueNativeTenantEffectBatch(query:AdminMenuQuery,context:TenantAdminContext,input:{requestKey:string;cursor?:string|null;limit?:number}) {
  const limit=input.limit??100,cursor=decodeCursor(input.cursor)
  if(!UUID.test(input.requestKey)||!Number.isInteger(limit)||limit<1||limit>100)throw new AdminMenuError(400,'Invalid native backfill batch')
  await requireTenantAdministrator(query,context,true)
  const page=(await query(`SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM public.tenants
    WHERE $1::boolean=false OR ($2::timestamptz IS NULL AND (created_at IS NOT NULL OR (created_at IS NULL AND id>$3::uuid)))
      OR ($2::timestamptz IS NOT NULL AND (created_at,id)>($2::timestamptz,$3::uuid))
    ORDER BY created_at ASC NULLS FIRST,id ASC LIMIT $4 FOR NO KEY UPDATE`,[!!cursor,cursor?.at??null,cursor?.id??null,limit])).rows
  const intentions:Array<{tenantId:string;effectId:string}>=[]
  for(const row of page){
    const tenantId=String(row.id),effectId=await enqueueNativeTenantEffect(query,{tenantId,reason:'backfill',eventId:`backfill:${input.requestKey}`})
    intentions.push({tenantId,effectId})
  }
  await requireTenantAdministrator(query,context,true)
  if(intentions.length){
    const audit=(await query(`INSERT INTO public.audit_events(actor_id,via,table_name,record_id,action,changes)
      VALUES($1,'server','app_tenant_effects',$2,'insert',$3::jsonb) RETURNING id`,[context.actorId,input.requestKey,JSON.stringify({operation:'crm_backfill_intentions',effect_ids:intentions.map(row=>row.effectId)})])).rows
    if(audit.length!==1)throw new AdminMenuError(503,'Backfill audit is unavailable')
  }
  const last=page.at(-1)
  if(last&&last.cursor_at!==null&&typeof last.cursor_at!=='string')throw new AdminMenuError(503,'Backfill timestamp is unavailable')
  const nextCursor=last?'v1.'+Buffer.from(JSON.stringify({at:last.cursor_at,id:String(last.id)})).toString('base64url'):input.cursor??null
  return {intentions,nextCursor,done:page.length<limit}
}
