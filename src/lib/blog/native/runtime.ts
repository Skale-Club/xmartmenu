import type {AdminMenuQuery} from '../../data/admin-menus'
import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
import {refreshNativeBlogActor} from './authority-runtime'
import {requireNativeBlogContext,type NativeBlogContext} from './authority'
import {requireNativeBlogConfiguration} from './selected'
export async function refreshNativeBlogContext(context:NativeBlogContext):Promise<NativeBlogContext>{
 if(context.kind!=='browser')return context
 const actor=await refreshNativeBlogActor(context.actor)
 return {kind:'browser',actor}
}
export async function nativeBlogPhase<T>(context:NativeBlogContext,write:boolean,operation:(query:AdminMenuQuery,current:NativeBlogContext)=>Promise<T>){
 requireNativeBlogConfiguration()
 const current=await refreshNativeBlogContext(context)
 return ownedAdminTransaction(write,async query=>{
  await requireNativeBlogContext(query,current,write)
  const result=await operation(query,current)
  await requireNativeBlogContext(query,current,write)
  return result
 })
}
