import { randomUUID } from 'node:crypto'
import type { AdminMenuQuery } from '../../data/admin-menus'
import type { ProviderAccountStatusReader } from '../../auth/provider-account-status'
import { McpCapabilityIssuer, currentMcpIdentity, readMcpGrant, type McpOAuthCapability } from './authority'
import { authorizeParameters, checkPkce, credential, equalSecret, invalid, MCP_SCOPE, oauthHash, opaque, registration } from '../oauth-model'

type Row = Record<string,unknown>
export interface McpDatabase { run<T>(write: boolean, operation: (query: AdminMenuQuery) => Promise<T>): Promise<T> }
export interface McpBrowserActor { actorId:string; sessionHash:string }
const single = (rows:Row[]) => rows.length===1 ? rows[0] : invalid('invalid_grant','OAuth authorization is unavailable')
const serial = (query:AdminMenuQuery) => query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-account-authority',0))")
async function browser(query:AdminMenuQuery,actor:McpBrowserActor,lock=false) {
  if (!/^[a-f0-9-]{36}$/i.test(actor.actorId) || !/^[a-f0-9]{64}$/.test(actor.sessionHash)) invalid('access_denied','Native administrator sign-in required',403)
  if (lock) await serial(query)
  const rows=(await query(`SELECT p.id,p.full_name,a.session_version,s.project_id,s.subject,s.authenticated_at
    FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id JOIN public.app_sessions s ON s.user_id=a.id
    JOIN public.app_identity_bindings b ON b.user_id=a.id AND b.project_id=s.project_id AND b.subject=s.subject
    WHERE p.id=$1 AND s.token_hash=$2 AND s.expires_at>now() AND s.session_version=a.session_version
      AND a.disabled_at IS NULL AND b.disabled_at IS NULL AND NOT coalesce(p.must_change_password,false)
      AND p.role IN ('superadmin','super-admin') ${lock ? 'FOR SHARE OF p,a,s,b' : ''}`, [actor.actorId,actor.sessionHash])).rows
  if (rows.length!==1) invalid('access_denied','Current native administrator sign-in required',403)
  return rows[0]
}
type ClientRequest = { fields:URLSearchParams; authorization:string|null }
async function client(query:AdminMenuQuery,input:ClientRequest) {
  let clientId=input.fields.get('client_id'),secret=input.fields.get('client_secret'),method='client_secret_post'
  if (input.authorization) {
    if (!input.authorization.startsWith('Basic ') || input.authorization.length>2048 || secret!==null) invalid('invalid_client','Invalid client authentication',401)
    let decoded:string
    try { decoded=Buffer.from(input.authorization.slice(6),'base64').toString('utf8') } catch { return invalid('invalid_client','Invalid client authentication',401) }
    const split=decoded.indexOf(':'); if (split<0) invalid('invalid_client','Invalid client authentication',401)
    try { const id=decodeURIComponent(decoded.slice(0,split)); secret=decodeURIComponent(decoded.slice(split+1)); if (clientId && clientId!==id) invalid('invalid_client','Invalid client authentication',401); clientId=id }
    catch { return invalid('invalid_client','Invalid client authentication',401) }
    method='client_secret_basic'
  }
  if (!clientId || !/^xm_mcp_client_[a-f0-9]{32}$/.test(clientId)) invalid('invalid_client','Invalid client authentication',401)
  const rows=(await query('SELECT * FROM public.app_mcp_clients WHERE id=$1 AND disabled_at IS NULL',[clientId])).rows,row=rows[0]
  if (rows.length!==1 || !row) invalid('invalid_client','Invalid client authentication',401)
  if (row.auth_method==='none') { if (secret!==null || input.authorization) invalid('invalid_client','Unexpected client secret',401) }
  else if (row.auth_method!==method || !secret || typeof row.secret_hash!=='string' || !equalSecret(secret,row.secret_hash)) invalid('invalid_client','Invalid client authentication',401)
  return row
}
function callback(request:Row,issuer:string,values:Record<string,string>) {
  const url=new URL(String(request.redirect_uri)); for (const [key,value] of Object.entries({ ...values,state:String(request.state),iss:issuer })) url.searchParams.set(key,value)
  return url.href
}
function sameProof(capability:McpOAuthCapability,current:Awaited<ReturnType<typeof readMcpGrant>>) {
  const proof=currentMcpIdentity(capability)
  if (proof.userId!==current.userId || proof.grantId!==current.grantId || proof.clientId!==current.clientId || proof.resource!==current.resource
    || proof.projectId!==current.projectId || proof.subject!==current.subject || proof.authenticatedAt!==current.authenticatedAt) invalid('invalid_grant','Account authority changed')
}
export class NativeMcpOAuthStore {
  constructor(private readonly database:McpDatabase,private readonly provider:ProviderAccountStatusReader,readonly issuer:string,readonly resource:string) {}
  async register(input:unknown) {
    const value=registration(input),id=`xm_mcp_client_${randomUUID().replaceAll('-','')}`,secret=value.method==='none' ? null : opaque()
    await this.database.run(true,async query=>{
      await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-mcp-registration',0))")
      const count=(await query("SELECT count(*)::int AS count FROM (SELECT id FROM public.app_mcp_clients WHERE created_at>now()-interval '1 day' LIMIT 1000) bounded")).rows[0]
      if (!count || Number(count.count)>=1000) invalid('temporarily_unavailable','Daily client registration limit reached',429)
      await query('INSERT INTO public.app_mcp_clients(id,name,redirect_uris,auth_method,grant_types,secret_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,value.name,value.redirects,value.method,value.grants,secret ? oauthHash(secret) : null])
    })
    return { client_id:id,client_name:value.name,redirect_uris:value.redirects,token_endpoint_auth_method:value.method,grant_types:value.grants,response_types:['code'],scope:MCP_SCOPE,
      client_id_issued_at:Math.floor(Date.now()/1000),...(secret ? { client_secret:secret,client_secret_expires_at:0 } : {}) }
  }
  async authorize(params:URLSearchParams) {
    const value=authorizeParameters(params,this.resource),id=opaque()
    await this.database.run(true,async query=>{
      await query("SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-mcp-registration',0))")
      const row=single((await query('SELECT * FROM public.app_mcp_clients WHERE id=$1 AND disabled_at IS NULL FOR SHARE',[value.clientId])).rows)
      if (!Array.isArray(row.redirect_uris) || !row.redirect_uris.includes(value.redirect)) invalid('invalid_request','Redirect URI is not registered')
      const count=(await query("SELECT count(*)::int AS count FROM (SELECT request_hash FROM public.app_mcp_authorizations WHERE created_at>now()-interval '1 day' LIMIT 10000) bounded")).rows[0]
      if (!count || Number(count.count)>=10000) invalid('temporarily_unavailable','Daily authorization request limit reached',429)
      await query("INSERT INTO public.app_mcp_authorizations(request_hash,client_id,redirect_uri,resource,scopes,state,challenge,expires_at) VALUES($1,$2,$3,$4,ARRAY['mcp:admin'],$5,$6,now()+interval '10 minutes')",[oauthHash(id),value.clientId,value.redirect,value.resource,value.state,value.challenge])
    })
    return `${this.issuer}/oauth/consent?authorization_id=${encodeURIComponent(id)}`
  }
  async details(requestId:string,actor:McpBrowserActor) {
    const hash=credential(requestId,'request')
    return this.database.run(false,async query=>{
      const user=await browser(query,actor),row=single((await query(`SELECT a.*,c.name AS client_name FROM public.app_mcp_authorizations a JOIN public.app_mcp_clients c ON c.id=a.client_id
        WHERE a.request_hash=$1 AND a.resource=$2 AND a.redirect_uri=ANY(c.redirect_uris) AND a.status='pending' AND a.expires_at>now() AND c.disabled_at IS NULL`,[hash,this.resource])).rows)
      return { authorization_id:requestId,client:{ id:row.client_id,name:row.client_name },redirect_uri:row.redirect_uri,scope:MCP_SCOPE,user:{ id:user.id,full_name:user.full_name ?? null } }
    })
  }
  async decide(requestId:string,actor:McpBrowserActor,approve:boolean) {
    const hash=credential(requestId,'request'),code=opaque()
    return this.database.run(true,async query=>{
      const user=await browser(query,actor,true),row=single((await query(`SELECT a.* FROM public.app_mcp_authorizations a JOIN public.app_mcp_clients c ON c.id=a.client_id
        WHERE a.request_hash=$1 AND a.resource=$2 AND a.redirect_uri=ANY(c.redirect_uris) AND a.status='pending' AND a.expires_at>now() AND c.disabled_at IS NULL FOR UPDATE OF a`,[hash,this.resource])).rows)
      if (!approve) { await query("UPDATE public.app_mcp_authorizations SET status='denied' WHERE request_hash=$1",[hash]); return callback(row,this.issuer,{ error:'access_denied' }) }
      const grantId=randomUUID()
      await query(`INSERT INTO public.app_mcp_grants(id,user_id,client_id,session_version,project_id,subject,authenticated_at,resource,scopes,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,ARRAY['mcp:admin'],now()+interval '30 days')`,[grantId,user.id,row.client_id,user.session_version,user.project_id,user.subject,user.authenticated_at,this.resource])
      await query("UPDATE public.app_mcp_authorizations SET status='approved',grant_id=$2,code_hash=$3,code_expires_at=now()+interval '2 minutes' WHERE request_hash=$1",[hash,grantId,oauthHash(code)])
      return callback(row,this.issuer,{ code })
    })
  }
  private async candidate(query:AdminMenuQuery,input:ClientRequest) {
    const registered=await client(query,input),type=input.fields.get('grant_type')
    if (input.fields.get('resource')!==this.resource) invalid('invalid_target','Invalid resource')
    if (input.fields.has('scope') && input.fields.get('scope')!==MCP_SCOPE) invalid('invalid_scope','Invalid scope')
    let row:Row
    if (type==='authorization_code') {
      const hash=credential(input.fields.get('code'),'code')
      row=single((await query("SELECT * FROM public.app_mcp_authorizations WHERE code_hash=$1 AND client_id=$2 AND status='approved' AND code_expires_at>now()",[hash,registered.id])).rows)
      if (row.redirect_uri!==input.fields.get('redirect_uri') || row.resource!==this.resource || !Array.isArray(registered.redirect_uris) || !registered.redirect_uris.includes(row.redirect_uri)) invalid('invalid_grant','Invalid authorization binding')
      checkPkce(input.fields.get('code_verifier'),row.challenge)
    } else if (type==='refresh_token') {
      if (!Array.isArray(registered.grant_types) || !registered.grant_types.includes('refresh_token')) invalid('unauthorized_client','Refresh grant is not registered')
      const hash=credential(input.fields.get('refresh_token'),'refresh')
      row=single((await query("SELECT t.* FROM public.app_mcp_tokens t JOIN public.app_mcp_grants g ON g.id=t.grant_id WHERE t.token_hash=$1 AND t.kind='refresh' AND t.expires_at>now() AND g.client_id=$2 AND g.resource=$3",[hash,registered.id,this.resource])).rows)
    } else return invalid('unsupported_grant_type','Unsupported OAuth grant')
    return { registered,row,type }
  }
  async token(fields:URLSearchParams,authorization:string|null) {
    const allowed=['grant_type','code','redirect_uri','code_verifier','resource','scope','refresh_token','client_id','client_secret']
    if ([...fields.keys()].some(key=>!allowed.includes(key) || fields.getAll(key).length!==1)) invalid()
    const input={ fields,authorization },first=await this.database.run(false,query=>this.candidate(query,input))
    if (first.type==='refresh_token' && first.row.consumed_at!==null) {
      await this.database.run(true,async query=>{ await serial(query); const current=await this.candidate(query,input)
        if (current.row.consumed_at!==null) await query('UPDATE public.app_mcp_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',[current.row.grant_id]) })
      return invalid('invalid_grant','Refresh token reuse revoked this authorization')
    }
    const issuer=new McpCapabilityIssuer(async()=>this.database.run(false,async query=>{
      const current=await this.candidate(query,input)
      return readMcpGrant(query,String(current.row.grant_id),this.resource)
    }),this.provider)
    let proof:Awaited<ReturnType<McpCapabilityIssuer['issue']>>
    try { proof=await issuer.issue(String(first.row.code_hash ?? first.row.token_hash)) } catch { return invalid('invalid_grant','Current account authorization required') }
    const result=await this.database.run(true,async query=>{
      await serial(query)
      const current=await this.candidate(query,input),grant=await readMcpGrant(query,String(current.row.grant_id),this.resource,true)
      sameProof(proof.oauth,grant)
      if (current.type==='authorization_code') {
        const consumed=await query("UPDATE public.app_mcp_authorizations SET status='used',used_at=now() WHERE request_hash=$1 AND status='approved' RETURNING request_hash",[current.row.request_hash])
        if (consumed.rows.length!==1) return { error:true as const }
      } else {
        const consumed=await query('UPDATE public.app_mcp_tokens SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL RETURNING token_hash',[current.row.token_hash])
        if (consumed.rows.length!==1) { await query('UPDATE public.app_mcp_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',[grant.grantId]); return { error:true as const } }
      }
      const access=`xm_mcp_at_${opaque()}`,refresh=`xm_mcp_rt_${opaque()}`
      await query("INSERT INTO public.app_mcp_tokens(token_hash,grant_id,kind,expires_at) VALUES($1,$2,'access',LEAST(now()+interval '15 minutes',$3::timestamptz))",[oauthHash(access),grant.grantId,new Date(grant.expiresAt*1000)])
      const canRefresh=Array.isArray(current.registered.grant_types) && current.registered.grant_types.includes('refresh_token')
      if (canRefresh) await query("INSERT INTO public.app_mcp_tokens(token_hash,grant_id,kind,parent_hash,expires_at) VALUES($1,$2,'refresh',$3,$4)",[oauthHash(refresh),grant.grantId,current.type==='refresh_token' ? current.row.token_hash : null,new Date(grant.expiresAt*1000)])
      return { error:false as const,body:{ access_token:access,token_type:'Bearer',expires_in:Math.min(900,grant.expiresAt-Math.floor(Date.now()/1000)),scope:MCP_SCOPE,...(canRefresh ? { refresh_token:refresh } : {}) } }
    })
    if (result.error) invalid('invalid_grant','OAuth credential was already used')
    return result.body
  }
  async revoke(fields:URLSearchParams,authorization:string|null) {
    const allowed=['token','token_type_hint','client_id','client_secret']
    if ([...fields.keys()].some(key=>!allowed.includes(key) || fields.getAll(key).length!==1)) invalid()
    const value=fields.get('token')
    if (!value || value.length>256) invalid()
    await this.database.run(true,async query=>{
      await serial(query); const registered=await client(query,{ fields,authorization })
      await query(`UPDATE public.app_mcp_grants g SET revoked_at=COALESCE(g.revoked_at,now()) FROM public.app_mcp_tokens t
        WHERE t.grant_id=g.id AND t.token_hash=$1 AND g.client_id=$2`,[oauthHash(value),registered.id])
    })
  }
}
