import { randomUUID } from 'node:crypto'
import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
const state=vi.hoisted(()=>({ data:vi.fn(),source:vi.fn(),bearer:vi.fn(),database:{ run:vi.fn() } }))
vi.mock('@/lib/mcp/data/tools',()=>({ nativeMcpDataTool:state.data,mcpTenant:vi.fn() }))
vi.mock('@/lib/observability',()=>({ captureSecurityEvent:vi.fn() }))
vi.mock('@/lib/menu/public-menu-cache',()=>({ revalidateAllPublicMenus:vi.fn() }))
vi.mock('@/lib/supabase/server',()=>({ createClient:state.source,createServiceClient:state.source }))
vi.mock('@/lib/billing/subscription-provider',()=>({ subscriptionGateway:{} }))
vi.mock('@/lib/mcp/runtime',async importOriginal=>({ ...await importOriginal<typeof import('@/lib/mcp/runtime')>(),nativeMcpConfiguration:()=>({ issuer:'https://fixture.invalid' }),nativeMcpDatabase:()=>state.database,nativeMcpBearer:state.bearer }))
import { registerNativeMcpTools } from '@/lib/mcp/native-tools'
import { McpCapabilityIssuer,currentMcpIdentity } from '@/lib/mcp/data/authority'
import { verifyMcpToken } from '@/lib/mcp/verify-token'
import { opaque } from '@/lib/mcp/oauth-model'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
let auth:AuthInfo
const token=`xm_mcp_at_${opaque()}`
beforeEach(async()=>{
  vi.stubEnv('OWNED_MCP_ENABLED','true')
  const userId=randomUUID(),identity={ userId,grantId:randomUUID(),clientId:'xm_mcp_client_'+'a'.repeat(32),resource:'https://fixture.invalid/api/mcp',projectId:'fixture-project',subject:'verified-subject',authenticatedAt:Math.floor(Date.now()/1000)-60,expiresAt:Math.floor(Date.now()/1000)+900,role:'superadmin' as const,scopes:['mcp:admin'],clientOrigins:['https://client.invalid'] }
  const actor=await new McpCapabilityIssuer(async()=>identity,async()=>({ disabled:false,validSince:0 })).issue('a'.repeat(64))
  state.bearer.mockResolvedValue(actor); state.data.mockResolvedValue({ native:true,actor:userId })
  state.database.run.mockImplementation(async(_write,operation)=>operation(async()=>({ rows:[] })))
  auth={ token,clientId:identity.clientId,scopes:identity.scopes,expiresAt:identity.expiresAt,extra:{ userId,nativeMcpActor:actor } }
})
afterEach(()=>{ vi.unstubAllEnvs(); vi.clearAllMocks() })
async function rpc(message:unknown,authorization:AuthInfo|null=auth) {
  const server=new McpServer({ name:'native-mcp-contract',version:'1.0.0' }),transport=new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator:undefined })
  registerNativeMcpTools(server); await server.connect(transport)
  try {
    const response=await transport.handleRequest(new Request('https://fixture.invalid/api/mcp',{ method:'POST',headers:{ 'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25' },body:JSON.stringify(message) }),{ authInfo:authorization ?? undefined })
    const raw=await response.text(),data=raw.trim().startsWith('{') ? JSON.parse(raw) : JSON.parse(raw.split('\n').filter(line=>line.startsWith('data: ') && line.slice(6).trim()).at(-1)!.slice(6))
    return { response,data }
  } finally { await server.close() }
}
it('actual SDK lists all 50 native schemas with the refreshed identity contracts',async()=>{
  const { response,data }=await rpc({ jsonrpc:'2.0',id:1,method:'tools/list',params:{} })
  expect(response.status).toBe(200); expect(data.result.tools).toHaveLength(50)
  expect(data.result.tools.find((tool:{name:string})=>tool.name==='create_tenant').inputSchema.properties.owner_user_id).toBeDefined()
  expect(state.source).not.toHaveBeenCalled()
})
it('actual SDK preserves the server-only capability through AuthInfo to the native tool callback',async()=>{
  const { data }=await rpc({ jsonrpc:'2.0',id:2,method:'tools/call',params:{ name:'get_platform_settings',arguments:{} } })
  expect(data.result.isError).not.toBe(true); expect(JSON.parse(data.result.content[0].text).native).toBe(true)
  expect(state.data).toHaveBeenCalledTimes(1); expect(state.source).not.toHaveBeenCalled()
})
it('client metadata cannot synthesize transport AuthInfo or a server-issued proof',async()=>{
  const { data }=await rpc({ jsonrpc:'2.0',id:3,method:'tools/call',params:{ name:'get_platform_settings',arguments:{},_meta:{ authInfo:auth } } },null)
  expect(data.result.isError).toBe(true); expect(state.data).not.toHaveBeenCalled()
})
it('resource verification rejects Source/refresh tokens, malformed bearer headers and foreign client Origin without fallback',async()=>{
  const request=new Request('https://fixture.invalid/api/mcp',{ headers:{ authorization:`Bearer ${token}`,origin:'https://client.invalid' } })
  const result=await verifyMcpToken(request,token); expect(result?.clientId).toBe(auth.clientId)
  expect(currentMcpIdentity(result?.extra?.nativeMcpActor ? (result.extra.nativeMcpActor as { oauth:Parameters<typeof currentMcpIdentity>[0] }).oauth : undefined! ).userId).toBe(auth.extra?.userId)
  request.headers.set('origin','https://foreign.invalid'); expect(await verifyMcpToken(request,token)).toBeUndefined()
  request.headers.delete('origin'); request.headers.set('authorization',`Bearer ${token} ignored`); expect(await verifyMcpToken(request,token)).toBeUndefined()
  expect(await verifyMcpToken(new Request('https://fixture.invalid/api/mcp',{ headers:{ authorization:'Bearer eyJ.source.jwt' } }),'eyJ.source.jwt')).toBeUndefined()
  expect(state.source).not.toHaveBeenCalled()
})
