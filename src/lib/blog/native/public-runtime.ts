import {ownedAdminTransaction} from '../../data/admin-menus-runtime'
import {readNativeBlogTenant,readNativePublishedPosts,readNativePublishedPost,readNativeBlogTags,readNativeBlogArchive} from './public-data'
import {requireNativeBlogConfiguration} from './selected'
import type {AdminMenuQuery} from '../../data/admin-menus'
const read=<T>(operation:(query:AdminMenuQuery)=>Promise<T>)=>{requireNativeBlogConfiguration();return ownedAdminTransaction(false,operation)}
export const nativeBlogTenant=(slug:string)=>read(q=>readNativeBlogTenant(q,slug))
export const nativePublishedPosts=(scope:string|null,limit=50,period?:{year:number;month?:number})=>read(q=>readNativePublishedPosts(q,scope,limit,period))
export const nativePublishedPost=(scope:string|null,slug:string)=>read(q=>readNativePublishedPost(q,scope,slug))
export const nativeBlogTags=(scope:string|null)=>read(q=>readNativeBlogTags(q,scope))
export const nativeBlogArchive=(scope:string|null)=>read(q=>readNativeBlogArchive(q,scope))
