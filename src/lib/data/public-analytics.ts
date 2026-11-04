import { analyticsBatchSchema, validateEventTimes, MAX_ANALYTICS_BODY_BYTES } from '../analytics/contracts'
import { AdminMenuError, type AdminMenuQuery } from './admin-menus'

/** Bounded native-mode body read; cancellation cannot keep a handler alive. */
export async function readNativeAnalyticsBody(request: Request,timeoutMs=5000): Promise<string> {
  const reader=request.body?.getReader()
  if(!reader)throw new AdminMenuError(400,'Invalid analytics request')
  let timer:ReturnType<typeof setTimeout>|undefined
  const chunks:Uint8Array[]=[];let size=0
  try{
    const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new AdminMenuError(400,'Invalid analytics request'));void reader.cancel().catch(()=>{})},Math.max(1,Math.min(timeoutMs,5000)))})
    for(;;){const part=await Promise.race([reader.read(),deadline]);if(part.done)break;size+=part.value.byteLength
      if(size>MAX_ANALYTICS_BODY_BYTES){void reader.cancel().catch(()=>{});throw new AdminMenuError(413,'Analytics request too large')};chunks.push(part.value)}
    return Buffer.concat(chunks).toString('utf8')
  }finally{clearTimeout(timer);reader.releaseLock()}
}

/** Client-only event writer. One transaction owns validation, session CAS and events. */
export async function ingestPublicAnalytics(query:AdminMenuQuery,input:unknown,now=new Date()) {
  const parsed=analyticsBatchSchema.safeParse(input)
  if(!parsed.success||!Number.isFinite(now.getTime())||!validateEventTimes(parsed.data.events,now.getTime()))throw new AdminMenuError(400,'Invalid analytics batch')
  const {session,events}=parsed.data
  const admitted=await query(`SELECT s.analytics_enabled FROM public.tenants t JOIN public.menus m ON m.tenant_id=t.id
    LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id WHERE t.id=$1 AND t.is_active=true AND m.id=$2 AND m.is_active=true LIMIT 2`,[session.tenant_id,session.menu_id])
  if(!admitted.rows.length)throw new AdminMenuError(404,'Menu not found')
  if(admitted.rows.length!==1)throw new AdminMenuError(503,'Analytics settings unavailable')
  if(admitted.rows[0].analytics_enabled===false)return{ok:true,received:0,disabled:true}
  if(session.location_id){
    const row=await query('SELECT id FROM public.locations WHERE id=$1 AND tenant_id=$2 AND is_active=true AND (menu_id IS NULL OR menu_id=$3)',[session.location_id,session.tenant_id,session.menu_id])
    if(row.rows.length!==1)throw new AdminMenuError(400,'Invalid analytics location')
  }
  if(session.qr_code_id){
    const row=await query('SELECT id FROM public.qr_codes WHERE id=$1 AND tenant_id=$2',[session.qr_code_id,session.tenant_id])
    if(row.rows.length!==1)throw new AdminMenuError(400,'Invalid analytics QR code')
  }
  for(const [table,ids]of [['products',[...new Set(events.flatMap(event=>event.product_id?[event.product_id]:[]))]],['categories',[...new Set(events.flatMap(event=>event.category_id?[event.category_id]:[]))]]] as const){
    if(!ids.length)continue
    const result=await query(`SELECT id FROM public.${table} WHERE tenant_id=$1 AND menu_id=$2 AND id=ANY($3::uuid[])`,[session.tenant_id,session.menu_id,ids])
    if(result.rows.length!==ids.length)throw new AdminMenuError(400,'Invalid analytics entity')
  }
  const inserted=await query(`INSERT INTO public.menu_sessions(id,tenant_id,menu_id,location_id,qr_code_id,is_test,entry_source,device_class,language,started_at,last_seen_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT(id) DO UPDATE
    SET last_seen_at=GREATEST(public.menu_sessions.last_seen_at,EXCLUDED.last_seen_at)
    WHERE public.menu_sessions.tenant_id=EXCLUDED.tenant_id AND public.menu_sessions.menu_id=EXCLUDED.menu_id
      AND public.menu_sessions.location_id IS NOT DISTINCT FROM EXCLUDED.location_id AND public.menu_sessions.qr_code_id IS NOT DISTINCT FROM EXCLUDED.qr_code_id
      AND public.menu_sessions.is_test=EXCLUDED.is_test RETURNING id`,[session.id,session.tenant_id,session.menu_id,session.location_id??null,session.qr_code_id??null,session.is_test,session.entry_source,session.device_class,session.language??null,now.toISOString()])
  if(inserted.rows.length!==1)throw new AdminMenuError(409,'Analytics session identity conflict')
  const rows=events.map(event=>({client_event_id:event.client_event_id,tenant_id:session.tenant_id,session_id:session.id,menu_id:session.menu_id,location_id:session.location_id??null,
    product_id:event.product_id??null,category_id:event.category_id??null,event_name:event.event_name,occurred_at:event.occurred_at,duration_ms:event.duration_ms??null,
    quantity:event.quantity??null,source:event.source??null,media_type:event.media_type??null,media_index:event.media_index??null,query_length:event.query_length??null}))
  await query(`INSERT INTO public.menu_events(client_event_id,tenant_id,session_id,menu_id,location_id,product_id,category_id,event_name,occurred_at,duration_ms,quantity,source,media_type,media_index,query_length)
    SELECT client_event_id,tenant_id,session_id,menu_id,location_id,product_id,category_id,event_name,occurred_at,duration_ms,quantity,source,media_type,media_index,query_length
    FROM jsonb_to_recordset($1::jsonb) AS event(client_event_id uuid,tenant_id uuid,session_id uuid,menu_id uuid,location_id uuid,product_id uuid,category_id uuid,
      event_name text,occurred_at timestamptz,duration_ms integer,quantity integer,source text,media_type text,media_index integer,query_length integer)
    ON CONFLICT(client_event_id) DO NOTHING`,[JSON.stringify(rows)])
  // Same acknowledgement as legacy upsert(ignoreDuplicates), including replays.
  return{ok:true,received:events.length}
}
