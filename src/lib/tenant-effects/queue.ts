import { Client,Receiver } from '@upstash/qstash'
import { AdminMenuError } from '../data/admin-menus'
import { tenantEffectsSelected } from '../data/tenant-effect-authority-runtime'
import { UUID,ownedAuthSelected } from '../auth/owned-principal'

export function nativeQueueUrl(kind:'crm'|'ai',env:Record<string,string|undefined>=process.env) {
  const path=kind==='crm'?'/api/internal/xphere-sync':'/api/internal/native-tenant-effects'
  const raw=kind==='crm'?env.XPHERE_WORKER_URL:env.NATIVE_TENANT_EFFECTS_WORKER_URL
  let url:URL
  try{url=new URL(raw??path,env.NEXT_PUBLIC_APP_URL)}catch{throw new AdminMenuError(503,'Native worker configuration is unavailable')}
  if(url.protocol!=='https:' || url.username || url.password || url.hash || url.search || url.pathname!==path)throw new AdminMenuError(503,'Native worker configuration is unavailable')
  return url.href
}
export function requireNativeQueue(kind:'crm'|'ai') {
  if(!ownedAuthSelected() || !tenantEffectsSelected() || !process.env.QSTASH_TOKEN || !process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY)throw new AdminMenuError(503,'Native worker configuration is unavailable')
  return nativeQueueUrl(kind)
}
export async function publishNativeTenantWork(kind:'crm'|'ai',id:string) {
  if(!UUID.test(id))throw new AdminMenuError(400,'Invalid native work ID')
  const url=requireNativeQueue(kind),token=process.env.QSTASH_TOKEN!
  const client=new Client(process.env.QSTASH_URL?{token,baseUrl:process.env.QSTASH_URL}:{token})
  await client.publishJSON({url,body:kind==='crm'?{effectId:id}:{operationId:id},retries:0,deduplicationId:`xmartmenu-native:${kind}:${id}`})
}
/** Verify the same bounded raw bytes against the configured public URL. No
 * caller-supplied URL, tenant, actor hash or role reaches a worker capability. */
export async function verifyNativeTenantWork(request:Request,kind:'crm'|'ai') {
  const url=requireNativeQueue(kind)
  if(Number(request.headers.get('content-length')??0)>8192)throw new AdminMenuError(413,'Worker request is too large')
  const reader=request.body?.getReader();if(!reader)throw new AdminMenuError(400,'Worker body required')
  let size=0,raw='',timer:ReturnType<typeof setTimeout>|undefined;const decoder=new TextDecoder()
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new AdminMenuError(400,'Worker request timed out'))},5000)})
  try{for(;;){const next=await Promise.race([reader.read(),timeout]);if(next.done)break;size+=next.value.byteLength;if(size>8192)throw new AdminMenuError(413,'Worker request is too large');raw+=decoder.decode(next.value,{stream:true})}raw+=decoder.decode()}
  finally{clearTimeout(timer);reader.releaseLock()}
  const receiver=new Receiver({currentSigningKey:process.env.QSTASH_CURRENT_SIGNING_KEY!,nextSigningKey:process.env.QSTASH_NEXT_SIGNING_KEY!})
  let valid=false;try{valid=await receiver.verify({signature:request.headers.get('upstash-signature')??'',body:raw,url})}catch{}
  if(!valid)throw new AdminMenuError(401,'Invalid worker signature')
  const body:unknown=JSON.parse(raw),key=kind==='crm'?'effectId':'operationId'
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==1 || !(key in body))throw new AdminMenuError(400,'Invalid native worker payload')
  const id=(body as Record<string,unknown>)[key]
  if(typeof id!=='string' || !UUID.test(id))throw new AdminMenuError(400,'Invalid native worker ID')
  return id
}
