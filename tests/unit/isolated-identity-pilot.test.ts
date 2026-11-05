import {randomBytes,randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {describe,it,expect,vi} from 'vitest'
import {createPilotHandler} from '../../scripts/ops/xmartmenu-identity-pilot-server'
import {pilotConfiguration,assertPilotAdmission,PILOT_DATABASE,PILOT_HOST,PILOT_ROLE,PILOT_OWNER,PILOT_ORIGIN,PILOT_PREFIX} from '../../scripts/ops/xmartmenu-identity-pilot-policy'
import {createIdentityHttp,type IdentityHttpDependencies} from '../../src/lib/auth/identity-http'

const opaque=()=>randomBytes(32).toString('base64url'),hash=()=>randomBytes(32).toString('hex')
function packet(){return{environment:{IDENTITY_ORIGIN:PILOT_ORIGIN,IDENTITY_DATABASE_URL:`postgresql://${PILOT_ROLE}:${opaque()}@${PILOT_HOST}:5432/${PILOT_DATABASE}`,
  GOOGLE_AUTH_PROJECT_ID:'skaleclub',GOOGLE_AUTH_PROJECT_NUMBER:'937861185231',GOOGLE_AUTH_WEB_API_KEY:'public-project-key',
  GOOGLE_AUTH_ADC_FILE:'/run/secrets/xmartmenu-google-identity/adc.json',GOOGLE_AUTH_ADC_AUDIENCE:'public-audience',GOOGLE_AUTH_ADC_SERVICE_ACCOUNT:'public-account',GOOGLE_AUTH_ADC_SUBJECT:'public-subject',
  NEXT_PUBLIC_SUPABASE_URL:'https://ktogbpqookfcqilqvici.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:`sb_publishable_${opaque()}`},profileAuthorityHash:hash(),accountControlHash:hash()}}
function fixture(){
  const challenge=opaque(),session=opaque(),id=randomUUID(),sessions=new Map<string,{userId:string;authenticatedAt:Date}>()
  const deps:IdentityHttpDependencies={enabled:()=>true,origin:PILOT_ORIGIN,config:{apiKey:'public-key',projectId:'skaleclub',authDomain:'skaleclub.firebaseapp.com'},
    verifyConfig:vi.fn(async()=>{}),allowRequest:vi.fn(async()=>true),verify:vi.fn(async()=>({projectId:'skaleclub',subject:'verified-subject',provider:'google.com' as const,authenticatedAt:Math.floor(Date.now()/1000)})),legacyOwner:vi.fn(async()=>id),
    store:{issueChallenge:vi.fn(async()=>challenge),consumeChallenge:vi.fn(async(value:string)=>value===challenge),owner:vi.fn(async()=>id),bind:vi.fn(async()=>{}),
      createSession:vi.fn(async()=>{sessions.set(session,{userId:id,authenticatedAt:new Date()});return{token:session,expiresAt:new Date(Date.now()+60000)}}),
      session:vi.fn(async(value:string)=>sessions.get(value)??null),logout:vi.fn(async()=>{}),revokeAll:vi.fn(async()=>{})}}
  const request=(path:string,body?:object,cookies='',extra:Record<string,string>={})=>new Request(`${PILOT_ORIGIN}${path}`,{method:body?'POST':'GET',headers:{host:new URL(PILOT_ORIGIN).host,origin:PILOT_ORIGIN,...(body?{'content-type':'application/json'}:{}),cookie:cookies,...extra},body:body?JSON.stringify(body):undefined})
  return{deps,request,challenge,session}
}
describe('isolated identity pilot',()=>{
  it('accepts only the exact isolated database, runtime, production origin and public Source key',()=>{
    const good=packet();expect(pilotConfiguration(good).config.origin).toBe(PILOT_ORIGIN)
    for(const [key,value]of [['IDENTITY_DATABASE_URL',good.environment.IDENTITY_DATABASE_URL.replace(PILOT_DATABASE,'xmartmenu')],['IDENTITY_DATABASE_URL',good.environment.IDENTITY_DATABASE_URL.replace(PILOT_HOST,'49.13.197.250')],
      ['IDENTITY_DATABASE_URL',good.environment.IDENTITY_DATABASE_URL.replace(PILOT_ROLE,'xmartmenu_runtime')],['IDENTITY_ORIGIN','https://xmartmenu-stage.skale.club'],['NEXT_PUBLIC_SUPABASE_ANON_KEY',`sb_secret_${opaque()}`],['SUPABASE_SERVICE_ROLE_KEY',opaque()]]){
      expect(()=>pilotConfiguration({...good,environment:{...good.environment,[key]:value}})).toThrow()
    }
    expect(()=>pilotConfiguration({...good,profileAuthorityHash:'missing'})).toThrow()
  })
  it('pins clone owner, counts, unchanged profiles/accounts and restricted role without accepting another target',()=>{
    const expected={profileAuthorityHash:hash(),accountControlHash:hash()},row={database:PILOT_DATABASE,role:PILOT_ROLE,owner:PILOT_OWNER,tables:51,ledger:95,accounts:7,disabled:1,
      profiles_hash:expected.profileAuthorityHash,accounts_hash:expected.accountControlHash,invalid_bindings:0,invalid_sessions:0,restricted_role:true}
    expect(()=>assertPilotAdmission(row,expected)).not.toThrow()
    for(const change of [{database:'xmartmenu'},{role:'xmartmenu_runtime'},{owner:'xmartmenu_owner'},{accounts:8},{disabled:0},{restricted_role:false},{invalid_bindings:1},{profiles_hash:hash()},{accounts_hash:hash()}])expect(()=>assertPilotAdmission({...row,...change},expected)).toThrow()
  })
  it('sets exclusive secure host cookies and never accepts the main application cookie',async()=>{
    const f=fixture(),handle=createPilotHandler(f.deps,'/* public */')
    const challenge=await handle(f.request(`${PILOT_PREFIX}/api/challenge`,{}))
    expect(challenge.headers.getSetCookie()[0]).toMatch(/^__Host-xm_identity_pilot_challenge=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=120; Secure$/)
    const login=await handle(f.request(`${PILOT_PREFIX}/api/login`,{idToken:'verified',challenge:f.challenge},`__Host-xm_identity_pilot_challenge=${f.challenge}`))
    expect(login.status).toBe(200);expect(login.headers.getSetCookie()[0]).toContain('__Host-xm_identity_pilot=')
    expect((await handle(f.request(`${PILOT_PREFIX}/api/session`,undefined,`__Host-xm_identity=${f.session}`))).status).toBe(401)
    expect((await handle(f.request(`${PILOT_PREFIX}/api/session`,undefined,`__Host-xm_identity_pilot=${f.session}`))).status).toBe(200)
  })
  it('keeps application defaults identical and rejects invented cookie modes',async()=>{
    const f=fixture(),response=await createIdentityHttp(f.deps)(f.request('/api/identity/challenge',{}),'challenge')
    expect(response.headers.getSetCookie()[0]).toContain('__Host-xm_identity_challenge=')
    expect(()=>createIdentityHttp({...f.deps,cookieMode:'arbitrary'} as unknown as IdentityHttpDependencies)).toThrow()
  })
  it('refuses other paths, host aliases, cross-site calls and registration before any proof or SQL',async()=>{
    const f=fixture(),handle=createPilotHandler(f.deps,'/* public */')
    for(const request of [f.request('/api/identity/config'),f.request(`${PILOT_PREFIX}/api/register-business`,{}),f.request(`${PILOT_PREFIX}/api/config`,undefined,'',{host:'xmartmenu-stage.skale.club'}),
      f.request(`${PILOT_PREFIX}/api/config`,undefined,'',{'sec-fetch-site':'cross-site'}),f.request(`${PILOT_PREFIX}/api/config?override=1`)])expect((await handle(request)).status).toBe(404)
    expect(f.deps.allowRequest).not.toHaveBeenCalled();expect(f.deps.verifyConfig).not.toHaveBeenCalled();expect(f.deps.verify).not.toHaveBeenCalled()
  })
  it('serves only public prefix assets with no-store and a Google-compatible popup policy',async()=>{
    const f=fixture(),handle=createPilotHandler(f.deps,'/* public browser bundle */'),page=await handle(f.request(`${PILOT_PREFIX}/`))
    expect(page.headers.get('cache-control')).toBe('no-store');expect(page.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups')
    expect(await page.text()).toContain(`${PILOT_PREFIX}/browser.js`)
    expect(await(await handle(f.request(`${PILOT_PREFIX}/browser.js`))).text()).toBe('/* public browser bundle */')
    expect(await(await handle(f.request(`${PILOT_PREFIX}/health`))).json()).toEqual({isolated:true,ready:true})
  })
  it('defaults the executable to a no-operation plan before importing or starting the server',()=>{
    const result=spawnSync(process.execPath,['scripts/ops/xmartmenu-identity-pilot-cli.mjs'],{encoding:'utf8',timeout:5000})
    expect(result.status).toBe(0);expect(result.stdout).toContain('PLAN ONLY');expect(result.stderr).toBe('')
  })
})
