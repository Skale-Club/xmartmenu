import {revalidatePath} from 'next/cache'
import {AdminMenuError} from '../../data/admin-menus'
import {UUID} from '../../auth/owned-principal'
import type {ActionResult,TenantBlogState} from '@/app/(admin)/posts/actions'
import {currentNativeBlogActor} from './authority-runtime'
import {nativeBlogPhase} from './runtime'
import {readNativeBlogState,saveNativeBlogSettings,decideNativeBlogPost,changeNativeRssSource} from './admin-data'
import {nativeBlogSettingsSchema,nativeBlogDecisionSchema,nativeBlogEditSchema,nativeBlogRssSchema,nativeBlogTelegramSchema} from './input'
import {generateNativeBlogPost} from './generation'
import {fetchNativeBlogRss} from './rss'
import {saveNativeTelegramSettings,checkNativeTelegramWebhook} from './telegram'
const message=(error:unknown)=>error instanceof AdminMenuError&&error.status<500?error.message:'Native blog is unavailable'
const invalidate=()=>{try{revalidatePath('/posts')}catch{}}
export async function loadNativeTenantBlogState():Promise<ActionResult<TenantBlogState>>{
 try{const actor=await currentNativeBlogActor();const data=await nativeBlogPhase({kind:'browser',actor},false,(query,current)=>readNativeBlogState(query,current.kind==='browser'?current.actor:actor));return {ok:true,data}}catch(error){return {ok:false,message:message(error)}}
}
export async function nativeTenantBlogMutation(action:'settings'|'decision'|'edit'|'rss'|'telegram',input:unknown,key?:string):Promise<ActionResult>{
 try{
  if(JSON.stringify(input).length>131072)throw new AdminMenuError(413,'Blog input is too large')
  const schema=action==='settings'?nativeBlogSettingsSchema:action==='decision'?nativeBlogDecisionSchema:action==='edit'?nativeBlogEditSchema:action==='rss'?nativeBlogRssSchema:nativeBlogTelegramSchema
  const parsed=schema.safeParse(input);if(!parsed.success)throw new AdminMenuError(400,'Invalid blog input')
  if(action==='telegram'&&(!key||!UUID.test(key)))throw new AdminMenuError(400,'Explicit request UUID required')
  const actor=await currentNativeBlogActor(false,true),context={kind:'browser' as const,actor}
  if(action==='telegram'){
   if(!key)throw new AdminMenuError(400,'Explicit request UUID required')
   const result=await saveNativeTelegramSettings(context,nativeBlogTelegramSchema.parse(parsed.data),key);invalidate();return result
  }
  await nativeBlogPhase(context,true,async(query,current)=>{
   if(current.kind!=='browser')throw new AdminMenuError(403,'Browser proof required')
   if(action==='settings')return saveNativeBlogSettings(query,current.actor,nativeBlogSettingsSchema.parse(parsed.data))
   if(action==='decision')return decideNativeBlogPost(query,current.actor,nativeBlogDecisionSchema.parse(parsed.data))
   if(action==='edit')return decideNativeBlogPost(query,current.actor,{...nativeBlogEditSchema.parse(parsed.data),action:'edit'})
   const rss=nativeBlogRssSchema.parse(parsed.data);if(rss.action==='fetch')throw new AdminMenuError(400,'Use the RSS fetch action')
   return changeNativeRssSource(query,current.actor,rss)
  })
  invalidate();return {ok:true}
 }catch(error){return {ok:false,message:message(error)}}
}
export async function generateNativeTenantPost(key?:string):Promise<ActionResult<{status:string}>>{
 try{
  if(!key||!UUID.test(key))throw new AdminMenuError(400,'Explicit request UUID required')
  const actor=await currentNativeBlogActor(false,true),result=await generateNativeBlogPost({kind:'browser',actor},{trigger:'manual',requestKey:key})
  invalidate()
  return result.status==='failed'?{ok:false,message:result.error}:result.status==='skipped'?{ok:false,message:'Generation was not started: '+result.reason}:{ok:true,data:{status:result.status}}
 }catch(error){return {ok:false,message:message(error)}}
}
export async function fetchNativeTenantRss():Promise<ActionResult<{sources:number;upserted:number;errors:string[]}>>{
 try{const actor=await currentNativeBlogActor(false,true),summary=await fetchNativeBlogRss({kind:'browser',actor});invalidate();return {ok:true,data:{sources:summary.sourcesProcessed,upserted:summary.itemsUpserted,errors:summary.errors.map(row=>`${row.sourceName}: ${row.message}`)}}}catch(error){return {ok:false,message:message(error)}}
}
export async function checkNativeTenantTelegram():Promise<ActionResult<{url:string|null;expected:string;lastError:string|null}>>{
 try{const actor=await currentNativeBlogActor(false,true),data=await checkNativeTelegramWebhook({kind:'browser',actor});return {ok:true,data}}catch(error){return {ok:false,message:message(error)}}
}
export async function saveNativeTenantTelegram(input:unknown,key?:string):Promise<ActionResult<{webhook:string|null}>>{
 try{
  if(!key||!UUID.test(key)||JSON.stringify(input).length>131072)throw new AdminMenuError(400,'Explicit request UUID and bounded input required')
  const parsed=nativeBlogTelegramSchema.safeParse(input);if(!parsed.success)throw new AdminMenuError(400,'Invalid Telegram settings')
  const actor=await currentNativeBlogActor(false,true),result=await saveNativeTelegramSettings({kind:'browser',actor},parsed.data,key)
  invalidate();return {ok:true,data:{webhook:result.webhook},...('message'in result?{message:result.message}:{})}
 }catch(error){return {ok:false,message:message(error)}}
}
