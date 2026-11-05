import {NextResponse} from 'next/server'
import {AdminMenuError} from '../../data/admin-menus'
import {nativeEmptyBlogInput} from './input'
import {runNativeBlogSweep,runNativeRssSweep} from './sweep'
/** Called only after the existing constant-time CRON_SECRET guard. */
export async function nativeBlogCronHttp(request:Request,kind:'generation'|'rss'){
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
 try{
  await nativeEmptyBlogInput(request)
  return json(kind==='rss'?await runNativeRssSweep():await runNativeBlogSweep(new URL(request.url).searchParams.get('manual')==='1'?'manual':'cron',request.headers.get('idempotency-key')??undefined))
 }catch(error){return json({error:error instanceof AdminMenuError&&error.status<500?error.message:'Native blog job is unavailable'},error instanceof AdminMenuError?error.status:error instanceof SyntaxError?400:503)}
}
