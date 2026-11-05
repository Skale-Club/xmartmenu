import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { mcpTransport } from '@/lib/mcp/transport'
import { markInvalidMcpOrigin } from '@/lib/mcp/request-state'
const origin='https://fixture.invalid'
const post=(body:string)=>new Request(`${origin}/api/mcp`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body })
beforeEach(()=>{ vi.stubEnv('OWNED_MCP_ENABLED','true'); vi.stubEnv('MCP_PUBLIC_ORIGIN',origin); vi.stubEnv('NODE_ENV','test') })
afterEach(()=>{ vi.unstubAllEnvs(); vi.useRealTimers() })
it('bounds JSON-RPC before calling authentication/SDK/provider code',async()=>{
  const handler=vi.fn(async()=>Response.json({ ok:true }))
  expect((await mcpTransport(post('x'.repeat(65537)),handler)).status).toBe(413)
  const bad=post('{}'); bad.headers.set('host','attacker.invalid'); expect((await mcpTransport(bad,handler)).status).toBe(403)
  const wrong=post('{}'); wrong.headers.set('Content-Type','text/plain'); expect((await mcpTransport(wrong,handler)).status).toBe(415)
  expect(handler).not.toHaveBeenCalled()
})
it('retains bearer/protocol headers and returns 403 for an invalid registered-client Origin',async()=>{
  const value=post('{}'); value.headers.set('authorization','Bearer fixture'); value.headers.set('mcp-protocol-version','2025-11-25')
  const handler=vi.fn(async(request:Request)=>{ expect(await request.text()).toBe('{}'); expect(request.headers.get('authorization')).toBe('Bearer fixture'); markInvalidMcpOrigin(request); return Response.json({ error:'invalid_token' },{ status:401 }) })
  expect((await mcpTransport(value,handler)).status).toBe(403)
})
it('valid native requests and preflight do not change the SDK result and disabled mode remains explicit',async()=>{
  const handler=vi.fn(async()=>Response.json({ result:true }))
  const result=await mcpTransport(post('{}'),handler); expect(result.status).toBe(200); expect(await result.json()).toEqual({ result:true })
  expect((await mcpTransport(new Request(`${origin}/api/mcp`,{ method:'OPTIONS' }),handler)).status).toBe(204)
  vi.stubEnv('OWNED_MCP_ENABLED','false'); const legacy=post('legacy body'); expect((await mcpTransport(legacy,handler)).status).toBe(200); expect(handler).toHaveBeenLastCalledWith(legacy)
})
