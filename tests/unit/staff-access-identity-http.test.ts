import { randomBytes } from 'node:crypto'
import { describe,it,expect,vi } from 'vitest'
import { createIdentityHttp,type IdentityHttpDependencies } from '@/lib/auth/identity-http'
import { AdminMenuError } from '@/lib/data/admin-menus'
const opaque=()=>randomBytes(32).toString('base64url'),origin='https://identity.example.test'
function fixture(){
 const code=opaque(),challenge=opaque(),newSession=opaque(),old=opaque()
 const state={owner:'target-id',authAt:Math.floor(Date.now()/1000),project:'skaleclub',claimed:false,kind:'',current:null as null|{userId:string;authenticatedAt:Date},failure:false}
 const legacy=vi.fn(async()=>null),complete=vi.fn(async(_identity:unknown,_code:string,kind:'invite'|'recovery')=>{
  state.kind=kind;if(state.failure)throw new AdminMenuError(409,'This exact recovery case is unavailable');return{token:newSession,expiresAt:new Date(Date.now()+60000)}
 })
 const deps:IdentityHttpDependencies={enabled:()=>true,origin,config:{apiKey:'fixture-public',projectId:'skaleclub',authDomain:'fixture.test'},verifyConfig:async()=>{},allowRequest:async()=>true,
  verify:async token=>{if(token!=='proof')throw Error('untrusted');return{projectId:state.project,subject:'already-bound-subject',provider:'google.com',authenticatedAt:state.authAt}},
  legacyOwner:legacy,completeStaffAccess:complete,store:{issueChallenge:async()=>challenge,consumeChallenge:async value=>{if(value!==challenge||state.claimed)return false;state.claimed=true;return true},
   owner:async()=>state.owner||null,bind:vi.fn(),createSession:vi.fn(),session:async()=>state.current,logout:vi.fn(),revokeAll:vi.fn()}}
 const handler=createIdentityHttp(deps)
 const request=(operation='accept-staff-invite',patch:Record<string,unknown>={},headers:Record<string,string>={})=>handler(new Request(origin+'/api/identity/'+operation,{method:'POST',headers:{host:'identity.example.test',origin,'content-type':'application/json',cookie:`__Host-xm_identity_challenge=${challenge}`,...headers},body:JSON.stringify({idToken:'proof',challenge,code,...patch})}),operation)
 return{state,request,complete,legacy,newSession,old,code,challenge,deps}
}
describe('staff ownership handoff uses existing verified identity infrastructure',()=>{
 it('accepts exact fresh bound ownership, rotates an opaque native cookie and never binds/creates a provider identity',async()=>{
  const f=fixture(),response=await f.request();expect(response.status).toBe(200);expect(await response.json()).toEqual({authenticated:true})
  expect(response.headers.get('set-cookie')).toContain(f.newSession);expect(f.complete).toHaveBeenCalledTimes(1);expect(f.state.kind).toBe('invite')
  expect(f.deps.store.bind).not.toHaveBeenCalled();expect(f.deps.store.createSession).not.toHaveBeenCalled();expect(f.legacy).not.toHaveBeenCalled()
  expect((await f.request()).status).toBe(403);expect(f.complete).toHaveBeenCalledTimes(1)
 })
 it('fresh independent factor can complete an exact reset after the previous local session was revoked',async()=>{
  const f=fixture();const response=await f.request('recover-staff',{}, {cookie:`__Host-xm_identity=${f.old}; __Host-xm_identity_challenge=${f.challenge}`})
  expect(response.status).toBe(200);expect(f.state.kind).toBe('recovery');expect(f.legacy).not.toHaveBeenCalled()
 })
 it('rejects wrong project, stale factor, absent binding, another signed-in UID, preview, demo, wrong browser nonce and role/tenant injection',async()=>{
  for(const kind of ['project','stale','unbound','other','preview','demo','nonce','inject'] as const){
   const f=fixture(),headers:Record<string,string>={};let patch:Record<string,unknown>={}
   if(kind==='project')f.state.project='wrong-project';if(kind==='stale')f.state.authAt-=301;if(kind==='unbound')f.state.owner=''
   if(kind==='other'){f.state.current={userId:'another-id',authenticatedAt:new Date()};headers.cookie=`__Host-xm_identity=${f.old}; __Host-xm_identity_challenge=${f.challenge}`}
   if(kind==='preview'||kind==='demo')headers.cookie=`__Host-xm_identity_challenge=${f.challenge}; ${kind==='preview'?'preview_tenant_id':'xm_demo'}=1`
   if(kind==='nonce')patch.challenge=opaque();if(kind==='inject')patch={recipient_user_id:'chosen-by-client',tenant_id:'foreign',role:'superadmin'}
   expect((await f.request('accept-staff-invite',patch,headers)).status).toBeGreaterThanOrEqual(400);expect(f.complete).not.toHaveBeenCalled();expect(f.legacy).not.toHaveBeenCalled()
  }
 })
 it('cross-origin requests and unreviewed recovery cases cannot reach a Source fallback',async()=>{
  const f=fixture();expect((await f.request('recover-staff',{}, {origin:'https://evil.test'})).status).toBe(403);expect(f.complete).not.toHaveBeenCalled()
  f.state.failure=true;const response=await f.request('recover-staff');expect(response.status).toBe(409);expect(await response.json()).toEqual({message:'This exact recovery case is unavailable'});expect(f.legacy).not.toHaveBeenCalled()
 })
})
