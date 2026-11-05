import { NextResponse } from 'next/server'
import { mcpOrigin, nativeMcpSelected } from '@/lib/mcp/oauth-model'
import { oauthOptions } from '@/lib/mcp/oauth-http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export function GET() {
  if (!nativeMcpSelected()) return NextResponse.json({ error:'temporarily_unavailable' },{ status:503,headers:{ 'Cache-Control':'no-store' } })
  try { const { issuer }=mcpOrigin(); return NextResponse.json({ issuer,authorization_endpoint:`${issuer}/oauth/authorize`,token_endpoint:`${issuer}/oauth/token`,
    registration_endpoint:`${issuer}/oauth/register`,revocation_endpoint:`${issuer}/oauth/revoke`,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
    scopes_supported:['mcp:admin'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none','client_secret_basic','client_secret_post'],
    revocation_endpoint_auth_methods_supported:['none','client_secret_basic','client_secret_post'],authorization_response_iss_parameter_supported:true,client_id_metadata_document_supported:false,
  },{ headers:{ 'Cache-Control':'no-store','Access-Control-Allow-Origin':'*' } }) }
  catch { return NextResponse.json({ error:'temporarily_unavailable' },{ status:503,headers:{ 'Cache-Control':'no-store' } }) }
}
export const OPTIONS=oauthOptions
