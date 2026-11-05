import {createHash} from 'node:crypto'
import {headers} from 'next/headers'
import {ownedAuthSelected,ownedSessionToken} from '../../auth/owned-principal'
import {getOwnedPrincipal} from '../../auth/owned-principal-runtime'
import {getIdentityServices} from '../../auth/identity-services'
import {AdminMenuError} from '../../data/admin-menus'
import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
import {requireNativeBlogActor,type NativeBlogActor} from './authority'
import {assertProviderAccountActive} from '../../auth/provider-account-status'
/** Internal hash lookup only. No route accepts this structure from a client. */
export async function refreshNativeBlogActor(actor:NativeBlogActor):Promise<NativeBlogActor>{
 await ownedAdminTransaction(false,q=>requireNativeBlogActor(q,{...actor,checkedAt:Date.now()}))
 const {config,customerAccount}=getIdentityServices()
 if(actor.projectId!==config.web.projectId)throw new AdminMenuError(403,'Identity project mismatch')
 assertProviderAccountActive(await customerAccount({projectId:actor.projectId,subject:actor.subject}),actor.authenticatedAt)
 return {...actor,checkedAt:Date.now()}
}

/** Context is derived only from the real panel principal and its HttpOnly
 * session. Caller-provided tenant/role or preview/demo cookies never prove it. */
export async function currentNativeBlogActor(platform=false,mutation=false):Promise<NativeBlogActor> {
 if(!ownedAuthSelected()||process.env.OWNED_BLOG_ENABLED!=='true')throw new AdminMenuError(503,'Native blog configuration unavailable')
 const current=await headers(),{config}=getIdentityServices(),origin=new URL(config.origin)
 if(current.get('host')?.toLowerCase()!==origin.host.toLowerCase()||current.get('sec-fetch-site')==='cross-site'||(mutation&&current.get('origin')!==origin.origin)||/(?:^|;)\s*(?:preview_tenant_id|xm_demo)=/.test(current.get('cookie')??''))throw new AdminMenuError(403,'Blog request mode denied')
 const principal=await getOwnedPrincipal(),token=ownedSessionToken(current.get('cookie'),origin.protocol==='https:')
 if(!principal||!token)throw new AdminMenuError(401,'Sign in again')
 if(platform?principal.role!=='superadmin':!principal.tenantId||!['store-admin','store-staff'].includes(principal.role))throw new AdminMenuError(403,'Blog access denied')
 const sessionHash=createHash('sha256').update(token).digest('hex')
 const session=await ownedAdminTransaction(false,async query=>(await query('SELECT project_id,subject,authenticated_at FROM public.app_sessions WHERE token_hash=$1 AND user_id=$2',[sessionHash,principal.userId])).rows[0])
 if(!session||!(session.authenticated_at instanceof Date))throw new AdminMenuError(403,'Sign in again')
 const proof=await refreshNativeBlogActor({actorId:principal.userId,sessionHash,scope:platform?null:principal.tenantId,projectId:String(session.project_id),subject:String(session.subject),authenticatedAt:Math.floor(session.authenticated_at.getTime()/1000),checkedAt:Date.now()})
 if(!platform&&proof.scope===null)throw new AdminMenuError(403,'Blog tenant required')
 await ownedAdminTransaction(false,q=>requireNativeBlogActor(q,proof))
 return proof
}
