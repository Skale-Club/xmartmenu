import {randomBytes,randomUUID} from 'node:crypto'
import {AdminMenuError,type AdminMenuQuery} from '../../data/admin-menus'
import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
import {encryptApiKey,decryptApiKey} from '../../crypto'
import {tenantEffectDigest} from '../../data/tenant-effect-operations'
import {parseTelegramTarget} from '../contract'
import {buildApprovalCallbackData,webhookUrl} from '../telegram'
import {nativeBlogScope,requireNativeBlogContext,type NativeBlogContext} from './authority'
import {nativeBlogPhase} from './runtime'
import {normalizeNativeTelegramIds,nativeBlogAudit} from './admin-data'
import {reserveNativeBlogOperation,claimNativeBlogOperation,lockNativeBlogOperation,prepareNativeBlogCall,recordNativeBlogCall,finishNativeBlogOperation,reconcileNativeBlogOperation,failNativeBlogOperation,recordNativeBlogCallFailure,expireStaleNativeBlogOperations} from './operations'
import {NativeBlogDefinitiveError,NativeBlogUnknownOutcomeError,definitiveHttpStatus} from './outcome'
import {nativeBlogResponseJson} from './provider-call'
const decrypt=(value:unknown)=>{if(typeof value!=='string'||!value)return null;try{return decryptApiKey(value)||null}catch{return null}}
const origin=()=>{const url=new URL(process.env.NEXT_PUBLIC_SITE_URL??'https://xmartmenu.com');if(url.protocol!=='https:'||url.username||url.password)throw new AdminMenuError(503,'Public blog URL unavailable');return url.origin}
const readSettings=async(query:AdminMenuQuery,scope:string|null)=>(await query('SELECT * FROM public.telegram_settings WHERE tenant_id IS NOT DISTINCT FROM $1::uuid',[scope])).rows[0]
const settingsDigest=(row:Record<string,unknown>|undefined)=>tenantEffectDigest(row?Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value])):null)
const plainToken=(row:Record<string,unknown>)=>decrypt(row.approvals_bot_token)??decrypt(row.bot_token)
async function assertSettings(query:AdminMenuQuery,scope:string|null,digest:string){const row=await readSettings(query,scope);if(settingsDigest(row)!==digest)throw new AdminMenuError(409,'Telegram configuration changed');return row}
async function writeSettings(query:AdminMenuQuery,context:NativeBlogContext,desired:Record<string,unknown>,previousDigest:string){
 const scope=nativeBlogScope(context),current=await assertSettings(query,scope,previousDigest)
 const values=[desired.id,scope,desired.enabled,desired.bot_token,desired.chat_ids,desired.approvals_enabled,desired.approvals_bot_token,desired.approvals_chat_ids,desired.webhook_secret]
 if(current)await query('UPDATE public.telegram_settings SET enabled=$3,bot_token=$4,chat_ids=$5,approvals_enabled=$6,approvals_bot_token=$7,approvals_chat_ids=$8,webhook_secret=$9,updated_at=clock_timestamp() WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid',values)
 else await query('INSERT INTO public.telegram_settings(id,tenant_id,enabled,bot_token,chat_ids,approvals_enabled,approvals_bot_token,approvals_chat_ids,webhook_secret) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',values)
 await nativeBlogAudit(query,context.kind==='browser'?context.actor.actorId:null,scope,String(desired.id),'telegram_settings_saved','telegram_settings',current?'update':'insert')
}
/** Official endpoint only; token stays in memory and is never logged or saved
 * in a request payload/receipt. One network call, no automatic retry. */
export async function callNativeTelegram(token:string,method:'setWebhook'|'deleteWebhook'|'sendMessage'|'answerCallbackQuery'|'getWebhookInfo',body:Record<string,unknown>,send:typeof fetch=fetch){
 if(!token||token.length>400||/[/\s?#]/.test(token))throw new NativeBlogDefinitiveError('Invalid bot credential')
 const response=await send(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
 // A 4xx (wrong token, chat not found, ...) is Telegram answering no: definitive, never blocks the panel.
 if(definitiveHttpStatus(response.status)){await response.body?.cancel().catch(()=>{});throw new NativeBlogDefinitiveError(`Telegram rejected the request (HTTP ${response.status}); check the bot token and chat`)}
 const result=await nativeBlogResponseJson(response,2097152)
 if(!response.ok)throw new NativeBlogUnknownOutcomeError('Telegram outcome needs review')
 if(result.ok!==true)throw new NativeBlogUnknownOutcomeError('Telegram answered without confirming the request')
 return result
}
/** Nothing left the building (error before the request), or Telegram answered with a refusal: final. Otherwise the outcome is unknown. */
const telegramFailureIsFinal=(error:unknown,sent:boolean)=>error instanceof NativeBlogDefinitiveError||(!sent&&!(error instanceof NativeBlogUnknownOutcomeError))
async function closeTelegramOperation(id:string,claimId:string,final:boolean,index:number){
 await ownedAdminTransaction(true,async query=>{
  if(final){await recordNativeBlogCallFailure(query,id,claimId,index,{final:true});await failNativeBlogOperation(query,id,claimId,'telegram_refused')}
  else await reconcileNativeBlogOperation(query,id,claimId)
 }).catch(()=>{})
}
export async function saveNativeTelegramSettings(context:NativeBlogContext,input:Record<string,unknown>,key:string,send:typeof fetch=fetch){
 if(context.kind!=='browser')throw new AdminMenuError(403,'Browser administrator required')
 const scope=nativeBlogScope(context),requestDigest=tenantEffectDigest({...input,...('botToken'in input?{botToken:tenantEffectDigest(input.botToken)}:{}),...('approvalsBotToken'in input?{approvalsBotToken:tenantEffectDigest(input.approvalsBotToken)}:{})})
 await nativeBlogPhase(context,true,query=>expireStaleNativeBlogOperations(query,scope,'telegram-settings'))
 const op=await nativeBlogPhase(context,true,async(query,current)=>{
  const previous=await readSettings(query,scope),desired:Record<string,unknown>={id:previous?.id??randomUUID(),enabled:previous?.enabled??false,bot_token:previous?.bot_token??null,chat_ids:previous?.chat_ids??[],approvals_enabled:previous?.approvals_enabled??false,approvals_bot_token:previous?.approvals_bot_token??null,approvals_chat_ids:previous?.approvals_chat_ids??[],webhook_secret:previous?.webhook_secret??null}
  for(const [field,column] of [['enabled','enabled'],['approvalsEnabled','approvals_enabled']] as const)if(field in input)desired[column]=input[field]
  for(const [field,column] of [['chatIds','chat_ids'],['approvalsChatIds','approvals_chat_ids']] as const)if(Array.isArray(input[field]))desired[column]=normalizeNativeTelegramIds(input[field] as string[])
  for(const [field,column] of [['botToken','bot_token'],['approvalsBotToken','approvals_bot_token']] as const){const raw=input[field];if(typeof raw==='string'&&!['********','••••'].includes(raw.trim()))desired[column]=raw.trim()?encryptApiKey(raw.trim()):null}
  if(input.approvalsEnabled===true&&!desired.webhook_secret)desired.webhook_secret=randomBytes(32).toString('hex')
  if(input.approvalsEnabled===false)desired.webhook_secret=null
  if(desired.enabled&&desired.approvals_enabled&&(!plainToken(desired)||!desired.webhook_secret))throw new AdminMenuError(400,'Configure a bot before enabling approvals')
  return reserveNativeBlogOperation(query,current,'telegram-settings',key,{desired,previousDigest:settingsDigest(previous),previousToken:previous?.approvals_bot_token??previous?.bot_token??null,previousSecret:!!previous?.webhook_secret},requestDigest,desired.enabled===true&&desired.approvals_enabled===true)
 })
 if(op.status==='completed')return {ok:true,webhook:typeof op.result?.webhook==='string'?op.result.webhook:null}
 if(op.status!=='reserved')throw new AdminMenuError(409,'Telegram settings operation needs review; do not resend it')
 const desired=op.input.desired as Record<string,unknown>,previousDigest=String(op.input.previousDigest),enabling=desired.enabled===true&&desired.approvals_enabled===true
 const token=enabling?plainToken(desired):plainToken(desired)??decrypt(op.input.previousToken)
 const needsNetwork=enabling||!!token&&op.input.previousSecret===true
 const claimed=await nativeBlogPhase(context,true,async(query,current)=>{
  await assertSettings(query,scope,previousDigest)
  const value=await claimNativeBlogOperation(query,current,op.id,previousDigest)
  // Disabling revokes the local webhook secret in the claim's commit, even
  // when the remote deletion is unavailable or its response is ambiguous.
  if(!enabling)await writeSettings(query,current,desired,previousDigest)
  return {...value,preCallDigest:settingsDigest(await readSettings(query,scope))}
 });if(!claimed.claimId)throw new AdminMenuError(409,'Telegram claim unavailable')
 const claimId=claimed.claimId
 let sent=false
 try{
  if(needsNetwork&&token){
   const method=enabling?'setWebhook':'deleteWebhook',body=enabling?{url:webhookUrl(origin()),secret_token:desired.webhook_secret,allowed_updates:['callback_query']}:{}
   await nativeBlogPhase(context,true,async(query,current)=>{await assertSettings(query,scope,claimed.preCallDigest);await prepareNativeBlogCall(query,current,op.id,claimId,0,'telegram',{method,body})})
   sent=true
   const response=await callNativeTelegram(token,method,body,send)
   await ownedAdminTransaction(true,query=>recordNativeBlogCall(query,op.id,claimId,0,{ok:true,bodyDigest:tenantEffectDigest(response)}))
  }
  await nativeBlogPhase(context,true,async(query,current)=>{
   if(enabling)await writeSettings(query,current,desired,previousDigest)
   await finishNativeBlogOperation(query,current,op.id,claimId,{ok:true,webhook:enabling?webhookUrl(origin()):null})
  })
  return {ok:true,webhook:enabling?webhookUrl(origin()):null}
 }catch(error){
  const final=telegramFailureIsFinal(error,sent)
  await closeTelegramOperation(op.id,claimId,final,0)
  if(!enabling)return {ok:true,webhook:null,pending:true,message:final?'Disabled locally; Telegram refused the webhook removal (check the bot token), nothing else is pending':'Disabled locally; remote webhook removal needs review'}
  throw error instanceof AdminMenuError?error:new AdminMenuError(409,'Telegram registration needs reconciliation; do not resend it')
 }
}
export async function checkNativeTelegramWebhook(context:NativeBlogContext,send:typeof fetch=fetch){
 const row=await nativeBlogPhase(context,false,query=>readSettings(query,nativeBlogScope(context))),digest=settingsDigest(row),token=row?plainToken(row):null
 if(!token)throw new AdminMenuError(400,'No bot configured')
 const response=await callNativeTelegram(token,'getWebhookInfo',{},send)
 await nativeBlogPhase(context,false,query=>assertSettings(query,nativeBlogScope(context),digest))
 const result=response.result as Record<string,unknown>|undefined
 return {url:typeof result?.url==='string'?result.url:null,expected:webhookUrl(origin()),lastError:typeof result?.last_error_message==='string'?'Telegram reported a delivery error':null}
}
const escapeHtml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
export async function reserveNativeDraftNotification(query:AdminMenuQuery,context:NativeBlogContext,draft:{postId:string;title:string;excerpt:string|null;pillarLabel:string}){
 const row=await readSettings(query,nativeBlogScope(context))
 if(row?.enabled!==true||row.approvals_enabled!==true)return null
 return reserveNativeBlogOperation(query,context,'telegram-send',`draft:${draft.postId}`,{...draft})
}
export async function dispatchNativeDraftNotification(context:NativeBlogContext,id:string,send:typeof fetch=fetch){
 const scope=nativeBlogScope(context)
 const reserved=await nativeBlogPhase(context,true,async(query,current)=>({op:await lockNativeBlogOperation(query,current,id),settings:await readSettings(query,scope),tenant:await requireNativeBlogContext(query,current)}))
 if(reserved.op.status!=='reserved')return {status:reserved.op.status}
 const settings=reserved.settings,token=settings?plainToken(settings):null
 if(!settings||settings.enabled!==true||settings.approvals_enabled!==true||!token)return {status:'pending'}
 const digest=settingsDigest(settings),dedicated=settings.approvals_chat_ids as string[],targets=normalizeNativeTelegramIds(dedicated.length?dedicated:settings.chat_ids as string[])
 if(!targets.length)return {status:'pending'}
 const claimed=await nativeBlogPhase(context,true,async(query,current)=>{await assertSettings(query,scope,digest);return claimNativeBlogOperation(query,current,id,digest)})
 if(!claimed.claimId)throw new AdminMenuError(409,'Notification claim unavailable')
 const claimId=claimed.claimId,draft=claimed.input,heading=scope?'Novo rascunho do blog à espera de aprovação':'New blog draft awaiting approval',panelUrl=origin()+(scope?'/posts':'/admin/blog')
 const text=[`<b>${heading}</b>`,...(scope?[escapeHtml(reserved.tenant.name)]:[]),'',`<b>${escapeHtml(String(draft.title))}</b>`,...(draft.excerpt?['',escapeHtml(String(draft.excerpt))]:[]),'',`${scope?'Tema':'Pillar'}: ${escapeHtml(String(draft.pillarLabel))}`,'',panelUrl].join('\n')
 let sent=false,failedIndex=0
 try{
  for(const [index,entry] of targets.entries()){
   failedIndex=index
   const target=parseTelegramTarget(entry);if(!target)throw new AdminMenuError(400,'Invalid Telegram destination')
   const body={chat_id:target.chatId,...(target.threadId?{message_thread_id:target.threadId}:{}),text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:{inline_keyboard:[[{text:scope?'✅ Aprovar e publicar':'✅ Approve & publish',callback_data:buildApprovalCallbackData('approve',String(draft.postId))},{text:scope?'❌ Rejeitar':'❌ Reject',callback_data:buildApprovalCallbackData('reject',String(draft.postId))}]]}}
   await nativeBlogPhase(context,true,async(query,current)=>{await assertSettings(query,scope,digest);await prepareNativeBlogCall(query,current,id,claimId,index,'telegram',body)})
   sent=true
   const response=await callNativeTelegram(token,'sendMessage',body,send),result=response.result as Record<string,unknown>|undefined
   if(!Number.isSafeInteger(result?.message_id))throw new Error('Confirmed Telegram message ID required')
   await ownedAdminTransaction(true,query=>recordNativeBlogCall(query,id,claimId,index,{ok:true,messageId:result?.message_id,bodyDigest:tenantEffectDigest(response)}))
  }
  await nativeBlogPhase(context,true,(query,current)=>finishNativeBlogOperation(query,current,id,claimId,{delivered:targets.length}))
  return {status:'delivered'}
 }catch(error){
  const final=telegramFailureIsFinal(error,sent)
  await closeTelegramOperation(id,claimId,final,failedIndex)
  return {status:final?'failed':'reconcile'}
 }
}
export async function dispatchNativeTelegramAck(context:NativeBlogContext,id:string,send:typeof fetch=fetch){
 const scope=nativeBlogScope(context)
 const reserved=await nativeBlogPhase(context,true,async(query,current)=>({op:await lockNativeBlogOperation(query,current,id),settings:await readSettings(query,scope)}))
 if(reserved.op.status!=='reserved')return {status:reserved.op.status}
 const token=reserved.settings?plainToken(reserved.settings):null
 if(!token)return {status:'pending'}
 const digest=settingsDigest(reserved.settings),claimed=await nativeBlogPhase(context,true,(query,current)=>claimNativeBlogOperation(query,current,id,digest))
 if(!claimed.claimId)throw new AdminMenuError(409,'Telegram acknowledgement claim unavailable')
 const claimId=claimed.claimId,body={callback_query_id:String(claimed.input.callbackQueryId),text:String(claimed.input.text),show_alert:false}
 let sent=false
 try{
  await nativeBlogPhase(context,true,async(query,current)=>{await assertSettings(query,scope,digest);await prepareNativeBlogCall(query,current,id,claimId,0,'telegram',{method:'answerCallbackQuery',body})})
  sent=true
  const response=await callNativeTelegram(token,'answerCallbackQuery',body,send)
  await ownedAdminTransaction(true,query=>recordNativeBlogCall(query,id,claimId,0,{ok:true,bodyDigest:tenantEffectDigest(response)}))
  await nativeBlogPhase(context,true,(query,current)=>finishNativeBlogOperation(query,current,id,claimId,{ok:true}))
  return {status:'delivered'}
 }catch(error){const final=telegramFailureIsFinal(error,sent);await closeTelegramOperation(id,claimId,final,0);return {status:final?'failed':'reconcile'}}
}
/** Scheduled handoff reads provenance from the private operation row; it never
 * substitutes the tenant's current owner for the actor who created the work. */
export async function drainNativeDraftNotifications(context:NativeBlogContext,postId?:string){
 const scope=nativeBlogScope(context)
 const rows=await nativeBlogPhase(context,false,async query=>(await query(`SELECT id,tenant_id,actor_id,actor_session_hash,authenticated_at,actor_project_id,actor_subject FROM public.app_blog_operations
  WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND kind='telegram-send' AND status='reserved' AND input ? 'postId'
  AND ($2::text IS NULL OR request_key='draft:'||$2) ORDER BY created_at,id LIMIT 20`,[scope,postId??null])).rows)
 for(const row of rows){
  let authority:NativeBlogContext={kind:'cron',scope}
  if(row.actor_id){
   if(!(row.authenticated_at instanceof Date))continue
   authority={kind:'browser',actor:{actorId:String(row.actor_id),sessionHash:String(row.actor_session_hash),scope,projectId:String(row.actor_project_id),subject:String(row.actor_subject),authenticatedAt:Math.floor(row.authenticated_at.getTime()/1000),checkedAt:Date.now()}}
  }
  await dispatchNativeDraftNotification(authority,String(row.id)).catch(()=>{})
 }
}
