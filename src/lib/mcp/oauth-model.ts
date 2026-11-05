import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export class McpOAuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
export const oauthHash = (value: string) => createHash('sha256').update(value).digest('hex')
export const opaque = () => randomBytes(32).toString('base64url')
export const MCP_SCOPE = 'mcp:admin'
export const nativeMcpSelected = (env: Record<string,string|undefined> = process.env) => {
  if (env.OWNED_MCP_ENABLED !== undefined && !['true','false'].includes(env.OWNED_MCP_ENABLED)) throw new McpOAuthError(503,'temporarily_unavailable','Invalid MCP mode')
  return env.OWNED_MCP_ENABLED === 'true'
}
export function mcpOrigin(env: Record<string,string|undefined> = process.env) {
  let url: URL
  try { url = new URL(env.MCP_PUBLIC_ORIGIN || env.IDENTITY_ORIGIN || '') } catch { throw new McpOAuthError(503,'temporarily_unavailable','Explicit MCP origin required') }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production'
    && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new McpOAuthError(503,'temporarily_unavailable','Invalid MCP origin')
  return { issuer:url.origin,resource:`${url.origin}/api/mcp` }
}
export function invalid(code = 'invalid_request',message = 'Invalid OAuth request',status = 400): never { throw new McpOAuthError(status,code,message) }
export const object = (value: unknown): Record<string,unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : invalid()
export const equalSecret = (left: string,right: string) => {
  const a=Buffer.from(oauthHash(left),'hex'),b=Buffer.from(right.match(/^[a-f0-9]{64}$/) ? right : '0'.repeat(64),'hex')
  return timingSafeEqual(a,b)
}
export type ClientAuthentication = 'none'|'client_secret_basic'|'client_secret_post'
export function redirectUri(input: unknown): string {
  if (typeof input !== 'string' || input.length>2048) invalid('invalid_client_metadata','Invalid redirect URI')
  let url: URL
  try { url = new URL(input) } catch { return invalid('invalid_client_metadata','Invalid redirect URI') }
  if (url.username || url.password || url.hash || (url.protocol!=='https:' && !(url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) invalid('invalid_client_metadata','HTTPS or exact loopback redirect required')
  return input
}
export function registration(input: unknown) {
  const value=object(input),names=['client_name','redirect_uris','grant_types','response_types','token_endpoint_auth_method','scope','client_uri','logo_uri']
  if (Object.keys(value).some(key=>!names.includes(key))) invalid('invalid_client_metadata','Unsupported client metadata')
  if (typeof value.client_name!=='string' || !value.client_name.trim() || value.client_name.length>200) invalid('invalid_client_metadata','Client name required')
  if (!Array.isArray(value.redirect_uris) || !value.redirect_uris.length || value.redirect_uris.length>10) invalid('invalid_redirect_uri','Registered redirects required')
  const redirects=[...new Set(value.redirect_uris.map(redirectUri))]
  const method=value.token_endpoint_auth_method ?? 'client_secret_basic'
  if (!['none','client_secret_basic','client_secret_post'].includes(String(method))) invalid('invalid_client_metadata','Unsupported client authentication')
  const grants=value.grant_types ?? ['authorization_code','refresh_token'],responses=value.response_types ?? ['code']
  if (!Array.isArray(grants) || !grants.includes('authorization_code') || grants.some(x=>!['authorization_code','refresh_token'].includes(x))
    || !Array.isArray(responses) || responses.length!==1 || responses[0]!=='code' || (value.scope!==undefined && value.scope!==MCP_SCOPE)) invalid('invalid_client_metadata','Unsupported grant, response or scope')
  for (const key of ['client_uri','logo_uri']) if (value[key]!==undefined) redirectUri(value[key]) // never fetch metadata URLs
  return { name:value.client_name.trim(),redirects,method:method as ClientAuthentication, grants:[...new Set(grants as string[])] }
}
export function authorizeParameters(params: URLSearchParams,resource: string) {
  const allowed=['response_type','client_id','redirect_uri','scope','state','code_challenge','code_challenge_method','resource']
  if ([...params.keys()].some(key=>!allowed.includes(key) || params.getAll(key).length!==1)) invalid()
  const clientId=params.get('client_id'),redirect=params.get('redirect_uri'),state=params.get('state'),challenge=params.get('code_challenge')
  if (params.get('response_type')!=='code' || !clientId || !/^xm_mcp_client_[a-f0-9]{32}$/.test(clientId)
    || !redirect || !state || state.length>2048 || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)
    || params.get('code_challenge_method')!=='S256' || params.get('resource')!==resource || params.get('scope')!==MCP_SCOPE) invalid()
  return { clientId,redirect:redirectUri(redirect),state,challenge,resource }
}
export function checkPkce(verifier: unknown,challenge: unknown) {
  if (typeof verifier!=='string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || typeof challenge!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) invalid('invalid_grant','Invalid authorization proof')
  const actual=createHash('sha256').update(verifier).digest('base64url')
  if (!timingSafeEqual(Buffer.from(actual),Buffer.from(challenge))) invalid('invalid_grant','Invalid authorization proof')
}
export function credential(input: unknown,kind: 'access'|'refresh'|'code'|'request') {
  const prefix=kind==='access' ? 'xm_mcp_at_' : kind==='refresh' ? 'xm_mcp_rt_' : ''
  if (typeof input!=='string' || !new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`).test(input)) invalid('invalid_grant','Invalid OAuth credential')
  return oauthHash(input)
}
