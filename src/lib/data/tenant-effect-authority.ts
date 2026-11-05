import { AdminMenuError,type AdminMenuQuery } from './admin-menus'
import { requireTenantAdministrator } from './tenant-administration'

export type TenantEffectSessionContext = {actorId:string;sessionHash:string}
export type TenantEffectActor = TenantEffectSessionContext & { projectId:string; subject:string; authenticatedAt:number; checkedAt:number }
export async function readTenantEffectSession(query:AdminMenuQuery,context:TenantEffectSessionContext) {
  await requireTenantAdministrator(query,context)
  const rows=(await query('SELECT project_id,subject,authenticated_at FROM public.app_sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>clock_timestamp()',[context.sessionHash,context.actorId])).rows
  if(rows.length!==1 || !(rows[0].authenticated_at instanceof Date))throw new AdminMenuError(403,'Current administrator session is required')
  return {projectId:String(rows[0].project_id),subject:String(rows[0].subject),authenticatedAt:Math.floor(rows[0].authenticated_at.getTime()/1000)}
}
/** Proof is produced only by the server's current Google read, never a request
 * body. Recheck its exact session/binding again after that network lookup. */
export async function requireTenantEffectActor(query:AdminMenuQuery,proof:TenantEffectActor,write=false) {
  if(!Number.isSafeInteger(proof.checkedAt) || Date.now()-proof.checkedAt>5000 || proof.checkedAt>Date.now()+5000)throw new AdminMenuError(403,'Administrator verification expired')
  await requireTenantAdministrator(query,proof,write)
  const current=await readTenantEffectSession(query,proof)
  if(current.projectId!==proof.projectId || current.subject!==proof.subject || current.authenticatedAt!==proof.authenticatedAt || Date.now()-proof.checkedAt>5000)throw new AdminMenuError(403,'Administrator sign-in changed')
}
