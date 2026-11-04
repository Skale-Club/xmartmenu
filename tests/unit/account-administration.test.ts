import {describe,it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {listStaffAccounts,listAdminAccounts,changeAccountAccess,issueStaffAccess,completeStaffAccess,type AccountAdminContext} from '@/lib/data/account-administration'
const actorId=randomUUID(),tenantId=randomUUID(),targetId=randomUUID(),context:AccountAdminContext={actorId,tenantId,sessionHash:'a'.repeat(64)}
function query(role='store-admin',patch:Record<string,unknown>={}){
 return vi.fn(async(text:string)=>{
  if(text.includes('JOIN public.app_sessions'))return{rows:[{id:actorId,role,tenant_id:tenantId,must_change_password:false,disabled_at:null,...patch}]}
  if(text.startsWith('SELECT id FROM public.tenants'))return{rows:[{id:tenantId}]}
  if(text.includes('FOR UPDATE OF p,a'))return{rows:[{id:targetId,role:'customer',tenant_id:null,disabled_at:null,session_version:0,must_change_password:false}]}
  return{rows:[]}
 })
}
describe('native account boundaries before SQL mutation',()=>{
 it('requires real actor session hash and current SQL role/recovery/tenant context; no literal role can grant authority',async()=>{
  const empty=query();await expect(listStaffAccounts(empty,{...context,sessionHash:'not-a-session-hash'})).rejects.toMatchObject({status:403});expect(empty).not.toHaveBeenCalled()
  for(const [role,patch] of [['customer',{}],['store-staff',{}],['store-admin',{must_change_password:true}],['store-admin',{tenant_id:randomUUID()}]] as const){
   const q=query(role,patch);await expect(listStaffAccounts(q,context)).rejects.toMatchObject({status:403});expect(q.mock.calls.some(([text])=>text.startsWith('UPDATE '))).toBe(false)
  }
 })
 it('denies store admins on global or explicit global-tenant surfaces without reading the target roster',async()=>{
  const q=query();await expect(listAdminAccounts(q,context)).rejects.toMatchObject({status:403})
  await expect(listStaffAccounts(q,{...context,platformOnly:true})).rejects.toMatchObject({status:403})
  expect(q.mock.calls.some(([text])=>text.includes("p.role='store-staff'"))).toBe(false)
 })
 it('rejects self edits, arbitrary role fields and contact-shaped invite targets rather than matching or creating a provider account',async()=>{
  const q=query('superadmin');await expect(changeAccountAccess(q,context,actorId,{role:'customer'})).rejects.toMatchObject({status:400})
  await expect(changeAccountAccess(q,context,actorId.toUpperCase(),{role:'customer'})).rejects.toMatchObject({status:400})
  await expect(changeAccountAccess(q,context,targetId,{role:'superadmin',id:targetId})).rejects.toMatchObject({status:400})
  await expect(issueStaffAccess(q,context,'contact@example.test','invite')).rejects.toMatchObject({status:404})
  expect(q.mock.calls.some(([text])=>text.startsWith('INSERT INTO public.profiles')||text.startsWith('UPDATE public.app_accounts'))).toBe(false)
 })
 it('requires fresh factor and bounded provider check before any case query or account change',async()=>{
  const q=query(),proof={userId:targetId,projectId:'project',subject:'subject',authenticatedAt:Math.floor(Date.now()/1000),checkedAt:Date.now()}
  await expect(completeStaffAccess(q,{...proof,authenticatedAt:proof.authenticatedAt-301},'recovery','x'.repeat(43))).rejects.toMatchObject({status:401})
  await expect(completeStaffAccess(q,{...proof,checkedAt:Date.now()-5001},'recovery','x'.repeat(43))).rejects.toMatchObject({status:401})
  expect(q).not.toHaveBeenCalled()
 })
})
