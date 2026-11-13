import { NextResponse } from 'next/server'
import { AdminMenuError } from '../data/admin-menus'
import { getClientIp, rateLimit } from '../rate-limit'
import { invalid, McpOAuthError, mcpOrigin, nativeMcpSelected, object } from './oauth-model'
import { nativeMcpBrowserActor, nativeMcpOAuthStore } from './runtime'

const noStore={ 'Cache-Control':'no-store','Pragma':'no-cache' }
const cors={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type' }
export const oauthOptions = () => new Response(null,{ status:204,headers:{ ...noStore,...cors } })
const json=(value:unknown,status=200,publicCors=false)=>NextResponse.json(value,{ status,headers:{ ...noStore,...(publicCors ? cors : {}) } })
export async function mcpBody(request:Request,jsonBody=false) {
  const type=jsonBody ? 'application/json' : 'application/x-www-form-urlencoded'
  if (request.headers.get('content-type')?.split(';')[0]!==type) invalid('invalid_request','Invalid request content type')
  if (Number(request.headers.get('content-length') ?? 0)>16384) invalid('invalid_request','OAuth request is too large',413)
  const reader=request.body?.getReader(); if (!reader) invalid()
  const decoder=new TextDecoder(); let size=0,text='',timer:ReturnType<typeof setTimeout>|undefined
  const deadline=new Promise<never>((_,reject)=>{ timer=setTimeout(()=>{ reject(new McpOAuthError(400,'invalid_request','OAuth request timed out')); void reader.cancel().catch(()=>{}) },5000) })
  try { for (;;) { const part=await Promise.race([reader.read(),deadline]); if (part.done) break; size+=part.value.byteLength
    if (size>16384) invalid('invalid_request','OAuth request is too large',413); text+=decoder.decode(part.value,{ stream:true }) }
    text+=decoder.decode(); return jsonBody ? JSON.parse(text) as unknown : new URLSearchParams(text)
  } finally { clearTimeout(timer); reader.releaseLock() }
}
async function limit(request:Request,name:string,count:number) {
  if (!(await rateLimit(`mcp-oauth-${name}`,getClientIp(request),count,'1 m')).ok) invalid('temporarily_unavailable','Too many OAuth requests',429)
}
function currentOrigin(request:Request) {
  const { issuer }=mcpOrigin()
  if (request.headers.get('origin')!==issuer || (request.headers.get('host') ?? new URL(request.url).host)!==new URL(issuer).host) invalid('access_denied','Origin mismatch',403)
}
export async function nativeOAuthHttp(kind:'register'|'authorize'|'details'|'decision'|'token'|'revoke',request:Request) {
  const publicCors=['register','token','revoke'].includes(kind)
  try {
    if (!nativeMcpSelected()) return json({ error:'temporarily_unavailable',error_description:'Native OAuth is disabled' },503,publicCors)
    if (kind==='decision') currentOrigin(request)
    await limit(request,kind,kind==='register' ? 10 : 60)
    const store=nativeMcpOAuthStore()
    if (kind==='register') return json(await store.register(await mcpBody(request,true)),201,true)
    if (kind==='authorize') return NextResponse.redirect(await store.authorize(new URL(request.url).searchParams),{ status:302,headers:noStore })
    if (kind==='details') return json(await store.details(new URL(request.url).searchParams.get('authorization_id') ?? '',await nativeMcpBrowserActor()))
    if (kind==='decision') {
      const body=object(await mcpBody(request,true))
      if (Object.keys(body).some(key=>!['authorization_id','approve'].includes(key)) || typeof body.authorization_id!=='string' || typeof body.approve!=='boolean') invalid()
      return json({ redirect_url:await store.decide(body.authorization_id,await nativeMcpBrowserActor(),body.approve) })
    }
    const fields=await mcpBody(request) as URLSearchParams
    if (kind==='token') return json(await store.token(fields,request.headers.get('authorization')),200,true)
    await store.revoke(fields,request.headers.get('authorization')); return new Response(null,{ status:200,headers:{ ...noStore,...cors } })
  } catch (error) {
    if (error instanceof McpOAuthError) {
      const response=json({ error:error.code,error_description:error.message },error.status,publicCors)
      if(error.code==='invalid_client' && error.status===401) response.headers.set('WWW-Authenticate','Basic realm="xprout-mcp"')
      if(error.status===429) response.headers.set('Retry-After','60')
      return response
    }
    if (error instanceof AdminMenuError && error.status<500) return json({ error:'access_denied',error_description:'Current administrator authorization required' },error.status,publicCors)
    if (error instanceof SyntaxError) return json({ error:'invalid_request',error_description:'Invalid OAuth request body' },400,publicCors)
    return json({ error:'temporarily_unavailable',error_description:'OAuth service is unavailable' },503,publicCors)
  }
}
