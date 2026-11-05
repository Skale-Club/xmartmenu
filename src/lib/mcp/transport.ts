import { mcpOrigin,nativeMcpSelected } from './oauth-model'
import { invalidMcpOrigin } from './request-state'

/** Bound native JSON-RPC before SDK parsing/provider work. Legacy transport is
 * explicit while disabled. Public Host is checked without trusting forwarded
 * URL construction; TLS is terminated by the configured application proxy. */
export async function mcpTransport(request:Request,handler:(request:Request)=>Promise<Response>) {
  if(!nativeMcpSelected()) return handler(request)
  const headers={ 'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'WWW-Authenticate, MCP-Session-Id, MCP-Protocol-Version' }
  try {
    const { issuer }=mcpOrigin()
    if((request.headers.get('host') ?? new URL(request.url).host)!==new URL(issuer).host) return Response.json({ error:'Invalid MCP host' },{ status:403,headers })
    const origin=request.headers.get('origin')
    if(origin) {
      let parsed:URL
      try { parsed=new URL(origin) } catch { return Response.json({ error:'Invalid MCP origin' },{ status:403,headers }) }
      if(parsed.origin!==origin || parsed.username || parsed.password || (parsed.protocol!=='https:' && !(parsed.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)))) return Response.json({ error:'Invalid MCP origin' },{ status:403,headers })
    }
    if(request.method==='OPTIONS') return new Response(null,{ status:204,headers:{ ...headers,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID' } })
    let current=request
    if(request.method==='POST') {
      if(request.headers.get('content-type')?.split(';')[0]!=='application/json') return Response.json({ error:'JSON request required' },{ status:415,headers })
      if(Number(request.headers.get('content-length') ?? 0)>65536) return Response.json({ error:'MCP request is too large' },{ status:413,headers })
      const reader=request.body?.getReader(); if(!reader) return Response.json({ error:'Invalid MCP request' },{ status:400,headers })
      const decoder=new TextDecoder(); let text='',size=0,timer:ReturnType<typeof setTimeout>|undefined
      const deadline=new Promise<never>((_,reject)=>{ timer=setTimeout(()=>{ reject(new Error('MCP request timed out')); void reader.cancel().catch(()=>{}) },5000) })
      try { for(;;) { const part=await Promise.race([reader.read(),deadline]); if(part.done) break; size+=part.value.byteLength
        if(size>65536) return Response.json({ error:'MCP request is too large' },{ status:413,headers }); text+=decoder.decode(part.value,{ stream:true }) }
        text+=decoder.decode()
      } finally { clearTimeout(timer); reader.releaseLock() }
      current=new Request(request.url,{ method:request.method,headers:request.headers,body:text,signal:request.signal })
    }
    const response=await handler(current)
    if(invalidMcpOrigin(current)) return Response.json({ error:'Invalid MCP origin' },{ status:403,headers })
    const out=new Headers(response.headers)
    for(const [key,value] of Object.entries(headers)) out.set(key,value)
    return new Response(response.body,{ status:response.status,statusText:response.statusText,headers:out })
  } catch { return Response.json({ error:'MCP service is unavailable' },{ status:503,headers }) }
}
