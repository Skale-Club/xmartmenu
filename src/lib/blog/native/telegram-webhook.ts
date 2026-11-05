import {applyNativeTelegramDecision} from './telegram-data'
import {createHash,timingSafeEqual} from 'node:crypto'
import {NextResponse} from 'next/server'
import {revalidatePath} from 'next/cache'
import {AdminMenuError} from '../../data/admin-menus'
import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
import {tenantAdminBody} from '../../admin/owned-tenant-administration-http'
import {UUID} from '../../auth/owned-principal'
import {parseApprovalCallbackData,isChatAllowed,type TelegramSettingsRow} from '../telegram'
import {dispatchNativeTelegramAck} from './telegram'
export async function nativeBlogTelegramWebhook(request:Request){
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
 try{
  const provided=request.headers.get('x-telegram-bot-api-secret-token')??''
  if(!provided||provided.length>256)throw new AdminMenuError(401,'Unauthorized')
  const body=await tenantAdminBody(request)
  if(!body||typeof body!=='object'||Array.isArray(body))throw new AdminMenuError(400,'Invalid Telegram update')
  const callback=(body as Record<string,unknown>).callback_query as {id?:unknown;data?:unknown;message?:{chat?:{id?:unknown}}}|undefined
  const settings=await ownedAdminTransaction(false,async query=>(await query('SELECT * FROM public.telegram_settings WHERE webhook_secret=$1 AND enabled=true AND approvals_enabled=true LIMIT 2',[provided])).rows)
  if(settings.length!==1||typeof settings[0].webhook_secret!=='string')throw new AdminMenuError(401,'Unauthorized')
  const expected=Buffer.from(settings[0].webhook_secret),actual=Buffer.from(provided)
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new AdminMenuError(401,'Unauthorized')
  if(!callback?.data)return json({ok:true,ignored:true})
  const parsed=typeof callback.data==='string'?parseApprovalCallbackData(callback.data):null
  if(!parsed||!UUID.test(parsed.postId)||typeof callback.id!=='string'||!callback.id||callback.id.length>128)return json({ok:true,ignored:true})
  const callbackQueryId=callback.id,chatId=String(callback.message?.chat?.id??'')
  if(!isChatAllowed(settings[0] as unknown as TelegramSettingsRow,chatId))return json({ok:true,ignored:true})
  const context={kind:'telegram' as const,scope:settings[0].tenant_id===null?null:String(settings[0].tenant_id),settingsId:String(settings[0].id),secretHash:createHash('sha256').update(provided).digest('hex')}
  const applied=await ownedAdminTransaction(true,query=>applyNativeTelegramDecision(query,context,{callbackQueryId,chatId,...parsed}))
  try{revalidatePath(context.scope?`/${applied.slug}/blog`:'/blog')}catch{}
  if(applied.ackId)await dispatchNativeTelegramAck(context,applied.ackId).catch(()=>{})
  return json(applied.result)
 }catch(error){return json({error:error instanceof AdminMenuError&&error.status<500?error.message:'Native Telegram webhook is unavailable'},error instanceof AdminMenuError?error.status:error instanceof SyntaxError?400:503)}
}
