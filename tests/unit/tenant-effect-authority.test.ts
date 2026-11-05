import { describe,it,expect,vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { requireTenantEffectActor } from '@/lib/data/tenant-effect-authority'
import { tenantEffectDigest } from '@/lib/data/tenant-effect-operations'
const authenticatedAt=Math.floor(Date.now()/1000),proof={actorId:randomUUID(),sessionHash:'a'.repeat(64),projectId:'skaleclub',subject:'synthetic-subject',authenticatedAt,checkedAt:Date.now()}
function query(session:Record<string,unknown>={}){return vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT project_id')?[{project_id:proof.projectId,subject:proof.subject,authenticated_at:new Date(authenticatedAt*1000),...session}]:sql.includes('JOIN public.app_sessions')?[{id:proof.actorId}]:[]}))}
describe('native effect phases retain the real actor session',()=>{
 it('refuses a stale provider observation before SQL and never accepts a role literal as proof',async()=>{
  const q=query();await expect(requireTenantEffectActor(q,{...proof,checkedAt:Date.now()-5001},true)).rejects.toMatchObject({status:403});expect(q).not.toHaveBeenCalled()
  await expect(requireTenantEffectActor(q,{...proof,sessionHash:'superadmin',checkedAt:Date.now()},true)).rejects.toMatchObject({status:403})
 })
 it('matches the exact post-provider project, subject and authentication epoch against the current session',async()=>{
  await expect(requireTenantEffectActor(query(),{...proof,checkedAt:Date.now()},true)).resolves.toBeUndefined()
  for(const patch of [{project_id:'other-project'},{subject:'other-subject'},{authenticated_at:new Date((authenticatedAt+1)*1000)}])await expect(requireTenantEffectActor(query(patch),{...proof,checkedAt:Date.now()},true)).rejects.toMatchObject({status:403})
 })
 it('rejects SQL revocation during a provider lookup without proceeding to an operation or provider write',async()=>{
  const q=vi.fn(async()=>({rows:[]}))
  await expect(requireTenantEffectActor(q,{...proof,checkedAt:Date.now()},true)).rejects.toMatchObject({status:403})
  expect(q.mock.calls.length).toBe(2)
 })
 it('canonically binds replay keys to input contents independent of object field order',()=>{
  expect(tenantEffectDigest({a:1,b:{d:3,c:2}})).toBe(tenantEffectDigest({b:{c:2,d:3},a:1}))
  expect(tenantEffectDigest({a:2})).not.toBe(tenantEffectDigest({a:1}))
 })
})
