import {AdminMenuError,type AdminMenuQuery} from '../../data/admin-menus'
import {isChatAllowed,type TelegramSettingsRow} from '../telegram'
import {requireNativeBlogContext,lockNativeBlogScope,type NativeBlogContext} from './authority'
import {reserveNativeBlogOperation,claimNativeBlogOperation,finishNativeBlogOperation} from './operations'
import {nativeBlogAudit} from './admin-data'
export async function applyNativeTelegramDecision(query:AdminMenuQuery,context:Extract<NativeBlogContext,{kind:'telegram'}>,input:{callbackQueryId:string;chatId:string;postId:string;action:'approve'|'reject'}){
 const tenant=await requireNativeBlogContext(query,context,true);await lockNativeBlogScope(query,context.scope)
 const settings=(await query('SELECT * FROM public.telegram_settings WHERE id=$1 FOR SHARE',[context.settingsId])).rows[0]
 if(!settings||!isChatAllowed(settings as unknown as TelegramSettingsRow,input.chatId))throw new AdminMenuError(403,'Telegram chat is not allowed')
 const op=await reserveNativeBlogOperation(query,context,'telegram-callback',input.callbackQueryId,{postId:input.postId,action:input.action,chatId:input.chatId})
 if(op.status==='completed'){
  const ack=(await query("SELECT id FROM public.app_blog_operations WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND kind='telegram-send' AND request_key=$2",[context.scope,'ack:'+input.callbackQueryId])).rows[0]
  return {result:op.result,ackId:ack?String(ack.id):null,slug:tenant.slug}
 }
 if(op.status!=='reserved')throw new AdminMenuError(409,'Telegram callback is already being handled')
 const claimed=await claimNativeBlogOperation(query,context,op.id,context.secretHash)
 if(!claimed.claimId)throw new AdminMenuError(409,'Telegram callback claim unavailable')
 const post=(await query('SELECT id,title,excerpt,status FROM public.blog_posts WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE',[input.postId,context.scope])).rows[0]
 let result:Record<string,unknown>={ok:true,ignored:true}
 if(post){
  if(!(input.action==='approve'&&post.status==='published')){
   await query(`INSERT INTO public.blog_post_feedback(tenant_id,post_id,post_title,post_excerpt,verdict,decided_by)
    VALUES($1,$2,$3,$4,$5,'telegram')`,[context.scope,post.id,post.title,post.excerpt,input.action==='approve'?'approved':'rejected'])
   if(input.action==='approve')await query("UPDATE public.blog_posts SET status='published',published_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[post.id])
   else await query('DELETE FROM public.blog_posts WHERE id=$1',[post.id])
   await nativeBlogAudit(query,null,context.scope,String(post.id),'telegram_post_'+input.action)
  }
  result={ok:true,action:input.action==='approve'?'approved':'rejected'}
 }
 await finishNativeBlogOperation(query,context,op.id,claimed.claimId,result)
 const ack=await reserveNativeBlogOperation(query,context,'telegram-send','ack:'+input.callbackQueryId,{callbackQueryId:input.callbackQueryId,text:post?(input.action==='approve'?'Publicado.':'Rejeitado.'):'Este rascunho já não está disponível.'})
 return {result,ackId:ack.id,slug:tenant.slug}
}
