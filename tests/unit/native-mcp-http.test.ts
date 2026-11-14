import { beforeEach,afterEach,expect,it,vi } from 'vitest'
const state=vi.hoisted(()=>({ store:vi.fn(),browser:vi.fn(),register:vi.fn(),authorize:vi.fn(),details:vi.fn(),decide:vi.fn(),token:vi.fn(),revoke:vi.fn(),rate:vi.fn() }))
vi.mock('@/lib/mcp/runtime',()=>({ nativeMcpOAuthStore:state.store,nativeMcpBrowserActor:state.browser }))
vi.mock('@/lib/rate-limit',()=>({ rateLimit:state.rate,getClientIp:()=> 'fixture-ip' }))
vi.mock('mcp-handler',()=>({ protectedResourceHandler:()=>()=>Response.json({ legacy:true }),metadataCorsOptionsRequestHandler:()=>()=>new Response(null,{ status:204 }) }))
import { nativeOAuthHttp,mcpBody } from '@/lib/mcp/oauth-http'
import { McpOAuthError } from '@/lib/mcp/oauth-model'
import { GET as metadata } from '@/app/.well-known/oauth-authorization-server/route'
import { GET as resourceMetadata } from '@/app/.well-known/oauth-protected-resource/route'

const origin='https://fixture.invalid'
const request=(path:string,body:unknown,json=true)=>new Request(`${origin}/oauth/${path}`,{ method:'POST',headers:{ origin,'Content-Type':json ? 'application/json' : 'application/x-www-form-urlencoded' },body:json ? JSON.stringify(body) : String(body) })
beforeEach(()=>{
  vi.stubEnv('OWNED_MCP_ENABLED','true'); vi.stubEnv('MCP_PUBLIC_ORIGIN',origin); vi.stubEnv('NODE_ENV','test')
  state.rate.mockResolvedValue({ ok:true }); state.store.mockReturnValue({ register:state.register,authorize:state.authorize,details:state.details,decide:state.decide,token:state.token,revoke:state.revoke }); state.browser.mockResolvedValue({ actorId:'server-derived',sessionHash:'server-derived' })
  state.register.mockResolvedValue({ client_id:'registered' }); state.decide.mockResolvedValue('https://client.invalid/callback?code=one-use'); state.token.mockResolvedValue({ access_token:'not-a-real-token' })
})
afterEach(()=>{ vi.unstubAllEnvs(); vi.clearAllMocks(); vi.useRealTimers() })
it('advertises only real native issuer/resource/PKCE capabilities and leaves the disabled AS unavailable',async()=>{
  const server=await metadata().json(),resource=await(await resourceMetadata(new Request(`${origin}/.well-known/oauth-protected-resource`))).json()
  expect(server.issuer).toBe(origin); expect(server.code_challenge_methods_supported).toEqual(['S256']); expect(server.client_id_metadata_document_supported).toBe(false)
  expect(resource.resource).toBe(`${origin}/api/mcp`); expect(resource.authorization_servers).toEqual([origin]); expect(resource.scopes_supported).toEqual(['mcp:admin'])
  vi.stubEnv('OWNED_MCP_ENABLED','false'); expect(metadata().status).toBe(503)
})
it('cross-site consent refuses before browser authority, SQL or provider work',async()=>{
  const value=request('decision',{ authorization_id:'request',approve:true }); value.headers.set('origin','https://foreign.invalid')
  expect((await nativeOAuthHttp('decision',value)).status).toBe(403)
  expect(state.store).not.toHaveBeenCalled(); expect(state.browser).not.toHaveBeenCalled(); expect(state.decide).not.toHaveBeenCalled()
})
it('consent accepts only its native cookie actor, never body authority fields',async()=>{
  expect((await nativeOAuthHttp('decision',request('decision',{ authorization_id:'request',approve:true }))).status).toBe(200)
  expect(state.decide).toHaveBeenCalledWith('request',{ actorId:'server-derived',sessionHash:'server-derived' },true)
  expect((await nativeOAuthHttp('decision',request('decision',{ authorization_id:'request',approve:true,actorId:'forged' }))).status).toBe(400)
  expect(state.decide).toHaveBeenCalledTimes(1)
})
it('bounded JSON/form parsing denies large, malformed or wrong content-type requests before effects',async()=>{
  expect((await nativeOAuthHttp('register',request('register',{ client_name:'x'.repeat(16385) }))).status).toBe(413)
  const wrong=request('token','grant_type=authorization_code',false); wrong.headers.set('Content-Type','text/plain')
  expect((await nativeOAuthHttp('token',wrong)).status).toBe(400)
  expect(state.register).not.toHaveBeenCalled(); expect(state.token).not.toHaveBeenCalled()
})
it('client authentication and rate-limit errors use OAuth status/challenge without leaking errors',async()=>{
  state.token.mockRejectedValue(new McpOAuthError(401,'invalid_client','Invalid client authentication'))
  const response=await nativeOAuthHttp('token',request('token','grant_type=authorization_code',false))
  expect(response.status).toBe(401); expect(response.headers.get('www-authenticate')).toBe('Basic realm="xprout-mcp"'); expect(response.headers.get('cache-control')).toBe('no-store')
  state.rate.mockResolvedValue({ ok:false }); const limited=await nativeOAuthHttp('register',request('register',{})); expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('60')
})
it('the request reader has a five-second deadline without a database/provider call',async()=>{
  vi.useFakeTimers(); const value=request('register',{}),body=new ReadableStream({ pull:()=>new Promise(()=>{}) })
  Object.defineProperty(value,'body',{ value:body }); const pending=expect(mcpBody(value,true)).rejects.toMatchObject({ status:400,code:'invalid_request' })
  await vi.advanceTimersByTimeAsync(5001); await pending; expect(state.register).not.toHaveBeenCalled()
})
