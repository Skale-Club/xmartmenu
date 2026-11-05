import { createHash,randomUUID } from 'node:crypto'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { authorizeParameters,checkPkce,credential,equalSecret,mcpOrigin,nativeMcpSelected,oauthHash,opaque,registration } from '@/lib/mcp/oauth-model'
import { currentMcpIdentity,McpCapabilityIssuer,oauthAuthority,refreshMcpCapability,requireMcpAuthority,type McpIdentity,type NativeAdminAuthority } from '@/lib/mcp/data/authority'

afterEach(()=>vi.useRealTimers())
const resource='https://fixture.invalid/api/mcp',clientId=`xm_mcp_client_${randomUUID().replaceAll('-','')}`
const authorization=()=>new URLSearchParams({ response_type:'code',client_id:clientId,redirect_uri:'https://client.invalid/callback',scope:'mcp:admin',state:opaque(),code_challenge:opaque(),code_challenge_method:'S256',resource })
describe('native MCP OAuth protocol',()=>{
  it('stays disabled by default and pins an explicit HTTPS issuer/resource',()=>{
    expect(nativeMcpSelected({})).toBe(false); expect(()=>nativeMcpSelected({ OWNED_MCP_ENABLED:'yes' })).toThrow()
    expect(mcpOrigin({ NODE_ENV:'production',IDENTITY_ORIGIN:'https://fixture.invalid' })).toEqual({ issuer:'https://fixture.invalid',resource })
    for(const origin of ['http://fixture.invalid','https://user:pass@fixture.invalid','https://fixture.invalid/path','https://fixture.invalid/#hash']) expect(()=>mcpOrigin({ NODE_ENV:'production',IDENTITY_ORIGIN:origin })).toThrow()
  })
  it('registers local public/confidential clients without accepting an injected client ID or metadata fetch',()=>{
    expect(registration({ client_name:'Codex',redirect_uris:['http://127.0.0.1:4182/callback'],token_endpoint_auth_method:'none' }).method).toBe('none')
    expect(registration({ client_name:'Claude',redirect_uris:['https://client.invalid/callback'] }).method).toBe('client_secret_basic')
    for(const redirect of ['javascript:alert(1)','http://remote.invalid/cb','https://u:p@client.invalid/cb','https://client.invalid/cb#secret']) expect(()=>registration({ client_name:'Client',redirect_uris:[redirect] })).toThrow()
    expect(()=>registration({ client_name:'Client',redirect_uris:['https://client.invalid/cb'],client_id:randomUUID() })).toThrow()
  })
  it('rejects PKCE downgrade, duplicate parameters, absent resource and unconsented scope',()=>{
    expect(authorizeParameters(authorization(),resource).clientId).toBe(clientId)
    for(const [key,value] of [['code_challenge_method','plain'],['resource','https://other.invalid/api/mcp'],['scope','openid'],['response_type','token']]) {
      const input=authorization(); input.set(key,value); expect(()=>authorizeParameters(input,resource)).toThrow()
    }
    const duplicate=authorization(); duplicate.append('client_id',clientId); expect(()=>authorizeParameters(duplicate,resource)).toThrow()
  })
  it('checks S256 verifier and keeps token kinds separate from Source JWTs and browser cookies',()=>{
    const verifier=opaque(),challenge=createHash('sha256').update(verifier).digest('base64url')
    expect(()=>checkPkce(verifier,challenge)).not.toThrow(); expect(()=>checkPkce(opaque(),challenge)).toThrow()
    expect(credential(`xm_mcp_at_${verifier}`,'access')).toBe(oauthHash(`xm_mcp_at_${verifier}`))
    for(const value of [verifier,`xm_mcp_rt_${verifier}`,'eyJ.fixture.signature']) expect(()=>credential(value,'access')).toThrow()
    expect(equalSecret(verifier,oauthHash(verifier))).toBe(true); expect(equalSecret(opaque(),oauthHash(verifier))).toBe(false)
  })
})
const identity=():McpIdentity=>({ userId:randomUUID(),grantId:randomUUID(),clientId,resource,projectId:'fixture-project',subject:'verified-subject',authenticatedAt:Math.floor(Date.now()/1000)-10,expiresAt:Math.floor(Date.now()/1000)+900,role:'superadmin',scopes:['mcp:admin'],clientOrigins:['https://client.invalid'] })
describe('closed server-issued OAuth authority',()=>{
  it('refuses JSON-shaped fake proof and both/neither authority union',()=>{
    expect(()=>oauthAuthority({ sessionHash:'a'.repeat(64) })).not.toThrow()
    for(const value of [{},{ oauth:{ tokenHash:'a'.repeat(64),requiredScope:'mcp:admin' } },{ sessionHash:'a'.repeat(64),oauth:{ tokenHash:'b'.repeat(64),requiredScope:'mcp:admin' } }]) expect(()=>oauthAuthority(value as NativeAdminAuthority)).toThrow()
  })
  it('issues proof only after a current provider read and refuses disabled/revoked identities',async()=>{
    const value=identity(),provider=vi.fn().mockResolvedValue({ disabled:false,validSince:0 }),issuer=new McpCapabilityIssuer(async()=>value,provider)
    const actor=await issuer.issue('a'.repeat(64)); expect(currentMcpIdentity(actor.oauth)).toEqual(value); expect(provider).toHaveBeenCalledWith(value)
    provider.mockResolvedValue({ disabled:true,validSince:0 }); await expect(issuer.issue('b'.repeat(64))).rejects.toThrow()
    provider.mockResolvedValue({ disabled:false,validSince:value.authenticatedAt+1 }); await expect(issuer.issue('b'.repeat(64))).rejects.toThrow()
  })
  it('refreshes the provider outside SQL and refuses an identity/binding change during refresh',async()=>{
    vi.useFakeTimers(); const value=identity(),read=vi.fn().mockResolvedValue(value),provider=vi.fn().mockResolvedValue({ disabled:false,validSince:0 })
    const actor=await new McpCapabilityIssuer(read,provider).issue('a'.repeat(64))
    vi.advanceTimersByTime(11000); expect(()=>currentMcpIdentity(actor.oauth)).toThrow()
    await refreshMcpCapability(actor.oauth); expect(currentMcpIdentity(actor.oauth).userId).toBe(value.userId); expect(provider).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(6000); read.mockResolvedValue({ ...value,subject:'different-binding' }); await expect(refreshMcpCapability(actor.oauth)).rejects.toThrow()
  })
  it('cannot substitute a different actor even with a real issued capability',async()=>{
    const value=identity(),actor=await new McpCapabilityIssuer(async()=>value,async()=>({ disabled:false,validSince:0 })).issue('a'.repeat(64)),query=vi.fn()
    await expect(requireMcpAuthority(query,{ ...actor,actorId:randomUUID() },true)).rejects.toThrow(); expect(query).not.toHaveBeenCalled()
  })
})
