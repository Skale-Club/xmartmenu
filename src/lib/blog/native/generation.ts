import {randomUUID} from 'node:crypto'
import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
import {AdminMenuError} from '../../data/admin-menus'
import {getNativeStorageClient} from '../../storage'
import {buildBlogEditorialPrompt,parseGeneratedPost,hashSeed,readingTimeMinutes,type GenerationResult} from '../generator'
import {assignPillar,TENANT_BLOG_PILLARS,sanitizeGeneratedLinks} from '../prompt'
import {sanitizeBlogHtml,getPlainTextLength,slugifyTitle} from '../content-validator'
import {MIN_PLAIN_TEXT_CHARS,MAX_PLAIN_TEXT_CHARS} from '../contract'
import {isRunDue} from '../schedule'
import {coverPrompt,normaliseTo16x9} from '../cover-image'
import {tenantEffectDigest} from '../../data/tenant-effect-operations'
import {nativeBlogPhase} from './runtime'
import {readNativeBlogGenerationFacts,requireNativeBlogFacts} from './generation-data'
import {reserveNativeBlogOperation,claimNativeBlogOperation,prepareNativeBlogCall,recordNativeBlogCall,finishNativeBlogOperation,reconcileNativeBlogOperation,failNativeBlogOperation,ambiguousNativeBlogCoverCalls,expireStaleNativeBlogOperations} from './operations'
import {NativeBlogDefinitiveError,NativeBlogUnknownOutcomeError} from './outcome'
import {nativeBlogScope,lockNativeBlogScope,type NativeBlogContext} from './authority'
import {callNativeBlogAi} from './provider-call'
import {reserveNativeDraftNotification,dispatchNativeDraftNotification,drainNativeDraftNotifications} from './telegram'
export async function generateNativeBlogPost(context:NativeBlogContext,input:{trigger:'cron'|'manual';requestKey:string},send:typeof fetch=fetch):Promise<GenerationResult>{
 const now=new Date(),scope=nativeBlogScope(context),facts=await nativeBlogPhase(context,false,(query,current)=>readNativeBlogGenerationFacts(query,current))
 if(!facts)return {status:'skipped',reason:'no_settings'}
 const {settings,choice}=facts
 if(!choice)return {status:'skipped',reason:'not_configured'}
 if(settings.image_model?.trim())getNativeStorageClient()
 if(input.trigger==='cron'){
  if(!settings.enabled)return {status:'skipped',reason:'disabled'}
  if(settings.posts_per_day<=0)return {status:'skipped',reason:'posts_per_day_zero'}
  if(settings.posting_hour!==null){if(!isRunDue({now,timeZone:settings.timezone||'UTC',postingHour:settings.posting_hour,postsPerDay:settings.posts_per_day,lastRunAt:settings.last_run_at?new Date(settings.last_run_at):null}).due)return {status:'skipped',reason:'outside_posting_hour'}}
  else if(settings.last_run_at&&(now.getTime()-new Date(settings.last_run_at).getTime())/36e5<24/settings.posts_per_day)return {status:'skipped',reason:'too_soon'}
 }
 const model=settings.text_model||'anthropic/claude-sonnet-5'
 // Persist the expiry of a run that died with a deploy BEFORE the reservation below, which throws (and rolls back) while it is still blocked.
 await nativeBlogPhase(context,true,query=>expireStaleNativeBlogOperations(query,scope,'generation'))
 const reservation=await nativeBlogPhase(context,true,async(query,current)=>{
  await requireNativeBlogFacts(query,current,facts.digest)
  const op=await reserveNativeBlogOperation(query,current,'generation',input.requestKey,{trigger:input.trigger})
  if(op.status!=='reserved')return {operation:op,jobId:null}
  // Recheck cadence while serialized, after concurrent requests may advance it.
  const fresh=await requireNativeBlogFacts(query,current,facts.digest)
  if(input.trigger==='cron'&&fresh.settings.last_run_at!==settings.last_run_at)throw new AdminMenuError(409,'Blog cadence changed')
  const claimed=await claimNativeBlogOperation(query,current,op.id,facts.digest),jobId=randomUUID()
  await query(`INSERT INTO public.blog_generation_jobs(id,tenant_id,status,trigger,source,rss_item_id,model,started_at)
   VALUES($1,$2,'running',$3,$4,$5,$6,clock_timestamp())`,[jobId,scope,input.trigger,facts.rssItem?'rss':'pillar',facts.rssItem?.id??null,model])
  await query('UPDATE public.app_blog_operations SET generation_job_id=$2 WHERE id=$1',[op.id,jobId])
  if(input.trigger==='cron')await query('UPDATE public.blog_settings SET last_run_at=$2,updated_at=$2 WHERE tenant_id IS NOT DISTINCT FROM $1::uuid',[scope,now])
  return {operation:claimed,jobId}
 })
 const {operation,jobId}=reservation
 if(operation.status==='completed'&&operation.result){
  if(typeof operation.result.postId==='string')await drainNativeDraftNotifications(context,operation.result.postId).catch(()=>{})
  return operation.result as unknown as GenerationResult
 }
 if(!operation.claimId||!jobId)return {status:'failed',error:'This operation already started; inspect job history before another attempt'}
 const claimId=operation.claimId,started=Date.now()
 try{
  const assignment=assignPillar(facts.recentPillars,{hasRssItem:!!facts.rssItem,hasMenu:(facts.tenantContext?.dishes.length??0)>0,hasAddress:!!facts.tenantContext?.address?.trim()},hashSeed(jobId),facts.tenantContext?TENANT_BLOG_PILLARS:undefined)
  await nativeBlogPhase(context,true,(query)=>query('UPDATE public.blog_generation_jobs SET pillar_id=$2 WHERE id=$1',[jobId,assignment.pillar.id]))
  const {systemMessage,allowedLinkPaths}=buildBlogEditorialPrompt(settings,assignment,facts.rssItem,facts.tenantContext,facts.editorial)
  const call=(index:number,prompt:string)=>callNativeBlogAi({context,operationId:operation.id,claimId,index,settingsDigest:facts.digest,choice,body:{model,messages:[{role:'system',content:systemMessage},{role:'user',content:prompt}],temperature:0.7}},send)
  const topicStart=Date.now(),topicBody=await call(0,facts.rssItem?'Transforme a FONTE em UMA ideia de pauta, no formato que a PAUTA DESTE POST determina. A pauta tem que ser sobre o que a fonte significa para o nosso leitor, não um recontar dela. Devolva APENAS a pauta, nada mais.':'Proponha UMA ideia de pauta que cumpra a PAUTA DESTE POST: seu pilar, seu formato de título, um único assunto. Devolva APENAS a pauta, nada mais.')
  const contentText=(body:Record<string,unknown>)=>String((body.choices as Array<{message?:{content?:string}}>|undefined)?.[0]?.message?.content??'').trim()
  const topic=contentText(topicBody);if(!topic||topic.length>4000)throw new Error('Invalid topic')
  const topicMs=Date.now()-topicStart,contentStart=Date.now()
  const contentBody=await call(1,[`Escreva o post sobre "${topic}", cumprindo a PAUTA DESTE POST (pilar, formato do título, tamanho alvo).`,settings.enable_trend_analysis?'Onde for natural, ancore o texto na estação ou no calendário implicados pelo HOJE É acima.':'','Devolva JSON estritamente válido com exatamente estes campos, todos em português:','{"title":"","content":"","excerpt":"","metaDescription":"","focusKeyword":"","tags":""}','content é HTML pronto para publicação usando SOMENTE <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <a>, <blockquote>. Sem <h1>, sem <html>/<body>, sem imagens, sem scripts.','tags é uma lista separada por vírgulas com 3 a 5 tags. metaDescription tem menos de 160 caracteres.','Não envolva o JSON em bloco de código markdown.'].filter(Boolean).join('\n\n'))
  const generated=parseGeneratedPost(contentText(contentBody)),contentMs=Date.now()-contentStart
  generated.content=sanitizeBlogHtml(sanitizeGeneratedLinks(generated.content,allowedLinkPaths))
  const length=getPlainTextLength(generated.content)
  if(length<MIN_PLAIN_TEXT_CHARS||length>MAX_PLAIN_TEXT_CHARS)throw new Error('Generated content length is invalid')
  await nativeBlogPhase(context,true,async(query,current)=>{await requireNativeBlogFacts(query,current,facts.digest);await query('UPDATE public.app_blog_operations SET draft_payload=$3::jsonb WHERE id=$1 AND claim_id=$2',[operation.id,claimId,JSON.stringify(generated)])})
  let coverUrl:string|null=null,imageMs:number|null=null,uploadMs=0,coverSkipped=false
  // The cover is optional. Whatever goes wrong with it, the paid post is kept and
  // published with cover=null; its calls stay reviewable (ambiguous) on their own.
  if(settings.image_model?.trim()){
   try{
   const imageStart=Date.now(),image=await callNativeBlogAi({context,operationId:operation.id,claimId,index:2,settingsDigest:facts.digest,choice,image:true,optional:true,body:{model:settings.image_model,messages:[{role:'user',content:coverPrompt(generated.title,generated.focusKeyword||null)}],modalities:['image','text']}},send)
   const dataUrl=(image.choices as Array<{message?:{images?:Array<{image_url?:{url?:string}}>} }>|undefined)?.[0]?.message?.images?.[0]?.image_url?.url
   imageMs=Date.now()-imageStart
   const match=typeof dataUrl==='string'?dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i):null
   if(match){
    const bytes=Buffer.from(match[2],'base64');if(bytes.length>15728640)throw new Error('Cover exceeds image limit')
    const normalized=await normaliseTo16x9(bytes,match[1].toLowerCase()),path=`${scope?'tenants/'+scope:'_platform'}/blog/native/${operation.id}/cover.${normalized.extension}`,uploadStart=Date.now(),storage=getNativeStorageClient()
    await nativeBlogPhase(context,true,async(query,current)=>{await requireNativeBlogFacts(query,current,facts.digest);await prepareNativeBlogCall(query,current,operation.id,claimId,3,'storage',{path,contentDigest:tenantEffectDigest(normalized.buffer.toString('base64'))})})
    coverUrl=await storage.upload('tenant-assets',path,normalized.buffer,{contentType:normalized.mime,upsert:false,signal:AbortSignal.timeout(30000)})
    await ownedAdminTransaction(true,query=>recordNativeBlogCall(query,operation.id,claimId,3,{url:coverUrl}))
    if(!/^https:\/\//i.test(coverUrl))throw new Error('Confirmed HTTPS cover URL required')
    uploadMs=Date.now()-uploadStart
   }
   }catch{
    coverUrl=null;coverSkipped=true;imageMs=null;uploadMs=0
    await ownedAdminTransaction(true,query=>ambiguousNativeBlogCoverCalls(query,operation.id,claimId)).catch(()=>{})
   }
  }
  const result=await nativeBlogPhase(context,true,async(query,current)=>{
   await requireNativeBlogFacts(query,current,facts.digest);await lockNativeBlogScope(query,scope)
   const base=slugifyTitle(generated.title)||'post';let slug=base
   for(let suffix=2;(await query('SELECT id FROM public.blog_posts WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND slug=$2',[scope,slug])).rows.length;suffix++){if(suffix>1000)throw new AdminMenuError(409,'Post slug collision limit reached');slug=`${base}-${suffix}`}
   const postId=randomUUID()
   await query(`INSERT INTO public.blog_posts(id,tenant_id,title,slug,content,excerpt,meta_description,focus_keyword,tags,author_name,cover_image_url,reading_time_minutes,ai_generated,status,published_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14)`,[postId,scope,generated.title,slug,generated.content,generated.excerpt||null,generated.metaDescription||null,generated.focusKeyword||null,generated.tags||null,facts.tenantContext?.name??'Xmartmenu',coverUrl,readingTimeMinutes(generated.content),settings.auto_publish?'published':'draft',settings.auto_publish?now:null])
   if(facts.rssItem)await query("UPDATE public.blog_rss_items SET status='used',used_at=clock_timestamp(),used_post_id=$3 WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid AND status='pending'",[facts.rssItem.id,scope,postId])
   await query("UPDATE public.blog_generation_jobs SET status='completed',post_id=$2,topic=$3,completed_at=clock_timestamp(),durations_ms=$4::jsonb WHERE id=$1",[jobId,postId,topic,JSON.stringify({topic:topicMs,content:contentMs,image:imageMs,upload:uploadMs,total:Date.now()-started})])
   const outcome={status:'generated' as const,postId,jobId,title:generated.title,...(coverSkipped?{coverSkipped:true}:{})}
   await finishNativeBlogOperation(query,current,operation.id,claimId,outcome)
   const notification=settings.auto_publish?null:await reserveNativeDraftNotification(query,current,{postId,title:generated.title,excerpt:generated.excerpt||null,pillarLabel:assignment.pillar.label})
   return {outcome,notificationId:notification?.id}
  }).catch(error=>{throw error instanceof AdminMenuError?error:new NativeBlogUnknownOutcomeError('Publishing outcome needs review; the post may already have been saved')})
  if(result.notificationId)await dispatchNativeDraftNotification(context,result.notificationId,send).catch(()=>{})
  return result.outcome
 }catch(error){
  // Only a genuinely unknown outcome (timeout/network after send, 5xx, unseen commit)
  // is reconciled and blocks the tenant. A known refusal or unusable content is final.
  const unknown=error instanceof NativeBlogUnknownOutcomeError
  const message=unknown?'This operation needs review; no paid call will be automatically repeated':error instanceof NativeBlogDefinitiveError?error.message:'Generation failed; nothing is pending and you can try again'
  await ownedAdminTransaction(true,async query=>{
   if(unknown)await reconcileNativeBlogOperation(query,operation.id,claimId)
   else await failNativeBlogOperation(query,operation.id,claimId,error instanceof NativeBlogDefinitiveError?'provider_refused':'generation_failed')
   await query("UPDATE public.blog_generation_jobs SET status='failed',error_message=$2,completed_at=clock_timestamp() WHERE id=$1 AND status='running'",[jobId,message.slice(0,500)])
  }).catch(()=>{})
  return {status:'failed',error:message,jobId}
 }
}
