import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { Pool } from 'pg'
import { createIdentityHttp,type IdentityHttpDependencies } from '../../src/lib/auth/identity-http'
import { IdentityStore } from '../../src/lib/auth/identity-store'
import { verifyGoogleIdentity } from '../../src/lib/auth/google-identity'
import { readGoogleRuntimeAdc } from '../../src/lib/auth/google-runtime-adc'
import { getGoogleX509AccessToken } from '../../src/lib/auth/google-x509-access-token'
import { createGoogleAccountStatusReader } from '../../src/lib/auth/provider-account-status'
import { createGoogleCustomerAccountReader } from '../../src/lib/auth/google-customer-account'
import { verifyPublicProject } from '../../src/lib/auth/public-project-proof'
import { createLegacyOwnerReader } from '../../src/lib/auth/legacy-account-proof'
import { readLegacyPasswordOwner } from '../../src/lib/auth/legacy-password-proof'
import { OwnedPrincipalRepository } from '../../src/lib/auth/owned-principal'
import { PILOT_PREFIX,PILOT_ORIGIN,PILOT_PORT,PILOT_OPERATIONS,pilotConfiguration,PILOT_ADMISSION_SQL,assertPilotAdmission } from './xmartmenu-identity-pilot-policy'

const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Xmartmenu isolated sign-in proof</title>
<body><main><h1>Isolated sign-in proof</h1><p>This session accesses the isolated copy only. First prove your previous account, then Google or phone. Your original account and role are preserved.</p>
<label>Previous account email <input id="email" type="email" autocomplete="username" maxlength="320"></label>
<label>Previous account password <input id="password" type="password" autocomplete="current-password" maxlength="4096"></label>
<button id="google">Prove Google sign-in</button><form id="phone-form"><label>Phone <input id="phone" type="tel" placeholder="+ country code and number" required></label><div id="captcha"></div><label>SMS code <input id="code" inputmode="numeric" autocomplete="one-time-code"></label><button id="phone-submit">Send code</button></form>
<button id="logout">Sign out of the isolated copy</button><p id="status" role="status" aria-live="polite"></p></main><script src="${PILOT_PREFIX}/browser.js" defer></script></body></html>`
const headers={ 'Cache-Control':'no-store',Pragma:'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
  'Cross-Origin-Opener-Policy':'same-origin-allow-popups',
  'Content-Security-Policy':"default-src 'none'; script-src 'self' https://apis.google.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://www.google.com https://www.recaptcha.net; frame-src https://skaleclub.firebaseapp.com https://www.google.com https://www.recaptcha.net; style-src 'self'; img-src 'self' data: https://www.gstatic.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" }
export function createPilotHandler(deps:IdentityHttpDependencies,browser:string) {
  if (deps.origin!==PILOT_ORIGIN) throw new Error('Pilot origin refused')
  const handle=createIdentityHttp({ ...deps,cookieMode:'isolated-pilot',register:undefined,completeStaffAccess:undefined })
  return async(request:Request):Promise<Response>=>{
    const url=new URL(request.url)
    if (url.origin!==PILOT_ORIGIN || request.headers.get('host')!==new URL(PILOT_ORIGIN).host || url.search || url.hash
      || request.headers.get('sec-fetch-site')==='cross-site') return new Response(null,{status:404,headers})
    if (request.method==='GET' && url.pathname===`${PILOT_PREFIX}/`) return new Response(page,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}})
    if (request.method==='GET' && url.pathname===`${PILOT_PREFIX}/browser.js`) return new Response(browser,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}})
    if (request.method==='GET' && url.pathname===`${PILOT_PREFIX}/health`) return Response.json({isolated:true,ready:true},{headers})
    const operation=url.pathname.startsWith(`${PILOT_PREFIX}/api/`) ? url.pathname.slice(`${PILOT_PREFIX}/api/`.length) : ''
    if (!PILOT_OPERATIONS.has(operation)) return new Response(null,{status:404,headers})
    const response=await handle(request,operation)
    for(const [key,value] of Object.entries(headers)) response.headers.set(key,value)
    return response
  }
}
/** No ambient env, Next runtime, Source SQL/SDK, jobs, registration or financial gateway. */
export async function startPilot(input:unknown,browser:string) {
  const selected=pilotConfiguration(input),{env,config}=selected
  const pool=new Pool({ssl:config.ssl,connectionString:config.connectionString,max:2,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,idleTimeoutMillis:30000,options:'-c search_path=pg_catalog,public'})
  pool.on('error',()=>{})
  try {
    const admission=await pool.query(PILOT_ADMISSION_SQL)
    if(admission.rows.length!==1) throw new Error('Isolated pilot admission refused')
    assertPilotAdmission(admission.rows[0],selected)
    const accessToken=async(signal:AbortSignal)=>getGoogleX509AccessToken(readGoogleRuntimeAdc({application:'xmartmenu',projectId:config.web.projectId,projectNumber:config.projectNumber,production:true},env),signal)
    const status=createGoogleAccountStatusReader(accessToken),metadata=createGoogleCustomerAccountReader(accessToken),store=new IdentityStore(pool,status,metadata)
    const legacyOwner=createLegacyOwnerReader({url:env.NEXT_PUBLIC_SUPABASE_URL,anonKey:env.NEXT_PUBLIC_SUPABASE_ANON_KEY})
    // A single isolated instance has a bounded global budget independent of caller-controlled forwarding headers.
    let window=Date.now(),requests=0
    const handler=createPilotHandler({enabled:()=>true,origin:config.origin,config:config.web,
      verifyConfig:()=>verifyPublicProject({...config.web,projectNumber:config.projectNumber,origin:config.origin}),
      allowRequest:async()=>{if(Date.now()-window>=900000){window=Date.now();requests=0} return ++requests<=100},
      verify:token=>verifyGoogleIdentity(token,config.web.projectId,{recent:true}),legacyOwner,
      legacyPasswordOwner:(email,password,signal)=>readLegacyPasswordOwner(email,password,{env,signal}),
      eligibleOwner:async userId=>{const profile=await new OwnedPrincipalRepository((text,values)=>pool.query(text,values)).profile(userId,new Date());return !!profile&&!profile.mustChangePassword},store},browser)
    const server=createServer({requestTimeout:15000,headersTimeout:5000,maxHeaderSize:16384},async(incoming,outgoing)=>{
      const controller=new AbortController();incoming.on('aborted',()=>controller.abort())
      try {
        const requestHeaders=new Headers()
        for(let i=0;i<incoming.rawHeaders.length;i+=2) requestHeaders.append(incoming.rawHeaders[i],incoming.rawHeaders[i+1])
        const options:RequestInit&{duplex?:'half'}={method:incoming.method,headers:requestHeaders,signal:controller.signal}
        if(!['GET','HEAD'].includes(incoming.method??'')){options.body=Readable.toWeb(incoming) as ReadableStream<Uint8Array>;options.duplex='half'}
        const response=await handler(new Request(`${PILOT_ORIGIN}${incoming.url??'/'}`,options))
        outgoing.statusCode=response.status
        response.headers.forEach((value,key)=>{if(key!=='set-cookie')outgoing.setHeader(key,value)})
        const cookies=response.headers.getSetCookie();if(cookies.length)outgoing.setHeader('Set-Cookie',cookies)
        outgoing.end(Buffer.from(await response.arrayBuffer()))
      } catch {if(!outgoing.headersSent)outgoing.writeHead(503,headers);outgoing.end()}
    })
    server.maxConnections=16;server.keepAliveTimeout=5000
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(PILOT_PORT,'0.0.0.0',()=>{server.off('error',reject);resolve()})})
    return {async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end()}}
  } catch {await pool.end();throw new Error('Isolated pilot startup refused')}
}
