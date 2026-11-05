import {NextResponse} from 'next/server'
import {revalidatePath} from 'next/cache'
import {AdminMenuError,type AdminMenuQuery} from '../../data/admin-menus'
import {hasSameOriginAdminMutation} from '../../data/admin-display-settings'
import {tenantAdminBody} from '../../admin/owned-tenant-administration-http'
import {currentNativeBlogActor} from './authority-runtime'
import {nativeBlogPhase} from './runtime'
import {readNativeBlogState,saveNativeBlogSettings,decideNativeBlogPost,changeNativeRssSource} from './admin-data'
import {nativeBlogSettingsSchema,nativeBlogDecisionSchema,nativeBlogRssSchema,nativeEmptyBlogInput,nativeBlogRepairSchema} from './input'
import {listUnresolvedNativeBlogOperations,repairNativeBlogOperation} from './operations'
import {fetchNativeBlogRss} from './rss'
import {nativeBlogTelegramSchema} from './input'
import {saveNativeTelegramSettings} from './telegram'
import {generateNativeBlogPost} from './generation'
import {UUID} from '../../auth/owned-principal'
import type {NativeBlogActor} from './authority'
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function nativeBlogAdminHttp(kind:'settings'|'posts'|'rss'|'telegram'|'generate'|'operations',request?:Request){
 try{
  const mutation=!!request&&request.method!=='GET'
  if(mutation&&(!request||!hasSameOriginAdminMutation(request)))throw new AdminMenuError(403,'Origin mismatch')
  if(request?.headers.get('sec-fetch-site')==='cross-site')throw new AdminMenuError(403,'Origin mismatch')
  const raw=mutation&&request?(kind==='generate'?await nativeEmptyBlogInput(request):await tenantAdminBody(request)):undefined
  const schema=kind==='operations'?nativeBlogRepairSchema:kind==='settings'?nativeBlogSettingsSchema:kind==='posts'?nativeBlogDecisionSchema:kind==='telegram'?nativeBlogTelegramSchema:nativeBlogRssSchema
  if(kind==='generate'&&(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length))throw new AdminMenuError(400,'Generation body must be empty')
  const parsed=mutation&&kind!=='generate'?schema.safeParse(raw):null
  if(parsed&&!parsed.success)throw new AdminMenuError(400,'Invalid blog request')
  const key=request?.headers.get('idempotency-key')??''
  if(mutation&&(kind==='generate'||kind==='telegram')&&!UUID.test(key))throw new AdminMenuError(400,'Explicit Idempotency-Key UUID required')
  const actor=await currentNativeBlogActor(true,mutation),context={kind:'browser' as const,actor}
  const phase=<T>(write:boolean,operation:(query:AdminMenuQuery,actor:NativeBlogActor)=>Promise<T>)=>nativeBlogPhase(context,write,(query,current)=>{
   if(current.kind!=='browser')throw new AdminMenuError(403,'Browser authority required')
   return operation(query,current.actor)
  })
  if(kind==='operations'){
   if(!mutation)return json({operations:await phase(false,(query,current)=>listUnresolvedNativeBlogOperations(query,current))})
   if(!parsed?.success)throw new AdminMenuError(400,'Invalid blog request')
   const repair=nativeBlogRepairSchema.parse(parsed.data)
   return json(await phase(true,(query,current)=>repairNativeBlogOperation(query,current,repair.operationId)))
  }
  if(!mutation){
   const state=await phase(false,(query,current)=>readNativeBlogState(query,current))
   if(kind==='settings')return json({settings:state.settings?{...state.settings,openrouter_api_key_masked:state.maskedKey,has_openrouter_key:state.hasOpenrouterKey}:null,nextScheduledRunAt:state.nextScheduledRunAt})
   if(kind==='telegram')return json({settings:{enabled:state.telegram.enabled,approvals_enabled:state.telegram.approvalsEnabled,has_bot_token:state.telegram.hasBotToken,has_approvals_bot_token:state.telegram.hasApprovalsBotToken,chat_ids:state.telegram.chatIds,approvals_chat_ids:state.telegram.approvalsChatIds}})
   return json(kind==='posts'?{drafts:state.drafts,jobs:state.jobs}:{sources:state.sources,items:state.items})
  }
  if(kind==='generate'||kind==='telegram'){
   if(kind==='telegram')return json(await saveNativeTelegramSettings(context,nativeBlogTelegramSchema.parse(raw),key))
   const result=await generateNativeBlogPost(context,{trigger:'manual',requestKey:key})
   try{revalidatePath('/blog')}catch{}
   return json(result.status==='skipped'?{...result,error:'Generation was not started: '+result.reason}:result,result.status==='generated'?200:409)
  }
  if(!parsed?.success)throw new AdminMenuError(400,'Invalid blog request')
  if(kind==='settings')await phase(true,(query,current)=>saveNativeBlogSettings(query,current,nativeBlogSettingsSchema.parse(parsed.data)))
  else if(kind==='posts'){
   const result=await phase(true,(query,current)=>decideNativeBlogPost(query,current,nativeBlogDecisionSchema.parse(parsed.data)))
   try{revalidatePath('/blog')}catch{}
   return json(result)
  }else{
   const input=nativeBlogRssSchema.parse(parsed.data)
   if(input.action==='fetch')return json(await fetchNativeBlogRss(context))
   await phase(true,(query,current)=>changeNativeRssSource(query,current,input))
  }
  return json({ok:true})
 }catch(error){return json({error:error instanceof AdminMenuError&&error.status<500?error.message:error instanceof SyntaxError?'Invalid JSON body':'Native blog is unavailable'},error instanceof AdminMenuError?error.status:error instanceof SyntaxError?400:503)}
}
