import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from 'mcp-handler'
import { NextResponse } from 'next/server'
import { mcpOrigin, nativeMcpSelected } from '@/lib/mcp/oauth-model'

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP server.
 *
 * Points MCP clients (Claude / Codex) at Supabase Auth as the authorization
 * server. The client then does RFC 8414 discovery on that issuer, dynamic client
 * registration, PKCE, and gets an access token it sends to /api/mcp.
 *
 * Authorization server issuer = `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1`.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') ?? ''
const authServerUrl = `${supabaseUrl}/auth/v1`

const publicOrigin = process.env.MCP_PUBLIC_ORIGIN?.replace(/\/$/, '') || undefined

const handler = protectedResourceHandler({
  authServerUrls: [authServerUrl],
  ...(publicOrigin ? { resourceUrl: publicOrigin } : {}),
})

const corsHandler = metadataCorsOptionsRequestHandler()

export function GET(request: Request) {
  if (nativeMcpSelected()) {
    try { const { issuer,resource }=mcpOrigin(); return NextResponse.json({ resource,authorization_servers:[issuer],scopes_supported:['mcp:admin'],bearer_methods_supported:['header'] },{ headers:{ 'Cache-Control':'no-store','Access-Control-Allow-Origin':'*' } }) }
    catch { return NextResponse.json({ error:'temporarily_unavailable' },{ status:503,headers:{ 'Cache-Control':'no-store' } }) }
  }
  return handler(request)
}
export { corsHandler as OPTIONS }
