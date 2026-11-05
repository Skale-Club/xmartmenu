import {AdminMenuError,type AdminMenuQuery} from '../../data/admin-menus'
import {UUID} from '../../auth/owned-principal'
import {encryptApiKey,decryptApiKey,maskApiKey} from '../../crypto'
import {nextScheduledRun} from '../schedule'
import {parseTelegramTarget} from '../contract'
import {sanitizeBlogHtml} from '../content-validator'
import {requireNativeBlogActor,lockNativeBlogScope,type NativeBlogActor} from './authority'
const dto=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value]))
export const safeNativeTelegram=(row:Record<string,unknown>|undefined)=>({enabled:row?.enabled===true,approvalsEnabled:row?.approvals_enabled===true,hasBotToken:!!row?.bot_token,hasApprovalsBotToken:!!row?.approvals_bot_token,chatIds:Array.isArray(row?.chat_ids)?row.chat_ids:[],approvalsChatIds:Array.isArray(row?.approvals_chat_ids)?row.approvals_chat_ids:[]})
export async function nativeBlogAudit(query:AdminMenuQuery,actorId:string|null,scope:string|null,id:string,operation:string,table:'blog_posts'|'blog_settings'|'blog_rss_sources'|'telegram_settings'|'app_blog_operations'='blog_posts',action:'insert'|'update'|'delete'='update'){
 const rows=(await query(`INSERT INTO public.audit_events(tenant_id,actor_id,via,table_name,record_id,action,changes)
  VALUES($1,$2,'server',$3,$4,$5,$6::jsonb) RETURNING id`,[scope,actorId,table,id,action,JSON.stringify({operation})])).rows
 if(rows.length!==1)throw new AdminMenuError(503,'Blog audit unavailable')
}
export async function readNativeBlogState(query:AdminMenuQuery,actor:NativeBlogActor){
 const tenant=await requireNativeBlogActor(query,actor)
 const settings=(await query('SELECT * FROM public.blog_settings WHERE tenant_id IS NOT DISTINCT FROM $1::uuid',[actor.scope])).rows[0]
 const telegram=(await query('SELECT * FROM public.telegram_settings WHERE tenant_id IS NOT DISTINCT FROM $1::uuid',[actor.scope])).rows[0]
 const drafts=(await query("SELECT id,title,excerpt,created_at FROM public.blog_posts WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND status='draft' AND ai_generated=true ORDER BY created_at DESC,id LIMIT 50",[actor.scope])).rows.map(dto)
 const published=(await query("SELECT id,title,slug,published_at FROM public.blog_posts WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND status='published' ORDER BY published_at DESC,id LIMIT 20",[actor.scope])).rows.map(dto)
 const jobs=(await query('SELECT id,status,trigger,source,pillar_id,topic,error_message,durations_ms,created_at,completed_at FROM public.blog_generation_jobs WHERE tenant_id IS NOT DISTINCT FROM $1::uuid ORDER BY created_at DESC,id LIMIT 20',[actor.scope])).rows.map(dto)
 const sources=(await query('SELECT * FROM public.blog_rss_sources WHERE tenant_id IS NOT DISTINCT FROM $1::uuid ORDER BY created_at,id LIMIT 1001',[actor.scope])).rows.map(dto)
 if(sources.length>1000)throw new AdminMenuError(409,'RSS source limit exceeded')
 const items=(await query('SELECT id,source_id,title,url,status,published_at FROM public.blog_rss_items WHERE tenant_id IS NOT DISTINCT FROM $1::uuid ORDER BY published_at DESC NULLS LAST,id LIMIT 50',[actor.scope])).rows.map(dto)
 const pendingItems=Number((await query("SELECT count(*)::int AS n FROM public.blog_rss_items WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND status='pending'",[actor.scope])).rows[0].n)
 const safe=settings?dto(settings):null;if(safe)delete safe.openrouter_api_key
 let masked:string|null=null;if(settings?.openrouter_api_key){try{masked=maskApiKey(decryptApiKey(String(settings.openrouter_api_key)))}catch{masked='(não foi possível descriptografar — a chave de criptografia mudou?)'}}
 const schedule=settings?nextScheduledRun({now:new Date(),timeZone:String(settings.timezone||'UTC'),postingHour:settings.posting_hour===null?null:Number(settings.posting_hour),postsPerDay:Number(settings.posts_per_day)})?.toISOString()??null:null
 return {settings:safe,hasOpenrouterKey:!!settings?.openrouter_api_key,maskedKey:masked,nextScheduledRunAt:schedule,telegram:safeNativeTelegram(telegram),publicPath:actor.scope?`/${tenant.slug}/blog`:'/blog',drafts,published,jobs,sources,items,pendingItems}
}
const settingColumns:Record<string,string>={enabled:'enabled',postsPerDay:'posts_per_day',postingHour:'posting_hour',timezone:'timezone',seoKeywords:'seo_keywords',promptStyle:'prompt_style',systemPrompt:'system_prompt',enableTrendAnalysis:'enable_trend_analysis',rssEnabled:'rss_enabled',autoPublish:'auto_publish',textModel:'text_model',imageModel:'image_model'}
export async function saveNativeBlogSettings(query:AdminMenuQuery,actor:NativeBlogActor,input:Record<string,unknown>){
 if(actor.scope!==null&&typeof input.postsPerDay==='number'&&input.postsPerDay>4)throw new AdminMenuError(400,'Tenant blog supports at most four daily posts')
 await requireNativeBlogActor(query,actor,true);await lockNativeBlogScope(query,actor.scope)
 const row=(await query('SELECT * FROM public.blog_settings WHERE tenant_id IS NOT DISTINCT FROM $1::uuid FOR UPDATE',[actor.scope])).rows[0]
 const update:Record<string,unknown>={}
 for(const [field,column] of Object.entries(settingColumns))if(field in input)update[column]=input[field]
 if(typeof input.openrouterApiKey==='string'){
  const incoming=input.openrouterApiKey.trim()
  if(!['********','••••'].includes(incoming)&&(actor.scope===null||incoming))update.openrouter_api_key=incoming?encryptApiKey(incoming):null
 }
 const columns=Object.keys(update),values=Object.values(update)
 if(!columns.length)return {ok:true}
 const result=row?await query(`UPDATE public.blog_settings SET ${columns.map((key,index)=>`${key}=$${index+2}`).join(',')},updated_at=clock_timestamp() WHERE id=$1 RETURNING id`,[row.id,...values])
  :await query(`INSERT INTO public.blog_settings(tenant_id,${columns.join(',')}) VALUES($1,${values.map((_,index)=>'$'+(index+2)).join(',')}) RETURNING id`,[actor.scope,...values])
 if(result.rows.length!==1)throw new AdminMenuError(503,'Blog settings unavailable')
 await nativeBlogAudit(query,actor.actorId,actor.scope,String(result.rows[0].id),'blog_settings_saved','blog_settings',row?'update':'insert')
 return {ok:true}
}
export async function decideNativeBlogPost(query:AdminMenuQuery,actor:NativeBlogActor,input:{postId:string;action:'approve'|'reject'|'edit';reason?:string;title?:string;excerpt?:string;content?:string}){
 if(!UUID.test(input.postId))throw new AdminMenuError(400,'Invalid post')
 await requireNativeBlogActor(query,actor,true);await lockNativeBlogScope(query,actor.scope)
 const post=(await query('SELECT id,title,excerpt,status FROM public.blog_posts WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE',[input.postId,actor.scope])).rows[0]
 if(!post)throw new AdminMenuError(404,'Post not found')
 if(input.action==='edit'){
  if(post.status!=='draft')throw new AdminMenuError(409,'Only drafts can be edited')
  await query('UPDATE public.blog_posts SET title=$2,excerpt=$3,content=$4,updated_at=clock_timestamp() WHERE id=$1',[post.id,input.title,input.excerpt??null,sanitizeBlogHtml(input.content??'')])
 }else{
  if(input.action==='approve'&&post.status==='published')return {ok:true,action:'approved'}
  await query(`INSERT INTO public.blog_post_feedback(tenant_id,post_id,post_title,post_excerpt,verdict,reason,decided_by)
   VALUES($1,$2,$3,$4,$5,$6,'admin')`,[actor.scope,post.id,post.title,post.excerpt,input.action==='approve'?'approved':'rejected',input.reason?.trim()||null])
  if(input.action==='approve')await query("UPDATE public.blog_posts SET status='published',published_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[post.id])
  else await query('DELETE FROM public.blog_posts WHERE id=$1',[post.id])
 }
 await nativeBlogAudit(query,actor.actorId,actor.scope,String(post.id),'blog_post_'+input.action,'blog_posts',input.action==='reject'?'delete':'update')
 return {ok:true,action:input.action==='approve'?'approved':input.action==='reject'?'rejected':'edited'}
}
export async function changeNativeRssSource(query:AdminMenuQuery,actor:NativeBlogActor,input:{action:'add'|'toggle'|'delete';id?:string;name?:string;url?:string;enabled?:boolean}){
 await requireNativeBlogActor(query,actor,true);await lockNativeBlogScope(query,actor.scope)
 let id=input.id
 if(input.action==='add'){
  const count=Number((await query('SELECT count(*)::int AS n FROM public.blog_rss_sources WHERE tenant_id IS NOT DISTINCT FROM $1::uuid',[actor.scope])).rows[0].n)
  if(count>=1000)throw new AdminMenuError(409,'RSS source limit reached')
  id=String((await query('INSERT INTO public.blog_rss_sources(tenant_id,name,url,enabled) VALUES($1,$2,$3,true) RETURNING id',[actor.scope,input.name,input.url])).rows[0].id)
 }else{
  if(!id||!UUID.test(id))throw new AdminMenuError(400,'Invalid RSS source')
  const rows=(await query(input.action==='delete'?'DELETE FROM public.blog_rss_sources WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid RETURNING id':'UPDATE public.blog_rss_sources SET enabled=$3,updated_at=clock_timestamp() WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid RETURNING id',input.action==='delete'?[id,actor.scope]:[id,actor.scope,input.enabled])).rows
  if(rows.length!==1)throw new AdminMenuError(404,'RSS source not found')
 }
 await nativeBlogAudit(query,actor.actorId,actor.scope,id,'blog_rss_'+input.action,'blog_rss_sources',input.action==='add'?'insert':input.action==='delete'?'delete':'update')
 return {ok:true}
}
export function normalizeNativeTelegramIds(ids:string[]) {
 const normalized=[...new Set(ids.map(id=>id.trim()).filter(Boolean))]
 if(normalized.length>20||normalized.some(id=>!parseTelegramTarget(id)))throw new AdminMenuError(400,'Invalid Telegram chat/topic ID')
 return normalized
}
