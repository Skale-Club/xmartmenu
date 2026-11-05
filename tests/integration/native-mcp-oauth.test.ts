// Disposable PostgreSQL and injected provider status only. No OAuth/Google/Stripe network calls.
import { before,beforeEach,after,test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash,randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { adminMenuTransaction,createAdminMenusPool } from '../../src/lib/data/admin-menus-runtime'
import { NativeMcpOAuthStore,type McpBrowserActor } from '../../src/lib/mcp/data/oauth'
import { McpCapabilityIssuer,readMcpIdentity,requireMcpAuthority,type McpActor } from '../../src/lib/mcp/data/authority'
import { oauthHash,opaque } from '../../src/lib/mcp/oauth-model'
import { requireTenantAdministrator } from '../../src/lib/data/tenant-administration'
import { authorizeSubscription } from '../../src/lib/data/subscription-billing'
import { nativeMcpDataTool } from '../../src/lib/mcp/data/tools'

const raw=process.env.IDENTITY_TEST_DATABASE_URL
if (!raw || new URL(raw).pathname!=='/xmartmenu_identity_test') throw new Error('Disposable identity test database required')
const target=new URL(raw),admin=new pg.Pool({ connectionString:raw,max:2,statement_timeout:5000 })
const pool=createAdminMenusPool({ NODE_ENV:'production',PROD_DATABASE_HOST:target.hostname,PROD_DATABASE_NAME:'xmartmenu_identity_test',ADMIN_MENUS_DATABASE_URL:raw,ADMIN_MENUS_DATABASE_SSL:'disable' })
const run=<T>(write:boolean,operation:Parameters<typeof adminMenuTransaction<T>>[2])=>adminMenuTransaction(pool,write,operation)
const issuer='https://fixture.invalid',resource=`${issuer}/api/mcp`,userId=randomUUID(),otherId=randomUUID(),tenantId=randomUUID()
const browserActor:McpBrowserActor={ actorId:userId,sessionHash:oauthHash(opaque()) }
let providerDisabled=false,providerValidSince=0,providerCalls=0,providerHook:(()=>Promise<void>)|undefined
const provider=async()=>{ providerCalls++; await providerHook?.(); return { disabled:providerDisabled,validSince:providerValidSince } }
const store=new NativeMcpOAuthStore({ run },provider,issuer,resource)
const tables='public.app_mcp_tokens,public.app_mcp_authorizations,public.app_mcp_grants,public.app_mcp_clients,public.app_sessions,public.app_identity_bindings,public.profiles,public.app_accounts,public.tenants'
const runtimeRole='mcp_fixture_'+randomUUID().replaceAll('-',''),quotedRole=pg.escapeIdentifier(runtimeRole)
before(async()=>{
  await admin.query(`DROP TABLE IF EXISTS ${tables} CASCADE;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,name text,slug text);
    CREATE TABLE public.app_accounts(id uuid PRIMARY KEY,disabled_at timestamptz,session_version integer NOT NULL DEFAULT 0);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,tenant_id uuid,full_name text,must_change_password boolean DEFAULT false);
    CREATE TABLE public.app_identity_bindings(project_id text,subject text,user_id uuid REFERENCES public.app_accounts(id),disabled_at timestamptz,PRIMARY KEY(project_id,subject));
    CREATE TABLE public.app_sessions(token_hash text PRIMARY KEY,user_id uuid REFERENCES public.app_accounts(id),session_version integer,project_id text,subject text,authenticated_at timestamptz,expires_at timestamptz);`)
  const proposal=await readFile(new URL('../../docs/proposals/native-mcp-oauth-owned-only.sql',import.meta.url),'utf8')
  await admin.query(proposal.slice(proposal.indexOf('CREATE TABLE public.app_mcp_clients'),proposal.indexOf('REVOKE ALL ON')))
  await admin.query("INSERT INTO public.tenants VALUES($1,'Fixture','fixture')",[tenantId])
  await admin.query('INSERT INTO public.app_accounts(id) VALUES($1),($2)',[userId,otherId])
  await admin.query("INSERT INTO public.profiles(id,role,tenant_id,full_name) VALUES($1,'superadmin',NULL,'Verified administrator'),($2,'store-admin',$3,'Store owner')",[userId,otherId,tenantId])
  await admin.query("INSERT INTO public.app_identity_bindings(project_id,subject,user_id) SELECT 'fixture-project',id::text,id FROM public.app_accounts")
  await admin.query(`CREATE ROLE ${quotedRole} NOLOGIN;
    GRANT USAGE ON SCHEMA public TO ${quotedRole};
    GRANT SELECT,UPDATE ON public.profiles,public.app_accounts,public.app_sessions,public.app_identity_bindings TO ${quotedRole};
    GRANT SELECT,INSERT ON public.app_mcp_clients,public.app_mcp_grants,public.app_mcp_authorizations,public.app_mcp_tokens TO ${quotedRole};
    GRANT UPDATE(disabled_at) ON public.app_mcp_clients TO ${quotedRole};
    GRANT UPDATE(revoked_at) ON public.app_mcp_grants TO ${quotedRole};
    GRANT UPDATE(status,grant_id,code_hash,code_expires_at,used_at) ON public.app_mcp_authorizations TO ${quotedRole};
    GRANT UPDATE(consumed_at) ON public.app_mcp_tokens TO ${quotedRole};`)
  for(const table of ['app_mcp_clients','app_mcp_grants','app_mcp_authorizations','app_mcp_tokens']) await admin.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY fixture_runtime ON public.${table} TO ${quotedRole} USING(true) WITH CHECK(true)`)
})
beforeEach(async()=>{
  providerDisabled=false; providerValidSince=0; providerCalls=0; providerHook=undefined
  await admin.query('DELETE FROM public.app_mcp_tokens; DELETE FROM public.app_mcp_authorizations; DELETE FROM public.app_mcp_grants; DELETE FROM public.app_mcp_clients; DELETE FROM public.app_sessions; UPDATE public.app_accounts SET disabled_at=NULL,session_version=0; UPDATE public.app_identity_bindings SET disabled_at=NULL; UPDATE public.profiles SET must_change_password=false')
  await admin.query("UPDATE public.profiles SET role=CASE WHEN id=$1 THEN 'superadmin' ELSE 'store-admin' END",[userId])
  await admin.query("INSERT INTO public.app_sessions VALUES($1,$2,0,'fixture-project',$3,now()-interval '1 minute',now()+interval '1 hour')",[browserActor.sessionHash,userId,userId])
})
after(async()=>{ await pool.end(); try { await admin.query(`DROP TABLE IF EXISTS ${tables} CASCADE; REVOKE USAGE ON SCHEMA public FROM ${quotedRole}; DROP ROLE ${quotedRole}`) } finally { await admin.end() } })
async function flow(method='none') {
  const registered=await store.register({ client_name:'Fixture MCP client',redirect_uris:['https://client.invalid/callback'],token_endpoint_auth_method:method })
  const verifier=opaque(),challenge=createHash('sha256').update(verifier).digest('base64url'),state=opaque()
  const params=new URLSearchParams({ response_type:'code',client_id:registered.client_id,redirect_uri:registered.redirect_uris[0],resource,scope:'mcp:admin',state,code_challenge:challenge,code_challenge_method:'S256' })
  const consent=new URL(await store.authorize(params)),requestId=consent.searchParams.get('authorization_id')!
  return { registered,verifier,state,params,requestId }
}
async function approved(method='none') {
  const result=await flow(method),callback=new URL(await store.decide(result.requestId,browserActor,true))
  assert.equal(callback.searchParams.get('state'),result.state); assert.equal(callback.searchParams.get('iss'),issuer)
  return { ...result,code:callback.searchParams.get('code')! }
}
function exchange(value:Awaited<ReturnType<typeof approved>>,extra:Record<string,string>={}) {
  return new URLSearchParams({ grant_type:'authorization_code',client_id:value.registered.client_id,code:value.code,code_verifier:value.verifier,redirect_uri:value.registered.redirect_uris[0],resource,...extra })
}
async function authorized() { const value=await approved(),tokens=await store.token(exchange(value),null); return { ...value,tokens } }
async function actor(access:string):Promise<McpActor> { return new McpCapabilityIssuer(hash=>run(false,query=>readMcpIdentity(query,hash,resource)),provider).issue(oauthHash(access)) }
test('client registration stores only a secret digest and does not manufacture an application session',async()=>{
  const registered=await store.register({ client_name:'Confidential fixture',redirect_uris:['https://client.invalid/cb'] })
  assert.ok(registered.client_secret); const row=(await admin.query('SELECT * FROM public.app_mcp_clients')).rows[0]
  assert.equal(row.secret_hash,oauthHash(registered.client_secret!)); assert.notEqual(row.secret_hash,registered.client_secret)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_sessions')).rows[0].n,1)
})
test('authorization binds exact registered redirects and S256/resource/scope without issuing a grant',async()=>{
  const value=await flow(),params=new URLSearchParams(value.params); params.set('redirect_uri','https://evil.invalid/callback')
  await assert.rejects(store.authorize(params)); params.set('redirect_uri',value.registered.redirect_uris[0]); params.set('code_challenge_method','plain')
  await assert.rejects(store.authorize(params)); assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_mcp_grants')).rows[0].n,0)
})
test('consent requires the exact current superadmin browser session, not an actor UUID or email',async()=>{
  const value=await flow()
  await assert.rejects(store.details(value.requestId,{ ...browserActor,actorId:otherId }))
  await assert.rejects(store.decide(value.requestId,{ ...browserActor,sessionHash:oauthHash(opaque()) },true))
  const details=await store.details(value.requestId,browserActor); assert.equal(details.user.id,userId); assert.equal(details.scope,'mcp:admin')
  const denied=new URL(await store.decide(value.requestId,browserActor,false)); assert.equal(denied.searchParams.get('error'),'access_denied')
  await assert.rejects(store.decide(value.requestId,browserActor,true)); assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_mcp_grants')).rows[0].n,0)
})
test('authorization codes are single-use under concurrent exchange and access reports the real client ID',async()=>{
  const value=await approved(),results=await Promise.allSettled([store.token(exchange(value),null),store.token(exchange(value),null)])
  const success=results.filter((result):result is PromiseFulfilledResult<Awaited<ReturnType<typeof store.token>>>=>result.status==='fulfilled')
  assert.equal(success.length,1); assert.equal(results.filter(result=>result.status==='rejected').length,1)
  const current=await run(false,query=>readMcpIdentity(query,oauthHash(success[0].value.access_token),resource))
  assert.equal(current.clientId,value.registered.client_id); assert.notEqual(current.clientId,userId); assert.equal(current.userId,userId)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_mcp_tokens')).rows[0].n,2)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_sessions')).rows[0].n,1)
})
test('wrong verifier/client/resource cannot consume a code or reach provider authorization',async()=>{
  const value=await approved(),other=await store.register({ client_name:'Other',redirect_uris:['https://client.invalid/callback'],token_endpoint_auth_method:'none' })
  await assert.rejects(store.token(exchange(value,{ code_verifier:opaque() }),null)); await assert.rejects(store.token(exchange(value,{ client_id:other.client_id }),null))
  await assert.rejects(store.token(exchange(value,{ resource:'https://other.invalid/api/mcp' }),null)); await assert.rejects(store.token(exchange(value,{ scope:'openid' }),null))
  assert.equal(providerCalls,0); assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_mcp_tokens')).rows[0].n,0)
  assert.ok((await store.token(exchange(value),null)).access_token)
})
test('confidential clients authenticate with the registered method and secret',async()=>{
  const value=await approved('client_secret_basic'),header=`Basic ${Buffer.from(`${value.registered.client_id}:${value.registered.client_secret}`).toString('base64')}`
  await assert.rejects(store.token(exchange(value),null)); await assert.rejects(store.token(exchange(value,{ client_secret:value.registered.client_secret! }),null))
  assert.ok((await store.token(exchange(value),header)).access_token)
})
test('a client registered without refresh receives only an access token',async()=>{
  const registered=await store.register({ client_name:'No offline access',redirect_uris:['https://client.invalid/cb'],token_endpoint_auth_method:'none',grant_types:['authorization_code'] })
  const verifier=opaque(),params=new URLSearchParams({ response_type:'code',client_id:registered.client_id,redirect_uri:registered.redirect_uris[0],resource,scope:'mcp:admin',state:opaque(),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256' })
  const requestId=new URL(await store.authorize(params)).searchParams.get('authorization_id')!,code=new URL(await store.decide(requestId,browserActor,true)).searchParams.get('code')!
  const result=await store.token(new URLSearchParams({ grant_type:'authorization_code',client_id:registered.client_id,redirect_uri:registered.redirect_uris[0],resource,code,code_verifier:verifier }),null)
  assert.equal(result.refresh_token,undefined); assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_mcp_tokens')).rows[0].n,1)
})
test('an approved OAuth grant is independent of the browser cookie and never fabricates another session',async()=>{
  const value=await approved(); await admin.query('DELETE FROM public.app_sessions')
  const tokens=await store.token(exchange(value),null),current=await actor(tokens.access_token)
  await run(true,query=>requireTenantAdministrator(query,current,true))
  await run(true,query=>authorizeSubscription(query,{ ...current,tenantId,role:'superadmin' },true,true))
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_sessions')).rows[0].n,0)
})
test('refresh rotates its secret; replay durably revokes the entire grant family',async()=>{
  const value=await authorized(),fields=new URLSearchParams({ grant_type:'refresh_token',client_id:value.registered.client_id,refresh_token:value.tokens.refresh_token!,resource })
  const refreshed=await store.token(fields,null); assert.notEqual(refreshed.refresh_token,value.tokens.refresh_token)
  assert.ok((await actor(refreshed.access_token)).actorId)
  await assert.rejects(store.token(fields,null)); await assert.rejects(actor(refreshed.access_token)); await assert.rejects(actor(value.tokens.access_token))
  assert.ok((await admin.query('SELECT revoked_at FROM public.app_mcp_grants')).rows[0].revoked_at)
})
test('concurrent refresh cannot mint two surviving token families',async()=>{
  const value=await authorized(),fields=new URLSearchParams({ grant_type:'refresh_token',client_id:value.registered.client_id,refresh_token:value.tokens.refresh_token!,resource })
  const results=await Promise.allSettled([store.token(new URLSearchParams(fields),null),store.token(new URLSearchParams(fields),null)])
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_mcp_tokens')).rows[0].n,4)
  assert.ok((await admin.query('SELECT revoked_at FROM public.app_mcp_grants')).rows[0].revoked_at)
})
const revoke={
  disabled:()=>admin.query('UPDATE public.app_accounts SET disabled_at=now() WHERE id=$1',[userId]),
  version:()=>admin.query('UPDATE public.app_accounts SET session_version=session_version+1 WHERE id=$1',[userId]),
  binding:()=>admin.query('UPDATE public.app_identity_bindings SET disabled_at=now() WHERE user_id=$1',[userId]),
  role:()=>admin.query("UPDATE public.profiles SET role='customer' WHERE id=$1",[userId]),
  reset:()=>admin.query('UPDATE public.profiles SET must_change_password=true WHERE id=$1',[userId]),
}
for (const [name,change] of Object.entries(revoke)) {
  test(`a ${name} account/control denies token exchange after real consent`,async()=>{
    const value=await approved(); await change(); await assert.rejects(store.token(exchange(value),null))
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_mcp_tokens')).rows[0].n,0)
  })
  test(`a ${name} control is rechecked by the SQL guard after a server-issued provider proof`,async()=>{
    const value=await authorized(),capability=await actor(value.tokens.access_token); await change()
    await assert.rejects(run(true,query=>requireMcpAuthority(query,capability,true)))
  })
}
test('provider revocation denies minting and mutation proof without any provider writes',async()=>{
  const value=await approved(); providerDisabled=true; await assert.rejects(store.token(exchange(value),null))
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_mcp_tokens')).rows[0].n,0)
})
test('authority changed during the provider read is rechecked before token insert',async()=>{
  const value=await approved(); providerHook=async()=>{ await revoke.version() }
  await assert.rejects(store.token(exchange(value),null)); assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.app_mcp_tokens')).rows[0].n,0)
})
test('expired code and access tokens refuse and client-bound revoke hides unknown tokens',async()=>{
  const value=await approved(); await admin.query("UPDATE public.app_mcp_authorizations SET code_expires_at=now()-interval '1 second'")
  await assert.rejects(store.token(exchange(value),null)); await admin.query("UPDATE public.app_mcp_authorizations SET code_expires_at=now()+interval '1 minute'")
  const tokens=await store.token(exchange(value),null); await admin.query("UPDATE public.app_mcp_tokens SET created_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE kind='access'")
  await assert.rejects(actor(tokens.access_token))
  await store.revoke(new URLSearchParams({ client_id:value.registered.client_id,token:'unknown' }),null)
  await store.revoke(new URLSearchParams({ client_id:value.registered.client_id,token:tokens.refresh_token! }),null)
  await assert.rejects(store.token(new URLSearchParams({ client_id:value.registered.client_id,grant_type:'refresh_token',refresh_token:tokens.refresh_token!,resource }),null))
})
test('the narrow NOLOGIN runtime role can lock/mint/refresh but cannot rewrite client, token or grant facts',async()=>{
  const runtimeRun=<T>(write:boolean,operation:Parameters<typeof run<T>>[1])=>run(write,async query=>{ await query(`SET LOCAL ROLE ${quotedRole}`); return operation(query) })
  const runtimeStore=new NativeMcpOAuthStore({ run:runtimeRun },provider,issuer,resource),value=await approved()
  const tokens=await runtimeStore.token(exchange(value),null)
  const capability=await new McpCapabilityIssuer(hash=>runtimeRun(false,query=>readMcpIdentity(query,hash,resource)),provider).issue(oauthHash(tokens.access_token))
  await runtimeRun(true,query=>requireMcpAuthority(query,capability,true))
  await runtimeStore.token(new URLSearchParams({ grant_type:'refresh_token',client_id:value.registered.client_id,refresh_token:tokens.refresh_token!,resource }),null)
  const denied=async(sql:string,values:unknown[]=[])=>runtimeRun(true,async query=>{
    await query('SAVEPOINT denied_fact'); let code:unknown
    try { await query(sql,values) } catch(error) { code=(error as { code?:string }).code }
    await query('ROLLBACK TO SAVEPOINT denied_fact'); assert.equal(code,'42501')
  })
  await denied('UPDATE public.app_mcp_clients SET secret_hash=$1',[oauthHash(opaque())])
  await denied("UPDATE public.app_mcp_grants SET scopes=ARRAY['other']")
  await denied('UPDATE public.app_mcp_tokens SET token_hash=$1',[oauthHash(opaque())])
})
test('native location deletion refuses an alternate-key cascade and preserves its child before allowing an unreferenced delete',async()=>{
  const value=await authorized(),capability=await actor(value.tokens.access_token),location=randomUUID(),previous=process.env.MCP_ALLOW_DESTRUCTIVE
  process.env.MCP_ALLOW_DESTRUCTIVE='true'
  await admin.query(`DROP TABLE IF EXISTS public.mcp_location_guard_fixture,public.locations CASCADE;
    CREATE TABLE public.locations(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES public.tenants(id),slug text UNIQUE);
    CREATE TABLE public.mcp_location_guard_fixture(location_slug text REFERENCES public.locations(slug) ON DELETE CASCADE);`)
  await admin.query("INSERT INTO public.locations VALUES($1,$2,'alternate-location')",[location,tenantId])
  await admin.query("INSERT INTO public.mcp_location_guard_fixture VALUES('alternate-location')")
  try {
    await assert.rejects(run(true,query=>nativeMcpDataTool(query,capability,'delete_location',{ tenant:tenantId,location_id:location,confirm:true },issuer)),{ status:409 })
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.locations')).rows[0].n,1)
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.mcp_location_guard_fixture')).rows[0].n,1)
    await admin.query('DROP TABLE public.mcp_location_guard_fixture')
    await run(true,query=>nativeMcpDataTool(query,capability,'delete_location',{ tenant:tenantId,location_id:location,confirm:true },issuer))
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.locations')).rows[0].n,0)
  } finally {
    await admin.query('DROP TABLE IF EXISTS public.mcp_location_guard_fixture,public.locations CASCADE')
    if(previous===undefined) delete process.env.MCP_ALLOW_DESTRUCTIVE; else process.env.MCP_ALLOW_DESTRUCTIVE=previous
  }
})
